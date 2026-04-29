import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HcmAdapter } from './hcm.adapter';
import { PrismaService } from './prisma/prisma.service';

type ReconciliationAnomaly = {
  employeeId: string;
  locationId: string;
  type: 'NEGATIVE_EFFECTIVE_BALANCE';
  effectiveBalance: number;
};

type ReconcileResponse = {
  status: 'succeeded' | 'failed';
  recordsSynced: number;
  anomalies: ReconciliationAnomaly[];
};

@Injectable()
export class ReconcilerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmAdapter: HcmAdapter,
  ) {}

  async reconcile(): Promise<ReconcileResponse> {
    const job = await this.prisma.syncJob.create({
      data: {
        type: 'batch',
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      const [employees, locations, localSnapshots] = await Promise.all([
        this.prisma.employee.findMany(),
        this.prisma.location.findMany(),
        this.prisma.balanceSnapshot.findMany(),
      ]);

      const hcmBalances = await this.hcmAdapter.fetchBalanceCorpus(
        employees,
        locations,
      );
      const anomalies: ReconciliationAnomaly[] = [];

      for (const hcmBalance of hcmBalances) {
        const localSnapshot = localSnapshots.find(
          (snapshot) =>
            snapshot.employeeId === hcmBalance.employeeId &&
            snapshot.locationId === hcmBalance.locationId,
        );

        const pendingDays = localSnapshot?.pendingDays ?? 0;
        const effectiveBalance = hcmBalance.availableDays - pendingDays;

        if (effectiveBalance < 0) {
          anomalies.push({
            employeeId: hcmBalance.employeeId,
            locationId: hcmBalance.locationId,
            type: 'NEGATIVE_EFFECTIVE_BALANCE',
            effectiveBalance,
          });
        }

        if (
          !localSnapshot ||
          localSnapshot.availableDays !== hcmBalance.availableDays
        ) {
          await this.prisma.balanceSnapshot.upsert({
            where: {
              employeeId_locationId: {
                employeeId: hcmBalance.employeeId,
                locationId: hcmBalance.locationId,
              },
            },
            update: {
              availableDays: hcmBalance.availableDays,
              hcmSyncedAt: hcmBalance.hcmSyncedAt,
              version: {
                increment: 1,
              },
            },
            create: {
              employeeId: hcmBalance.employeeId,
              locationId: hcmBalance.locationId,
              availableDays: hcmBalance.availableDays,
              pendingDays,
              hcmSyncedAt: hcmBalance.hcmSyncedAt,
              version: 1,
            },
          });
        }
      }

      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'succeeded',
          completedAt: new Date(),
          recordsSynced: hcmBalances.length,
          errors: anomalies.length > 0 ? anomalies : Prisma.JsonNull,
        },
      });

      return {
        status: 'succeeded',
        recordsSynced: hcmBalances.length,
        anomalies,
      };
    } catch (error) {
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errors: [
            {
              message:
                error instanceof Error
                  ? error.message
                  : 'Reconciliation failed unexpectedly.',
            },
          ],
        },
      });

      return {
        status: 'failed',
        recordsSynced: 0,
        anomalies: [],
      };
    }
  }
}
