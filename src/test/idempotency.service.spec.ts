import { describe, expect, it, jest } from '@jest/globals';
import { IdempotencyService } from '../idempotency.service';

describe('IdempotencyService', () => {
  it('duplicate key returns cached response body and 200 status.', async () => {
    const service = new IdempotencyService();
    const create = jest.fn().mockResolvedValue({
      statusCode: 201,
      body: {
        id: 'request-id',
        status: 'SUBMITTED',
      },
      requestId: 'request-id',
    });

    await service.execute({
      key: 'idempotency-key',
      now: new Date('2026-04-29T10:00:00.000Z'),
      create,
    });

    await expect(
      service.execute({
        key: 'idempotency-key',
        now: new Date('2026-04-29T11:00:00.000Z'),
        create,
      }),
    ).resolves.toEqual({
      statusCode: 200,
      body: {
        id: 'request-id',
        status: 'SUBMITTED',
      },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('expired key (>24h) is not treated as duplicate.', async () => {
    const service = new IdempotencyService();
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        statusCode: 201,
        body: {
          id: 'original-request-id',
          status: 'SUBMITTED',
        },
        requestId: 'original-request-id',
      })
      .mockResolvedValueOnce({
        statusCode: 201,
        body: {
          id: 'new-request-id',
          status: 'SUBMITTED',
        },
        requestId: 'new-request-id',
      });

    await service.execute({
      key: 'idempotency-key',
      now: new Date('2026-04-29T10:00:00.000Z'),
      create,
    });

    await expect(
      service.execute({
        key: 'idempotency-key',
        now: new Date('2026-04-30T10:00:01.000Z'),
        create,
      }),
    ).resolves.toEqual({
      statusCode: 201,
      body: {
        id: 'new-request-id',
        status: 'SUBMITTED',
      },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('new key is stored alongside request creation.', async () => {
    const service = new IdempotencyService();
    const body = {
      id: 'request-id',
      status: 'SUBMITTED',
    };

    await service.execute({
      key: 'idempotency-key',
      requestId: 'request-id',
      now: new Date('2026-04-29T10:00:00.000Z'),
      create: jest.fn().mockResolvedValue({
        statusCode: 201,
        body,
      }),
    });

    expect(
      service.getCachedResponse(
        'idempotency-key',
        new Date('2026-04-29T10:05:00.000Z'),
      ),
    ).toEqual({
      statusCode: 200,
      body,
    });
  });
});
