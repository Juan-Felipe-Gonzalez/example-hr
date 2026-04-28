/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HcmAdapter } from './../src/hcm.adapter';
import { ProblemDetailsFilter } from './../src/problem-details-filter';
import { MockHcmServer } from './mock-hcm-server';

describe('Balances endpoint (e2e)', () => {
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
      upsert: jest.fn(),
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
  };

  const employeeId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(HcmAdapter)
      .useValue(hcmAdapter)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('returns a fresh balance for the employee when the bearer token matches', () => {
    prismaService.employee.findUnique.mockResolvedValue({
      id: employeeId,
      hcmEmployeeId: 'HCM-EMP-100',
    });
    prismaService.location.findUnique.mockResolvedValue({
      id: locationId,
      hcmLocationId: 'HCM-LOC-200',
    });
    hcmAdapter.fetchBalance.mockResolvedValue({
      availableDays: 23,
      pendingDays: 2,
      hcmSyncedAt: new Date('2026-04-28T07:00:00.000Z'),
    });
    prismaService.balanceSnapshot.upsert.mockResolvedValue({
      employeeId,
      locationId,
      availableDays: 23,
      pendingDays: 2,
      hcmSyncedAt: new Date('2026-04-28T07:00:00.000Z'),
      version: 1,
    });

    return request(app.getHttpServer())
      .get(`/api/v1/balances/${employeeId}/${locationId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(200)
      .expect({
        data: {
          employeeId,
          locationId,
          availableDays: 23,
          pendingDays: 2,
          hcmSyncedAt: '2026-04-28T07:00:00.000Z',
          version: 1,
        },
      });
  });

  it('returns all location balances for an employee', () => {
    const secondLocationId = '33333333-3333-3333-3333-333333333333';

    prismaService.employee.findUnique.mockResolvedValue({
      id: employeeId,
      hcmEmployeeId: 'HCM-EMP-100',
    });
    prismaService.location.findMany.mockResolvedValue([
      {
        id: locationId,
        name: 'Austin',
        hcmLocationId: 'HCM-LOC-200',
      },
      {
        id: secondLocationId,
        name: 'Bogota',
        hcmLocationId: 'HCM-LOC-300',
      },
    ]);
    hcmAdapter.fetchBalance
      .mockResolvedValueOnce({
        availableDays: 23,
        pendingDays: 2,
        hcmSyncedAt: new Date('2026-04-28T07:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        availableDays: 17,
        pendingDays: 1,
        hcmSyncedAt: new Date('2026-04-28T07:05:00.000Z'),
      });
    prismaService.balanceSnapshot.upsert
      .mockResolvedValueOnce({
        employeeId,
        locationId,
        availableDays: 23,
        pendingDays: 2,
        hcmSyncedAt: new Date('2026-04-28T07:00:00.000Z'),
        version: 1,
      })
      .mockResolvedValueOnce({
        employeeId,
        locationId: secondLocationId,
        availableDays: 17,
        pendingDays: 1,
        hcmSyncedAt: new Date('2026-04-28T07:05:00.000Z'),
        version: 4,
      });

    return request(app.getHttpServer())
      .get(`/api/v1/balances/${employeeId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(200)
      .expect({
        data: [
          {
            employeeId,
            locationId,
            availableDays: 23,
            pendingDays: 2,
            hcmSyncedAt: '2026-04-28T07:00:00.000Z',
            version: 1,
          },
          {
            employeeId,
            locationId: secondLocationId,
            availableDays: 17,
            pendingDays: 1,
            hcmSyncedAt: '2026-04-28T07:05:00.000Z',
            version: 4,
          },
        ],
      });
  });

  it('returns RFC 7807 when the authorization header is missing', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/balances/${employeeId}/${locationId}`)
      .expect(401)
      .expect({
        type: 'https://httpstatuses.com/401',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing Authorization header.',
        instance: `/api/v1/balances/${employeeId}/${locationId}`,
      });
  });

  it('forbids an employee from reading another employee balance', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/balances/${employeeId}/${locationId}`)
      .set(
        'Authorization',
        'Bearer employee:99999999-9999-9999-9999-999999999999',
      )
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Employees can only access their own balances.',
        instance: `/api/v1/balances/${employeeId}/${locationId}`,
      });
  });

  it('forbids an employee from reading another employee balance collection', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/balances/${employeeId}`)
      .set(
        'Authorization',
        'Bearer employee:99999999-9999-9999-9999-999999999999',
      )
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Employees can only access their own balances.',
        instance: `/api/v1/balances/${employeeId}`,
      });
  });

  it('returns a job ID when an admin triggers batch sync', () => {
    prismaService.syncJob.create.mockResolvedValue({
      id: 'sync-job-1',
    });
    prismaService.employee.findMany.mockResolvedValue([
      {
        id: employeeId,
        hcmEmployeeId: 'HCM-EMP-100',
      },
    ]);
    prismaService.location.findMany.mockResolvedValue([
      {
        id: locationId,
        name: 'Austin',
        hcmLocationId: 'HCM-LOC-200',
      },
    ]);
    hcmAdapter.fetchBalanceCorpus.mockResolvedValue([
      {
        employeeId,
        locationId,
        availableDays: 18,
        pendingDays: 1,
        hcmSyncedAt: new Date('2026-04-28T07:10:00.000Z'),
      },
    ]);
    prismaService.balanceSnapshot.upsert.mockResolvedValue({
      employeeId,
      locationId,
      availableDays: 18,
      pendingDays: 1,
      hcmSyncedAt: new Date('2026-04-28T07:10:00.000Z'),
      version: 2,
    });
    prismaService.syncJob.update.mockResolvedValue({
      id: 'sync-job-1',
      status: 'succeeded',
    });

    return request(app.getHttpServer())
      .post('/api/v1/balances/batch-sync')
      .set('Authorization', 'Bearer admin')
      .expect(201)
      .expect({
        data: {
          jobId: 'sync-job-1',
        },
      });
  });

  it('forbids non-admin users from triggering batch sync', () => {
    return request(app.getHttpServer())
      .post('/api/v1/balances/batch-sync')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Admin role is required for this operation.',
        instance: '/api/v1/balances/batch-sync',
      });
  });

  it('returns sync job status for admins', () => {
    prismaService.syncJob.findUnique.mockResolvedValue({
      id: 'sync-job-1',
      type: 'batch',
      status: 'succeeded',
      startedAt: new Date('2026-04-28T07:10:00.000Z'),
      completedAt: new Date('2026-04-28T07:12:00.000Z'),
      recordsSynced: 1,
      errors: null,
    });

    return request(app.getHttpServer())
      .get('/api/v1/balances/sync-status/sync-job-1')
      .set('Authorization', 'Bearer admin')
      .expect(200)
      .expect({
        data: {
          jobId: 'sync-job-1',
          type: 'batch',
          status: 'succeeded',
          startedAt: '2026-04-28T07:10:00.000Z',
          completedAt: '2026-04-28T07:12:00.000Z',
          recordsSynced: 1,
          errors: null,
        },
      });
  });

  it('returns RFC 7807 when the sync job does not exist', () => {
    prismaService.syncJob.findUnique.mockResolvedValue(null);

    return request(app.getHttpServer())
      .get('/api/v1/balances/sync-status/missing-job')
      .set('Authorization', 'Bearer admin')
      .expect(404)
      .expect({
        type: 'https://httpstatuses.com/404',
        title: 'Not Found',
        status: 404,
        detail: 'Sync job not found.',
        instance: '/api/v1/balances/sync-status/missing-job',
      });
  });

  it('forbids non-admin users from reading sync job status', () => {
    return request(app.getHttpServer())
      .get('/api/v1/balances/sync-status/sync-job-1')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Admin role is required for this operation.',
        instance: '/api/v1/balances/sync-status/sync-job-1',
      });
  });
});

describe('Requests endpoint (e2e)', () => {
  let app: INestApplication<App>;
  const prismaService = {
    employee: {
      findUnique: jest.fn(),
    },
    location: {
      findUnique: jest.fn(),
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
  };
  const hcmAdapter = {
    submitTimeOffRequestToHcm: jest.fn(),
  };

  const employeeId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';
  const requestId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .overrideProvider(HcmAdapter)
      .useValue(hcmAdapter)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('creates a new time-off request for an employee', () => {
    const idempotencyKey = 'unique-key-123';
    const requestData = {
      locationId,
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      daysRequested: 5,
    };
    const createdRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey,
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.employee.findUnique.mockResolvedValue({
      id: employeeId,
      hcmEmployeeId: 'HCM-EMP-100',
    });
    prismaService.location.findUnique.mockResolvedValue({
      id: locationId,
      hcmLocationId: 'HCM-LOC-200',
    });
    prismaService.timeOffRequest.create.mockResolvedValue(createdRequest);

    return request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(requestData)
      .expect(201)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'SUBMITTED',
          hcmSubmitted: false,
          idempotencyKey,
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('returns existing request on idempotent create', () => {
    const idempotencyKey = 'existing-key-456';
    const requestData = {
      locationId,
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      daysRequested: 5,
    };
    const existingRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey,
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.employee.findUnique.mockResolvedValue({
      id: employeeId,
      hcmEmployeeId: 'HCM-EMP-100',
    });
    prismaService.location.findUnique.mockResolvedValue({
      id: locationId,
      hcmLocationId: 'HCM-LOC-200',
    });
    prismaService.timeOffRequest.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['idempotencyKey'] },
    });
    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);

    return request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(requestData)
      .expect(201)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'SUBMITTED',
          hcmSubmitted: false,
          idempotencyKey,
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('validates required Idempotency-Key header', () => {
    const requestData = {
      locationId,
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      daysRequested: 5,
    };

    return request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .send(requestData)
      .expect(400)
      .expect({
        type: 'https://httpstatuses.com/400',
        title: 'Bad Request',
        status: 400,
        detail: 'Idempotency-Key header is required.',
        instance: '/api/v1/requests',
      });
  });

  it('validates request data', () => {
    const requestData = {
      locationId,
      startDate: '2026-05-05',
      endDate: '2026-05-01', // Invalid: end before start
      daysRequested: 5,
    };

    return request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .set('Idempotency-Key', 'test-key')
      .send(requestData)
      .expect(400)
      .expect({
        type: 'https://httpstatuses.com/400',
        title: 'Bad Request',
        status: 400,
        detail: 'startDate must be before endDate.',
        instance: '/api/v1/requests',
      });
  });

  it('returns a single time-off request for the owner employee', () => {
    const existingRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);

    return request(app.getHttpServer())
      .get(`/api/v1/requests/${requestId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(200)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'SUBMITTED',
          hcmSubmitted: false,
          idempotencyKey: 'test-key',
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('forbids employee from accessing another employee request', () => {
    const existingRequest = {
      id: requestId,
      employeeId: 'different-employee-id',
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);

    return request(app.getHttpServer())
      .get(`/api/v1/requests/${requestId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Employees can only access their own requests.',
        instance: `/api/v1/requests/${requestId}`,
      });
  });

  it('allows manager to access any request', () => {
    const existingRequest = {
      id: requestId,
      employeeId: 'different-employee-id',
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);

    return request(app.getHttpServer())
      .get(`/api/v1/requests/${requestId}`)
      .set('Authorization', 'Bearer manager')
      .expect(200);
  });

  it('lists time-off requests for managers', () => {
    const requests = [
      {
        id: requestId,
        employeeId,
        locationId,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-05'),
        daysRequested: 5,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey: 'test-key',
        createdAt: new Date('2026-04-28T08:00:00.000Z'),
      },
    ];

    prismaService.timeOffRequest.findMany.mockResolvedValue(requests);

    return request(app.getHttpServer())
      .get('/api/v1/requests')
      .set('Authorization', 'Bearer manager')
      .expect(200)
      .expect({
        data: [
          {
            id: requestId,
            employeeId,
            locationId,
            startDate: '2026-05-01T00:00:00.000Z',
            endDate: '2026-05-05T00:00:00.000Z',
            daysRequested: 5,
            status: 'SUBMITTED',
            hcmSubmitted: false,
            idempotencyKey: 'test-key',
            createdAt: '2026-04-28T08:00:00.000Z',
          },
        ],
      });
  });

  it('filters requests by employeeId', () => {
    const requests = [
      {
        id: requestId,
        employeeId,
        locationId,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-05'),
        daysRequested: 5,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey: 'test-key',
        createdAt: new Date('2026-04-28T08:00:00.000Z'),
      },
    ];

    prismaService.timeOffRequest.findMany.mockResolvedValue(requests);

    return request(app.getHttpServer())
      .get(`/api/v1/requests?employeeId=${employeeId}`)
      .set('Authorization', 'Bearer manager')
      .expect(200)
      .expect((res) => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].employeeId).toBe(employeeId);
      });
  });

  it('approves a time-off request and submits to HCM', () => {
    const existingRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };
    const approvedRequest = {
      ...existingRequest,
      status: 'APPROVED',
      hcmSubmitted: true,
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue({
      ...existingRequest,
      employee: { hcmEmployeeId: 'HCM-EMP-100' },
      location: { hcmLocationId: 'HCM-LOC-200' },
    });
    hcmAdapter.submitTimeOffRequestToHcm.mockResolvedValue({
      success: true,
      hcmRequestId: 'HCM-REQ-123',
      submittedAt: new Date(),
    });
    prismaService.timeOffRequest.update.mockResolvedValue(approvedRequest);
    prismaService.auditEvent.create.mockResolvedValue({});

    return request(app.getHttpServer())
      .patch(`/api/v1/requests/${requestId}/approve`)
      .set('Authorization', 'Bearer manager')
      .expect(200)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'APPROVED',
          hcmSubmitted: true,
          idempotencyKey: 'test-key',
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('rejects a time-off request', () => {
    const existingRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };
    const rejectedRequest = {
      ...existingRequest,
      status: 'REJECTED',
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);
    prismaService.timeOffRequest.update.mockResolvedValue(rejectedRequest);
    prismaService.auditEvent.create.mockResolvedValue({});

    return request(app.getHttpServer())
      .patch(`/api/v1/requests/${requestId}/reject`)
      .set('Authorization', 'Bearer manager')
      .expect(200)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'REJECTED',
          hcmSubmitted: false,
          idempotencyKey: 'test-key',
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('cancels a time-off request by the owner employee', () => {
    const existingRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };
    const cancelledRequest = {
      ...existingRequest,
      status: 'CANCELLED',
    };

    prismaService.timeOffRequest.findUnique
      .mockResolvedValueOnce(existingRequest) // For authorization check
      .mockResolvedValueOnce(existingRequest); // For update
    prismaService.timeOffRequest.update.mockResolvedValue(cancelledRequest);
    prismaService.auditEvent.create.mockResolvedValue({});

    return request(app.getHttpServer())
      .delete(`/api/v1/requests/${requestId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(200)
      .expect({
        data: {
          id: requestId,
          employeeId,
          locationId,
          startDate: '2026-05-01T00:00:00.000Z',
          endDate: '2026-05-05T00:00:00.000Z',
          daysRequested: 5,
          status: 'CANCELLED',
          hcmSubmitted: false,
          idempotencyKey: 'test-key',
          createdAt: '2026-04-28T08:00:00.000Z',
        },
      });
  });

  it('allows admin to cancel any request', () => {
    const existingRequest = {
      id: requestId,
      employeeId: 'different-employee-id',
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };
    const cancelledRequest = {
      ...existingRequest,
      status: 'CANCELLED',
    };

    prismaService.timeOffRequest.findUnique
      .mockResolvedValueOnce(existingRequest) // For authorization check
      .mockResolvedValueOnce(existingRequest); // For update
    prismaService.timeOffRequest.update.mockResolvedValue(cancelledRequest);
    prismaService.auditEvent.create.mockResolvedValue({});

    return request(app.getHttpServer())
      .delete(`/api/v1/requests/${requestId}`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
  });

  it('forbids employee from cancelling another employee request', () => {
    const existingRequest = {
      id: requestId,
      employeeId: 'different-employee-id',
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'test-key',
      createdAt: new Date('2026-04-28T08:00:00.000Z'),
    };

    prismaService.timeOffRequest.findUnique.mockResolvedValue(existingRequest);

    return request(app.getHttpServer())
      .delete(`/api/v1/requests/${requestId}`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Employees can only cancel their own requests.',
        instance: `/api/v1/requests/${requestId}`,
      });
  });

  it('returns 404 for non-existent request', () => {
    prismaService.timeOffRequest.findUnique.mockResolvedValue(null);

    return request(app.getHttpServer())
      .get(`/api/v1/requests/${requestId}`)
      .set('Authorization', 'Bearer manager')
      .expect(404)
      .expect({
        type: 'https://httpstatuses.com/404',
        title: 'Not Found',
        status: 404,
        detail: 'Time-off request not found.',
        instance: `/api/v1/requests/${requestId}`,
      });
  });

  it('forbids non-manager from listing requests', () => {
    return request(app.getHttpServer())
      .get('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Manager or Admin role is required for this operation.',
        instance: '/api/v1/requests',
      });
  });

  it('forbids non-manager from approving requests', () => {
    return request(app.getHttpServer())
      .patch(`/api/v1/requests/${requestId}/approve`)
      .set('Authorization', `Bearer employee:${employeeId}`)
      .expect(403)
      .expect({
        type: 'https://httpstatuses.com/403',
        title: 'Forbidden',
        status: 403,
        detail: 'Manager or Admin role is required for this operation.',
        instance: `/api/v1/requests/${requestId}/approve`,
      });
  });
});

describe('Work Anniversary Balance Top-Up (e2e with mock HCM)', () => {
  let app: INestApplication<App>;
  let mockHcmServer: MockHcmServer;
  let hcmBaseUrl: string;

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
      upsert: jest.fn(),
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
  };

  const employeeId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    mockHcmServer = new MockHcmServer();
    hcmBaseUrl = await mockHcmServer.start();
    process.env.HCM_BASE_URL = hcmBaseUrl;
  });

  afterAll(async () => {
    await mockHcmServer.stop();
    delete process.env.HCM_BASE_URL;
  });

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('handles work anniversary balance top-up scenario', async () => {
    // Setup mock data
    prismaService.employee.findUnique.mockResolvedValue({
      id: employeeId,
      hcmEmployeeId: 'emp-1',
    });
    prismaService.location.findUnique.mockResolvedValue({
      id: locationId,
      hcmLocationId: 'loc-1',
    });

    // Step 13: Seed HCM with employee emp-1, location loc-1, balance=5 days
    await request(mockHcmServer.getApp().server)
      .post('/control')
      .send({
        action: 'set-balance',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 5,
      });

    // Step 14: Employee submits request for 4 days → 201
    const request1 = {
      id: 'req-1',
      employeeId,
      locationId,
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-04'),
      daysRequested: 4,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'key-1',
      createdAt: new Date('2026-04-28T09:00:00.000Z'),
    };

    prismaService.timeOffRequest.create.mockResolvedValue(request1);

    await request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .set('Idempotency-Key', 'key-1')
      .send({
        locationId,
        startDate: '2026-05-01',
        endDate: '2026-05-04',
        daysRequested: 4,
      })
      .expect(201);

    // Step 15: Mock HCM /control: trigger anniversary top-up → balance becomes 10
    await request(mockHcmServer.getApp().server)
      .post('/control')
      .send({
        action: 'top-up',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        topUp: 5,
      });

    // Step 16: Employee submits second request for 4 days → should succeed
    const request2 = {
      id: 'req-2',
      employeeId,
      locationId,
      startDate: new Date('2026-05-05'),
      endDate: new Date('2026-05-08'),
      daysRequested: 4,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey: 'key-2',
      createdAt: new Date('2026-04-28T10:00:00.000Z'),
    };

    prismaService.timeOffRequest.create.mockResolvedValue(request2);

    await request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer employee:${employeeId}`)
      .set('Idempotency-Key', 'key-2')
      .send({
        locationId,
        startDate: '2026-05-05',
        endDate: '2026-05-08',
        daysRequested: 4,
      })
      .expect(201);

    // Step 17: Manager approves both requests → both APPROVED, HCM balance = 10 - 4 - 4 = 2
    // Mock finding requests for approval
    prismaService.timeOffRequest.findUnique
      .mockResolvedValueOnce({
        ...request1,
        employee: { hcmEmployeeId: 'emp-1' },
        location: { hcmLocationId: 'loc-1' },
      })
      .mockResolvedValueOnce({
        ...request2,
        employee: { hcmEmployeeId: 'emp-1' },
        location: { hcmLocationId: 'loc-1' },
      });

    // Mock updates
    prismaService.timeOffRequest.update
      .mockResolvedValueOnce({
        ...request1,
        status: 'APPROVED',
        hcmSubmitted: true,
      })
      .mockResolvedValueOnce({
        ...request2,
        status: 'APPROVED',
        hcmSubmitted: true,
      });

    prismaService.auditEvent.create.mockResolvedValue({});

    // Approve first request
    await request(app.getHttpServer())
      .patch('/api/v1/requests/req-1/approve')
      .set('Authorization', 'Bearer manager')
      .expect(200);

    // Approve second request
    await request(app.getHttpServer())
      .patch('/api/v1/requests/req-2/approve')
      .set('Authorization', 'Bearer manager')
      .expect(200);

    // Verify final balance: 10 - 4 - 4 = 2
    const finalBalances = mockHcmServer.getBalances();
    const finalBalance = finalBalances.find(
      (b) => b.employeeId === 'emp-1' && b.locationId === 'loc-1',
    );
    expect(finalBalance?.availableDays).toBe(2);
    expect(finalBalance?.pendingDays).toBe(0); // Since both approved and submitted to HCM
  });
});
