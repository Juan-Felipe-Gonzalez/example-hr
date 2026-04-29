import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { HcmAdapter } from '../hcm.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { ReconcilerService } from '../reconciler.service';

describe('ReconcilerService', () => {
  let service: ReconcilerService;

  const employee = {
    id: '11111111-1111-1111-1111-111111111111',
    hcmEmployeeId: 'hcm-emp-1',
    name: 'John Doe',
    email: 'john@example.com',
  };
  const location = {
    id: '22222222-2222-2222-2222-222222222222',
    hcmLocationId: 'hcm-loc-1',
    name: 'Office',
    region: 'US',
  };
  const localSnapshot = {
    id: 'balance-id',
    employeeId: employee.id,
    locationId: location.id,
    availableDays: 10,
    pendingDays: 3,
    hcmSyncedAt: new Date('2026-04-28T10:00:00.000Z'),
    version: 1,
  };
  const syncJob = {
    id: 'sync-job-id',
    type: 'batch',
    status: 'running',
    startedAt: new Date('2026-04-29T10:00:00.000Z'),
    completedAt: null,
    recordsSynced: 0,
    errors: null,
  };

  const prismaService = {
    employee: {
      findMany: jest.fn(),
    },
    location: {
      findMany: jest.fn(),
    },
    balanceSnapshot: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    syncJob: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const hcmAdapter = {
    fetchBalanceCorpus: jest.fn(),
  };

  beforeEach(() => {
    service = new ReconcilerService(
      prismaService as unknown as PrismaService,
      hcmAdapter as unknown as HcmAdapter,
    );
    jest.clearAllMocks();

    prismaService.employee.findMany.mockResolvedValue([employee]);
    prismaService.location.findMany.mockResolvedValue([location]);
    prismaService.balanceSnapshot.findMany.mockResolvedValue([localSnapshot]);
    prismaService.syncJob.create.mockResolvedValue(syncJob);
    prismaService.syncJob.update.mockResolvedValue({
      ...syncJob,
      status: 'succeeded',
      completedAt: new Date(),
    });
  });

  it('reconcile updates local snapshot when HCM balance differs.', async () => {
    const hcmSyncedAt = new Date('2026-04-29T10:00:00.000Z');
    hcmAdapter.fetchBalanceCorpus.mockResolvedValue([
      {
        employeeId: employee.id,
        locationId: location.id,
        availableDays: 12,
        pendingDays: 0,
        hcmSyncedAt,
      },
    ]);

    await service.reconcile();

    expect(prismaService.balanceSnapshot.upsert).toHaveBeenCalledWith({
      where: {
        employeeId_locationId: {
          employeeId: employee.id,
          locationId: location.id,
        },
      },
      update: {
        availableDays: 12,
        hcmSyncedAt,
        version: {
          increment: 1,
        },
      },
      create: {
        employeeId: employee.id,
        locationId: location.id,
        availableDays: 12,
        pendingDays: localSnapshot.pendingDays,
        hcmSyncedAt,
        version: 1,
      },
    });
  });

  it('reconcile flags anomaly when effective balance goes negative post-reconciliation.', async () => {
    hcmAdapter.fetchBalanceCorpus.mockResolvedValue([
      {
        employeeId: employee.id,
        locationId: location.id,
        availableDays: 2,
        pendingDays: 0,
        hcmSyncedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);

    await expect(service.reconcile()).resolves.toMatchObject({
      status: 'succeeded',
      anomalies: [
        {
          employeeId: employee.id,
          locationId: location.id,
          type: 'NEGATIVE_EFFECTIVE_BALANCE',
          effectiveBalance: -1,
        },
      ],
    });
  });

  it('reconcile does not modify PENDING request count during reconciliation.', async () => {
    hcmAdapter.fetchBalanceCorpus.mockResolvedValue([
      {
        employeeId: employee.id,
        locationId: location.id,
        availableDays: 12,
        pendingDays: 99,
        hcmSyncedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);

    await service.reconcile();

    expect(prismaService.balanceSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.not.objectContaining({
          pendingDays: expect.anything(),
        }),
      }),
    );
  });

  it('reconcile records a sync_job record with correct status and record count.', async () => {
    hcmAdapter.fetchBalanceCorpus.mockResolvedValue([
      {
        employeeId: employee.id,
        locationId: location.id,
        availableDays: 12,
        pendingDays: 0,
        hcmSyncedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
      {
        employeeId: '33333333-3333-3333-3333-333333333333',
        locationId: location.id,
        availableDays: 8,
        pendingDays: 0,
        hcmSyncedAt: new Date('2026-04-29T10:00:00.000Z'),
      },
    ]);

    await service.reconcile();

    expect(prismaService.syncJob.create).toHaveBeenCalledWith({
      data: {
        type: 'batch',
        status: 'running',
        startedAt: expect.any(Date),
      },
    });
    expect(prismaService.syncJob.update).toHaveBeenCalledWith({
      where: { id: syncJob.id },
      data: {
        status: 'succeeded',
        completedAt: expect.any(Date),
        recordsSynced: 2,
        errors: Prisma.JsonNull,
      },
    });
  });
});
