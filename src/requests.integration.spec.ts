import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HcmAdapter } from '../src/hcm.adapter';
import { AuthGuard } from '../src/auth.guard';
import { EmployeeGuard } from '../src/employee.guard';
import { ProblemDetailsFilter } from '../src/problem-details-filter';

describe('Requests (integration)', () => {
  let app: INestApplication<App>;
  const prismaService = {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    location: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    balanceSnapshot: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    timeOffRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    auditEvent: {
      create: jest.fn(),
    },
    syncJob: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const hcmAdapter = {
    fetchBalance: jest.fn(),
    fetchBalanceCorpus: jest.fn(),
    submitTimeOffRequestToHcm: jest.fn(),
  };

  const employeeId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';
  const idempotencyKey = 'test-idempotency-key';

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(HcmAdapter)
      .useValue(hcmAdapter)
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .overrideGuard(EmployeeGuard)
      .useValue({
        canActivate: jest.fn().mockImplementation((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = { employeeId, role: 'employee' };
          return true;
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());

    await app.init();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /requests — Happy Path', () => {
    it('Returns 201 with request body when balance is sufficient.', async () => {
      const dto = {
        locationId,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        daysRequested: 5,
      };

      // Mock employee exists
      prismaService.employee.findUnique.mockResolvedValue({
        id: employeeId,
        hcmEmployeeId: 'hcm-emp-1',
        name: 'John Doe',
        email: 'john@example.com',
      });

      // Mock location exists
      prismaService.location.findUnique.mockResolvedValue({
        id: locationId,
        hcmLocationId: 'hcm-loc-1',
        name: 'Office',
        region: 'US',
      });

      // Mock balance sufficient
      prismaService.balanceSnapshot.findUnique.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock no conflicting requests
      prismaService.timeOffRequest.findMany.mockResolvedValue([]);

      // Mock request creation
      const createdRequest = {
        id: 'request-id',
        employeeId,
        locationId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
        createdAt: new Date(),
      };
      prismaService.timeOffRequest.create.mockResolvedValue(createdRequest);

      // Mock balance update
      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 5,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock audit event creation
      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId: 'request-id',
        actorId: employeeId,
        action: 'CREATED',
        prevStatus: null,
        newStatus: 'SUBMITTED',
        timestamp: new Date(),
        metadata: null,
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Idempotency-Key', idempotencyKey)
        .send(dto)
        .expect(201);

      expect(response.body.data).toMatchObject({
        id: 'request-id',
        employeeId,
        locationId,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-12-05T00:00:00.000Z',
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
      });

      expect(prismaService.timeOffRequest.create).toHaveBeenCalledWith({
        data: {
          employeeId,
          locationId,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          daysRequested: dto.daysRequested,
          status: 'SUBMITTED',
          idempotencyKey,
        },
      });

      expect(prismaService.balanceSnapshot.update).toHaveBeenCalledWith({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId,
          },
        },
        data: {
          pendingDays: {
            increment: dto.daysRequested,
          },
        },
      });

      expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
        data: {
          requestId: 'request-id',
          actorId: employeeId,
          action: 'CREATED',
          newStatus: 'SUBMITTED',
        },
      });
    });

    it('Creates audit event with action=CREATED.', async () => {
      // Similar setup as above
      const dto = {
        locationId,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        daysRequested: 5,
      };

      prismaService.employee.findUnique.mockResolvedValue({
        id: employeeId,
        hcmEmployeeId: 'hcm-emp-1',
        name: 'John Doe',
        email: 'john@example.com',
      });

      prismaService.location.findUnique.mockResolvedValue({
        id: locationId,
        hcmLocationId: 'hcm-loc-1',
        name: 'Office',
        region: 'US',
      });

      prismaService.balanceSnapshot.findUnique.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock no conflicting requests
      prismaService.timeOffRequest.findMany.mockResolvedValue([]);

      const createdRequest = {
        id: 'request-id',
        employeeId,
        locationId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
        createdAt: new Date(),
      };
      prismaService.timeOffRequest.create.mockResolvedValue(createdRequest);

      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 5,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId: 'request-id',
        actorId: employeeId,
        action: 'CREATED',
        prevStatus: null,
        newStatus: 'SUBMITTED',
        timestamp: new Date(),
        metadata: null,
      });

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Idempotency-Key', idempotencyKey)
        .send(dto)
        .expect(201);

      expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
        data: {
          requestId: 'request-id',
          actorId: employeeId,
          action: 'CREATED',
          newStatus: 'SUBMITTED',
        },
      });
    });

    it('Increments pending_days on balance_snapshot.', async () => {
      const dto = {
        locationId,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        daysRequested: 5,
      };

      prismaService.employee.findUnique.mockResolvedValue({
        id: employeeId,
        hcmEmployeeId: 'hcm-emp-1',
        name: 'John Doe',
        email: 'john@example.com',
      });

      prismaService.location.findUnique.mockResolvedValue({
        id: locationId,
        hcmLocationId: 'hcm-loc-1',
        name: 'Office',
        region: 'US',
      });

      prismaService.balanceSnapshot.findUnique.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 2,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock no conflicting requests
      prismaService.timeOffRequest.findMany.mockResolvedValue([]);

      const createdRequest = {
        id: 'request-id',
        employeeId,
        locationId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
        createdAt: new Date(),
      };
      prismaService.timeOffRequest.create.mockResolvedValue(createdRequest);

      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 7, // 2 + 5
        hcmSyncedAt: new Date(),
        version: 1,
      });

      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId: 'request-id',
        actorId: employeeId,
        action: 'CREATED',
        prevStatus: null,
        newStatus: 'SUBMITTED',
        timestamp: new Date(),
        metadata: null,
      });

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Idempotency-Key', idempotencyKey)
        .send(dto)
        .expect(201);

      expect(prismaService.balanceSnapshot.update).toHaveBeenCalledWith({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId,
          },
        },
        data: {
          pendingDays: {
            increment: dto.daysRequested,
          },
        },
      });
    });

    it('Second POST with same Idempotency-Key returns 200 with original request.', async () => {
      const dto = {
        locationId,
        startDate: '2026-12-01',
        endDate: '2026-12-05',
        daysRequested: 5,
      };

      // Mock employee exists
      prismaService.employee.findUnique.mockResolvedValue({
        id: employeeId,
        hcmEmployeeId: 'hcm-emp-1',
        name: 'John Doe',
        email: 'john@example.com',
      });

      // Mock location exists
      prismaService.location.findUnique.mockResolvedValue({
        id: locationId,
        hcmLocationId: 'hcm-loc-1',
        name: 'Office',
        region: 'US',
      });

      // Mock balance sufficient
      prismaService.balanceSnapshot.findUnique.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock no conflicting requests
      prismaService.timeOffRequest.findMany.mockResolvedValue([]);

      // First call creates
      const createdRequest = {
        id: 'request-id',
        employeeId,
        locationId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
        createdAt: new Date(),
      };
      prismaService.timeOffRequest.create.mockResolvedValueOnce(createdRequest);

      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 5,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId: 'request-id',
        actorId: employeeId,
        action: 'CREATED',
        prevStatus: null,
        newStatus: 'SUBMITTED',
        timestamp: new Date(),
        metadata: null,
      });

      // First POST
      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Idempotency-Key', idempotencyKey)
        .send(dto)
        .expect(201);

      // Second POST with same key
      // Mock create to throw unique constraint
      const error = new Error('Unique constraint failed');
      (error as any).code = 'P2002';
      (error as any).meta = { target: ['idempotencyKey'] };
      prismaService.timeOffRequest.create.mockRejectedValueOnce(error);

      // Mock find existing
      prismaService.timeOffRequest.findUnique.mockResolvedValue(createdRequest);

      const response = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Idempotency-Key', idempotencyKey)
        .send(dto)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: 'request-id',
        employeeId,
        locationId,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-12-05T00:00:00.000Z',
        daysRequested: dto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
      });

      // Ensure create was not called again, balance not updated again, audit not created again
      expect(prismaService.timeOffRequest.create).toHaveBeenCalledTimes(2); // once success, once fail
      expect(prismaService.balanceSnapshot.update).toHaveBeenCalledTimes(1);
      expect(prismaService.auditEvent.create).toHaveBeenCalledTimes(1);
    });
    describe('POST /requests — Error Cases', () => {
      it('Returns 422 with problem-detail body when balance is insufficient.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-01',
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        prismaService.employee.findUnique.mockResolvedValue({
          id: employeeId,
          hcmEmployeeId: 'hcm-emp-1',
          name: 'John Doe',
          email: 'john@example.com',
        });

        prismaService.location.findUnique.mockResolvedValue({
          id: locationId,
          hcmLocationId: 'hcm-loc-1',
          name: 'Office',
          region: 'US',
        });

        // Mock insufficient balance
        prismaService.balanceSnapshot.findUnique.mockResolvedValue({
          id: 'balance-id',
          employeeId,
          locationId,
          availableDays: 3, // less than 5
          pendingDays: 0,
          hcmSyncedAt: new Date(),
          version: 1,
        });

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(422);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.10',
        );
        expect(response.body).toHaveProperty('title', 'Unprocessable Entity');
        expect(response.body).toHaveProperty('detail', 'Insufficient balance.');
      });

      it('Returns 409 when a conflicting PENDING request covers overlapping dates.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-01',
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        prismaService.employee.findUnique.mockResolvedValue({
          id: employeeId,
          hcmEmployeeId: 'hcm-emp-1',
          name: 'John Doe',
          email: 'john@example.com',
        });

        prismaService.location.findUnique.mockResolvedValue({
          id: locationId,
          hcmLocationId: 'hcm-loc-1',
          name: 'Office',
          region: 'US',
        });

        prismaService.balanceSnapshot.findUnique.mockResolvedValue({
          id: 'balance-id',
          employeeId,
          locationId,
          availableDays: 10,
          pendingDays: 0,
          hcmSyncedAt: new Date(),
          version: 1,
        });

        // Mock conflicting request
        prismaService.timeOffRequest.findMany.mockResolvedValue([
          {
            id: 'existing-id',
            employeeId,
            locationId,
            startDate: new Date('2024-12-02'),
            endDate: new Date('2024-12-04'),
            daysRequested: 3,
            status: 'SUBMITTED',
            hcmSubmitted: false,
            idempotencyKey: 'other-key',
            createdAt: new Date(),
          },
        ]);

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(409);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.8',
        );
        expect(response.body).toHaveProperty('title', 'Conflict');
        expect(response.body).toHaveProperty(
          'detail',
          'Conflicting pending request covers overlapping dates.',
        );
      });

      it('Returns 422 when startDate is in the past.', async () => {
        const dto = {
          locationId,
          startDate: '2024-01-01', // past date
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        prismaService.employee.findUnique.mockResolvedValue({
          id: employeeId,
          hcmEmployeeId: 'hcm-emp-1',
          name: 'John Doe',
          email: 'john@example.com',
        });

        prismaService.location.findUnique.mockResolvedValue({
          id: locationId,
          hcmLocationId: 'hcm-loc-1',
          name: 'Office',
          region: 'US',
        });

        // Mock no conflicting requests
        prismaService.timeOffRequest.findMany.mockResolvedValue([]);

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(422);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.10',
        );
        expect(response.body).toHaveProperty('title', 'Unprocessable Entity');
        expect(response.body).toHaveProperty(
          'detail',
          'startDate must not be in the past.',
        );
      });

      it('Returns 422 when endDate is before startDate.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-05',
          endDate: '2024-12-01', // before start
          daysRequested: 5,
        };

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(422);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.10',
        );
        expect(response.body).toHaveProperty('title', 'Unprocessable Entity');
        expect(response.body).toHaveProperty(
          'detail',
          'startDate must be before endDate.',
        );
      });

      it('Returns 404 when employeeId does not exist.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-01',
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        // Mock employee not found
        prismaService.employee.findUnique.mockResolvedValue(null);

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(404);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.4',
        );
        expect(response.body).toHaveProperty('title', 'Not Found');
        expect(response.body).toHaveProperty('detail', 'Employee not found.');
      });

      it('Returns 404 when locationId does not exist.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-01',
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        prismaService.employee.findUnique.mockResolvedValue({
          id: employeeId,
          hcmEmployeeId: 'hcm-emp-1',
          name: 'John Doe',
          email: 'john@example.com',
        });

        // Mock location not found
        prismaService.location.findUnique.mockResolvedValue(null);

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Idempotency-Key', idempotencyKey)
          .send(dto)
          .expect(404);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.4',
        );
        expect(response.body).toHaveProperty('title', 'Not Found');
        expect(response.body).toHaveProperty('detail', 'Location not found.');
      });

      it('Returns 400 when Idempotency-Key header is missing.', async () => {
        const dto = {
          locationId,
          startDate: '2024-12-01',
          endDate: '2024-12-05',
          daysRequested: 5,
        };

        const response = await request(app.getHttpServer())
          .post('/api/v1/requests')
          .send(dto)
          .expect(400);

        expect(response.body).toHaveProperty(
          'type',
          'https://tools.ietf.org/html/rfc7231#section-6.5.1',
        );
        expect(response.body).toHaveProperty('title', 'Bad Request');
        expect(response.body).toHaveProperty(
          'detail',
          'Idempotency-Key header is required.',
        );
      });
    });
  });
});
