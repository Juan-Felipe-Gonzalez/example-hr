import { Injectable } from '@nestjs/common';

type CachedIdempotencyResponse = {
  statusCode: number;
  body: unknown;
};

type IdempotencyRecord = CachedIdempotencyResponse & {
  key: string;
  requestId?: string;
  createdAt: Date;
};

type StoreIdempotencyInput = {
  key: string;
  requestId?: string;
  statusCode: number;
  body: unknown;
  now?: Date;
};

type ExecuteInput<TBody> = {
  key: string;
  requestId?: string;
  now?: Date;
  create: () => Promise<{
    statusCode: number;
    body: TBody;
    requestId?: string;
  }>;
};

@Injectable()
export class IdempotencyService {
  private readonly ttlMs = 24 * 60 * 60 * 1000;
  private readonly records = new Map<string, IdempotencyRecord>();

  getCachedResponse(
    key: string,
    now: Date = new Date(),
  ): CachedIdempotencyResponse | null {
    const record = this.records.get(key);

    if (!record) {
      return null;
    }

    if (this.isExpired(record, now)) {
      this.records.delete(key);
      return null;
    }

    return {
      statusCode: 200,
      body: record.body,
    };
  }

  storeResponse(input: StoreIdempotencyInput) {
    const createdAt = input.now ?? new Date();

    this.records.set(input.key, {
      key: input.key,
      requestId: input.requestId,
      statusCode: input.statusCode,
      body: input.body,
      createdAt,
    });
  }

  async execute<TBody>(
    input: ExecuteInput<TBody>,
  ): Promise<CachedIdempotencyResponse> {
    const cached = this.getCachedResponse(input.key, input.now);

    if (cached) {
      return cached;
    }

    const created = await input.create();

    this.storeResponse({
      key: input.key,
      requestId: created.requestId ?? input.requestId,
      statusCode: created.statusCode,
      body: created.body,
      now: input.now,
    });

    return {
      statusCode: created.statusCode,
      body: created.body,
    };
  }

  private isExpired(record: IdempotencyRecord, now: Date) {
    return now.getTime() - record.createdAt.getTime() > this.ttlMs;
  }
}
