import { jest, describe, it, beforeEach, expect } from '@jest/globals';
import { BalancesService } from '../balances.service';
import { PrismaService } from '../prisma/prisma.service';
import { HcmAdapter } from '../hcm.adapter';

describe('BalancesService', () => {
  let service: BalancesService;

  const prismaService = {
    balanceSnapshot: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    timeOffRequest: {
      findMany: jest.fn(),
    },
  };

  const hcmAdapter = {
    fetchBalance: jest.fn(),
    fetchBalanceCorpus: jest.fn(),
    submitDeduction: jest.fn(),
    submitTimeOffRequestToHcm: jest.fn(),
  };

  const requestDto = {
    employeeId: '11111111-1111-1111-1111-111111111111',
    locationId: '22222222-2222-2222-2222-222222222222',
    startDate: new Date('2026-12-01'),
    endDate: new Date('2026-12-05'),
    daysRequested: 5,
  };

  beforeEach(() => {
    service = new BalancesService(
      prismaService as unknown as PrismaService,
      hcmAdapter as unknown as HcmAdapter,
    );
    jest.clearAllMocks();
  });

  it('validateRequest returns OK when available >= requested and no date overlap.', async () => {
    prismaService.balanceSnapshot.findUnique.mockResolvedValue({
      id: 'balance-id',
      employeeId: requestDto.employeeId,
      locationId: requestDto.locationId,
      availableDays: 10,
      pendingDays: 0,
      hcmSyncedAt: new Date(),
      version: 1,
    });
    prismaService.timeOffRequest.findMany.mockResolvedValue([]);

    await expect(service.validateRequest(requestDto)).resolves.toEqual({
      status: 'OK',
    });
  });

  it('validateRequest returns INSUFFICIENT_BALANCE when pending reduces below threshold.', async () => {
    prismaService.balanceSnapshot.findUnique.mockResolvedValue({
      id: 'balance-id',
      employeeId: requestDto.employeeId,
      locationId: requestDto.locationId,
      availableDays: 6,
      pendingDays: 2,
      hcmSyncedAt: new Date(),
      version: 1,
    });

    await expect(service.validateRequest(requestDto)).resolves.toEqual({
      status: 'INSUFFICIENT_BALANCE',
    });
    expect(prismaService.timeOffRequest.findMany).not.toHaveBeenCalled();
  });

  it('validateRequest returns DATE_OVERLAP when an existing PENDING request covers the same dates.', async () => {
    prismaService.balanceSnapshot.findUnique.mockResolvedValue({
      id: 'balance-id',
      employeeId: requestDto.employeeId,
      locationId: requestDto.locationId,
      availableDays: 10,
      pendingDays: 0,
      hcmSyncedAt: new Date(),
      version: 1,
    });
    prismaService.timeOffRequest.findMany.mockResolvedValue([
      {
        id: 'request-id',
        employeeId: requestDto.employeeId,
        locationId: requestDto.locationId,
        startDate: requestDto.startDate,
        endDate: requestDto.endDate,
        daysRequested: requestDto.daysRequested,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey: 'idempotency-key',
        createdAt: new Date(),
      },
    ]);

    await expect(service.validateRequest(requestDto)).resolves.toEqual({
      status: 'DATE_OVERLAP',
    });
  });

  it('validateRequest returns INVALID_LOCATION when employee is not assigned to the requested location.', async () => {
    prismaService.balanceSnapshot.findUnique.mockResolvedValue(null);

    await expect(service.validateRequest(requestDto)).resolves.toEqual({
      status: 'INVALID_LOCATION',
    });
    expect(prismaService.timeOffRequest.findMany).not.toHaveBeenCalled();
  });

  it('applyOptimisticLock retries correctly when version mismatch occurs once.', async () => {
    prismaService.balanceSnapshot.findUnique
      .mockResolvedValueOnce({
        id: 'balance-id',
        employeeId: requestDto.employeeId,
        locationId: requestDto.locationId,
        availableDays: 10,
        pendingDays: 5,
        hcmSyncedAt: new Date(),
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'balance-id',
        employeeId: requestDto.employeeId,
        locationId: requestDto.locationId,
        availableDays: 10,
        pendingDays: 5,
        hcmSyncedAt: new Date(),
        version: 2,
      });
    prismaService.balanceSnapshot.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      service.applyOptimisticLock({
        employeeId: requestDto.employeeId,
        locationId: requestDto.locationId,
        data: {
          pendingDays: {
            decrement: requestDto.daysRequested,
          },
        },
      }),
    ).resolves.toEqual({ status: 'OK' });
    expect(prismaService.balanceSnapshot.updateMany).toHaveBeenCalledTimes(2);
  });

  it('applyOptimisticLock returns CONFLICT after 3 failed version-match attempts.', async () => {
    prismaService.balanceSnapshot.findUnique.mockResolvedValue({
      id: 'balance-id',
      employeeId: requestDto.employeeId,
      locationId: requestDto.locationId,
      availableDays: 10,
      pendingDays: 5,
      hcmSyncedAt: new Date(),
      version: 1,
    });
    prismaService.balanceSnapshot.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.applyOptimisticLock({
        employeeId: requestDto.employeeId,
        locationId: requestDto.locationId,
        data: {
          pendingDays: {
            decrement: requestDto.daysRequested,
          },
        },
      }),
    ).resolves.toEqual({ status: 'CONFLICT' });
    expect(prismaService.balanceSnapshot.updateMany).toHaveBeenCalledTimes(3);
  });
});
