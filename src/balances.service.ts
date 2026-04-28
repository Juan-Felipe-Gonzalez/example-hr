import { Injectable, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import { HcmAdapter } from './hcm.adapter';

type BalanceResponse = {
  data: {
    employeeId: string;
    locationId: string;
    availableDays: number;
    pendingDays: number;
    hcmSyncedAt: string;
    version: number;
  };
};

type EmployeeBalancesResponse = {
  data: Array<BalanceResponse['data']>;
};

type BatchSyncResponse = {
  data: {
    jobId: string;
  };
};

type BatchSyncStatusResponse = {
  data: {
    jobId: string;
    type: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    recordsSynced: number;
    errors: Prisma.JsonValue | null;
  };
};

@Injectable()
export class BalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmAdapter: HcmAdapter,
  ) {}

  // Refreshes a single employee/location balance from HCM before responding.
  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceResponse> {
    const employee = await this.getEmployeeOrThrow(employeeId);
    const location = await this.getLocationOrThrow(locationId);
    const snapshot = await this.refreshBalanceSnapshot(employee, location);

    return {
      data: {
        employeeId,
        locationId,
        availableDays: snapshot.availableDays,
        pendingDays: snapshot.pendingDays,
        hcmSyncedAt: snapshot.hcmSyncedAt.toISOString(),
        version: snapshot.version,
      },
    };
  }

  // Refreshes all balances for an employee across every known location.
  async getEmployeeBalances(
    employeeId: string,
  ): Promise<EmployeeBalancesResponse> {
    const employee = await this.getEmployeeOrThrow(employeeId);
    const locations = await this.prisma.location.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    const balances = await Promise.all(
      locations.map(async (location) => {
        const snapshot = await this.refreshBalanceSnapshot(employee, location);

        return {
          employeeId,
          locationId: location.id,
          availableDays: snapshot.availableDays,
          pendingDays: snapshot.pendingDays,
          hcmSyncedAt: snapshot.hcmSyncedAt.toISOString(),
          version: snapshot.version,
        };
      }),
    );

    return {
      data: balances,
    };
  }

  // Creates a sync job record and starts reconciliation in the background.
  async triggerBatchSync(): Promise<BatchSyncResponse> {
    const job = await this.prisma.syncJob.create({
      data: {
        type: 'batch',
        status: 'running',
        startedAt: new Date(),
      },
    });

    void this.runBatchSync(job.id);

    return {
      data: {
        jobId: job.id,
      },
    };
  }

  // Returns the latest persisted status for a previously triggered sync job.
  async getBatchSyncStatus(jobId: string): Promise<BatchSyncStatusResponse> {
    const job = await this.prisma.syncJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException('Sync job not found.');
    }

    return {
      data: {
        jobId: job.id,
        type: job.type,
        status: job.status,
        startedAt: job.startedAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        recordsSynced: job.recordsSynced,
        errors: job.errors === null ? null : job.errors,
      },
    };
  }

  private async getEmployeeOrThrow(employeeId: string) {
    /**
     * Retrieves an employee by ID or throws NotFoundException if not found.
     * Used to validate employee existence before balance operations.
     */
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }

    return employee;
  }

  private async getLocationOrThrow(locationId: string) {
    /**
     * Retrieves a location by ID or throws NotFoundException if not found.
     * Used to validate location existence before balance operations.
     */
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    return location;
  }

  private async refreshBalanceSnapshot(
    employee: { id: string; hcmEmployeeId: string },
    location: { id: string; hcmLocationId: string },
  ) {
    /**
     * Fetches the latest balance from HCM and updates the local snapshot.
     * Creates a new snapshot if none exists, or increments version on update.
     * This ensures real-time balance data for individual requests.
     */
    try {
      const freshBalance = await this.hcmAdapter.fetchBalance(employee.hcmEmployeeId, location.hcmLocationId);

      return this.prisma.balanceSnapshot.upsert({
        where: {
          employeeId_locationId: {
            employeeId: employee.id,
            locationId: location.id,
          },
        },
        update: {
          availableDays: freshBalance.availableDays,
          pendingDays: freshBalance.pendingDays,
          hcmSyncedAt: freshBalance.hcmSyncedAt,
          version: {
            increment: 1,
          },
        },
        create: {
          employeeId: employee.id,
          locationId: location.id,
          availableDays: freshBalance.availableDays,
          pendingDays: freshBalance.pendingDays,
          hcmSyncedAt: freshBalance.hcmSyncedAt,
          version: 1,
        },
      });
    } catch (error) {
      throw new HttpException('HCM system is currently unavailable.', HttpStatus.SERVICE_UNAVAILABLE, {
        headers: { 'retry-after': '300' },
      });
    }
  }

  // Reconciles the local snapshot cache against the latest HCM batch export.
  private async runBatchSync(jobId: string) {
    /**
     * Performs batch synchronization of all employee-location balances from HCM.
     * Updates the sync job status to 'succeeded' or 'failed' based on outcome.
     * This is an asynchronous background process triggered by admin endpoints.
     */
    try {
      const [employees, locations] = await Promise.all([
        this.prisma.employee.findMany(),
        this.prisma.location.findMany(),
      ]);

      const balances = await this.hcmAdapter.fetchBalanceCorpus(
        employees,
        locations,
      );

      await Promise.all(
        balances.map((balance) =>
          this.prisma.balanceSnapshot.upsert({
            where: {
              employeeId_locationId: {
                employeeId: balance.employeeId,
                locationId: balance.locationId,
              },
            },
            update: {
              availableDays: balance.availableDays,
              pendingDays: balance.pendingDays,
              hcmSyncedAt: balance.hcmSyncedAt,
              version: {
                increment: 1,
              },
            },
            create: {
              employeeId: balance.employeeId,
              locationId: balance.locationId,
              availableDays: balance.availableDays,
              pendingDays: balance.pendingDays,
              hcmSyncedAt: balance.hcmSyncedAt,
            },
          }),
        ),
      );

      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          completedAt: new Date(),
          recordsSynced: balances.length,
          errors: Prisma.JsonNull,
        },
      });
    } catch (error) {
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errors: [
            {
              message:
                error instanceof Error
                  ? error.message
                  : 'Batch sync failed unexpectedly.',
            },
          ],
        },
      });
    }
  }
}

