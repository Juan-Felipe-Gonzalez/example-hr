import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import {
  IllegalTransitionException,
  RequestsService,
} from '../requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { HcmAdapter } from '../hcm.adapter';
import { TimeOffRequest } from '@prisma/client';

describe('RequestsService State Machine', () => {
  let service: RequestsService;

  const prismaService = {};
  const hcmAdapter = {};

  const baseRequest: TimeOffRequest = {
    id: '33333333-3333-3333-3333-333333333333',
    employeeId: '11111111-1111-1111-1111-111111111111',
    locationId: '22222222-2222-2222-2222-222222222222',
    startDate: new Date('2026-12-01'),
    endDate: new Date('2026-12-05'),
    daysRequested: 5,
    status: 'SUBMITTED',
    hcmSubmitted: false,
    idempotencyKey: 'test-idempotency-key',
    createdAt: new Date('2026-04-01'),
  };

  beforeEach(() => {
    service = new RequestsService(
      prismaService as PrismaService,
      hcmAdapter as HcmAdapter,
    );
    jest.clearAllMocks();
  });

  it('approve() throws IllegalTransitionException when request status is REJECTED.', () => {
    expect(() =>
      service.approve({
        ...baseRequest,
        status: 'REJECTED',
      }),
    ).toThrow(IllegalTransitionException);
  });

  it('approve() throws IllegalTransitionException when request status is CANCELLED.', () => {
    expect(() =>
      service.approve({
        ...baseRequest,
        status: 'CANCELLED',
      }),
    ).toThrow(IllegalTransitionException);
  });

  it('approve() throws IllegalTransitionException when request status is APPROVED.', () => {
    expect(() =>
      service.approve({
        ...baseRequest,
        status: 'APPROVED',
      }),
    ).toThrow(IllegalTransitionException);
  });

  it('cancel() succeeds for PENDING request.', () => {
    expect(service.cancel(baseRequest)).toEqual({
      status: 'CANCELLED',
    });
  });

  it('cancel() succeeds for APPROVED request within cancellation window.', () => {
    expect(
      service.cancel(
        {
          ...baseRequest,
          status: 'APPROVED',
          hcmSubmitted: true,
          startDate: new Date('2026-12-01'),
        },
        new Date('2026-11-30'),
      ),
    ).toEqual({
      status: 'CANCELLED',
    });
  });

  it('cancel() fails for APPROVED request beyond cancellation window.', () => {
    expect(() =>
      service.cancel(
        {
          ...baseRequest,
          status: 'APPROVED',
          hcmSubmitted: true,
          startDate: new Date('2026-12-01'),
        },
        new Date('2026-12-01'),
      ),
    ).toThrow(IllegalTransitionException);
  });
});
