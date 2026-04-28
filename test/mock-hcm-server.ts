import fastify from 'fastify';

export interface EmployeeBalance {
  employeeId: string;
  locationId: string;
  availableDays: number;
  pendingDays: number;
}

export class MockHcmServer {
  private app: ReturnType<typeof fastify>;
  private balances: Map<string, EmployeeBalance> = new Map();
  private requests: Array<{
    id: string;
    employeeId: string;
    locationId: string;
    daysRequested: number;
    status: 'pending' | 'approved' | 'rejected';
  }> = [];

  constructor() {
    this.app = fastify({ logger: false });

    this.setupRoutes();
  }

  private setupRoutes() {
    // Get balance for employee/location
    this.app.get('/balances/:employeeId/:locationId', (request, reply) => {
      const { employeeId, locationId } = request.params as {
        employeeId: string;
        locationId: string;
      };
      const key = `${employeeId}:${locationId}`;
      const balance = this.balances.get(key);

      if (!balance) {
        return reply.code(404).send({ error: 'Balance not found' });
      }

      reply.send({
        availableDays: balance.availableDays,
        pendingDays: balance.pendingDays,
        hcmSyncedAt: new Date().toISOString(),
      });
    });

    // Get balance corpus
    this.app.get('/balances/corpus', (request, reply) => {
      const { employees, locations } = request.query as {
        employees: string;
        locations: string;
      };
      const employeeIds = employees.split(',');
      const locationIds = locations.split(',');

      const balances = [];
      for (const emp of employeeIds) {
        for (const loc of locationIds) {
          const key = `${emp}:${loc}`;
          const balance = this.balances.get(key);
          if (balance) {
            balances.push({
              hcmEmployeeId: emp,
              hcmLocationId: loc,
              availableDays: balance.availableDays,
              pendingDays: balance.pendingDays,
              hcmSyncedAt: new Date().toISOString(),
            });
          }
        }
      }

      reply.send({ balances });
    });

    // Submit request
    this.app.post('/requests', (request, reply) => {
      const { employeeId, locationId, daysRequested } = request.body as {
        employeeId: string;
        locationId: string;
        daysRequested: number;
      };

      const key = `${employeeId}:${locationId}`;
      const balance = this.balances.get(key);

      if (!balance) {
        return reply.code(400).send({ error: 'Balance not found' });
      }

      // Check if this is an approval (already have a pending request for this)
      const existingRequest = this.requests.find(
        (r) =>
          r.employeeId === employeeId &&
          r.locationId === locationId &&
          r.daysRequested === daysRequested &&
          r.status === 'pending',
      );

      if (existingRequest) {
        // Approval: deduct from available and remove from pending
        balance.availableDays -= daysRequested;
        balance.pendingDays -= daysRequested;
        existingRequest.status = 'approved';

        reply.code(201).send({
          id: existingRequest.id,
          status: 'approved',
        });
      } else {
        // Submission: check balance and add to pending
        if (balance.availableDays - balance.pendingDays < daysRequested) {
          return reply.code(400).send({ error: 'Insufficient balance' });
        }

        balance.pendingDays += daysRequested;

        const requestId = `req-${Date.now()}`;
        this.requests.push({
          id: requestId,
          employeeId,
          locationId,
          daysRequested,
          status: 'pending',
        });

        reply.code(201).send({
          id: requestId,
          status: 'pending',
        });
      }
    });

    // Control endpoint for test setup
    this.app.post('/control', (request, reply) => {
      const { action, employeeId, locationId, balance, topUp } =
        request.body as {
          action: string;
          employeeId?: string;
          locationId?: string;
          balance?: number;
          topUp?: number;
        };

      if (
        action === 'set-balance' &&
        employeeId &&
        locationId &&
        balance !== undefined
      ) {
        const key = `${employeeId}:${locationId}`;
        this.balances.set(key, {
          employeeId,
          locationId,
          availableDays: balance,
          pendingDays: 0,
        });
        return reply.send({ success: true });
      }

      if (
        action === 'top-up' &&
        employeeId &&
        locationId &&
        topUp !== undefined
      ) {
        const key = `${employeeId}:${locationId}`;
        const existing = this.balances.get(key);
        if (existing) {
          existing.availableDays += topUp;
        }
        return reply.send({ success: true });
      }

      if (action === 'approve-request' && request.body.requestId) {
        // Not needed, approval is handled via /requests
        return reply.send({ success: true });
      }

      reply.code(400).send({ error: 'Invalid action' });
    });
  }

  async start(port: number = 0): Promise<string> {
    const address = await this.app.listen({ port, host: '127.0.0.1' });
    return address;
  }

  async stop() {
    await this.app.close();
  }

  getBalances() {
    return Array.from(this.balances.values());
  }

  getRequests() {
    return this.requests;
  }

  // Expose app for testing
  getApp() {
    return this.app;
  }
}
