import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  HcmAdapter,
  HcmInsufficientBalanceError,
  HcmUnavailableError,
} from '../hcm.adapter';
import { AuthGuard } from '../guards/auth.guard';
import { EmployeeGuard } from '../guards/employee.guard';
import { ManagerOrAdminGuard } from '../guards/manager-or-admin.guard';
import { ProblemDetailsFilter } from '../problem-details-filter';

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
    submitDeduction: jest.fn(),
    submitTimeOffRequestToHcm: jest.fn(),
  };

  const employeeId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';
  const idempotencyKey = 'test-idempotency-key';
  let authUser: {
    role: 'employee' | 'admin';
    employeeId?: string;
  } = { role: 'employee', employeeId };
  let approvalUser: {
    role: 'manager' | 'admin';
    employeeId?: string;
    managedLocationIds?: string[];
  } = { role: 'admin' };

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
        canActivate: jest.fn().mockImplementation((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = authUser;
          return true;
        }),
      })
      .overrideGuard(EmployeeGuard)
      .useValue({
        canActivate: jest.fn().mockImplementation((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = { employeeId, role: 'employee' };
          return true;
        }),
      })
      .overrideGuard(ManagerOrAdminGuard)
      .useValue({
        canActivate: jest.fn().mockImplementation((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = approvalUser;
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
    authUser = { role: 'employee', employeeId };
    approvalUser = { role: 'admin' };
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
  });

  describe('PATCH /requests/:id/approve — Happy Path', () => {
    it('Returns 200, approves the request, submits deduction, updates snapshot, and creates audit event.', async () => {
      const requestId = '33333333-3333-3333-3333-333333333333';
      const submittedRequest = {
        id: requestId,
        employeeId,
        locationId,
        startDate: new Date('2026-12-01'),
        endDate: new Date('2026-12-05'),
        daysRequested: 5,
        status: 'SUBMITTED',
        hcmSubmitted: false,
        idempotencyKey,
        createdAt: new Date(),
        employee: {
          id: employeeId,
          hcmEmployeeId: 'hcm-emp-1',
          name: 'John Doe',
          email: 'john@example.com',
        },
        location: {
          id: locationId,
          hcmLocationId: 'hcm-loc-1',
          name: 'Office',
          region: 'US',
        },
      };
      const approvedRequest = {
        ...submittedRequest,
        status: 'APPROVED',
        hcmSubmitted: true,
      };

      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);
      hcmAdapter.submitDeduction.mockResolvedValue({
        success: true,
        hcmRequestId: 'hcm-request-id',
        submittedAt: new Date(),
      });
      prismaService.timeOffRequest.update.mockResolvedValue(approvedRequest);
      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 5,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });
      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId,
        actorId: 'admin',
        action: 'APPROVED',
        prevStatus: 'SUBMITTED',
        newStatus: 'APPROVED',
        timestamp: new Date(),
        metadata: null,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: requestId,
        employeeId,
        locationId,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-12-05T00:00:00.000Z',
        daysRequested: 5,
        status: 'APPROVED',
        hcmSubmitted: true,
        idempotencyKey,
      });

      expect(hcmAdapter.submitDeduction).toHaveBeenCalledTimes(1);
      expect(hcmAdapter.submitDeduction).toHaveBeenCalledWith({
        hcmEmployeeId: 'hcm-emp-1',
        hcmLocationId: 'hcm-loc-1',
        startDate: submittedRequest.startDate,
        endDate: submittedRequest.endDate,
        daysRequested: submittedRequest.daysRequested,
      });
      expect(prismaService.timeOffRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          hcmSubmitted: true,
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
          availableDays: {
            decrement: submittedRequest.daysRequested,
          },
          pendingDays: {
            decrement: submittedRequest.daysRequested,
          },
        },
      });
      expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
        data: {
          requestId,
          actorId: 'admin',
          action: 'APPROVED',
          prevStatus: 'SUBMITTED',
          newStatus: 'APPROVED',
        },
      });
    });
  });

  describe('PATCH /requests/:id/approve — Error Cases', () => {
    const requestId = '33333333-3333-3333-3333-333333333333';

    const submittedRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey,
      createdAt: new Date(),
      employee: {
        id: employeeId,
        hcmEmployeeId: 'hcm-emp-1',
        name: 'John Doe',
        email: 'john@example.com',
      },
      location: {
        id: locationId,
        hcmLocationId: 'hcm-loc-1',
        name: 'Office',
        region: 'US',
      },
    };

    it('Returns 409 when HCM returns insufficient balance at approval time.', async () => {
      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);
      hcmAdapter.submitDeduction.mockRejectedValue(
        new HcmInsufficientBalanceError(),
      );

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .expect(409);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.5.8',
      );
      expect(response.body).toHaveProperty('title', 'Conflict');
      expect(response.body).toHaveProperty(
        'detail',
        'Insufficient balance at approval time.',
      );
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });

    it('Returns 409 when HCM adapter returns HcmUnavailableError.', async () => {
      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);
      hcmAdapter.submitDeduction.mockRejectedValue(new HcmUnavailableError());

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .expect(409);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.5.8',
      );
      expect(response.body).toHaveProperty('title', 'Conflict');
      expect(response.body).toHaveProperty(
        'detail',
        'HCM system is currently unavailable.',
      );
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });

    it('Returns 409 when request is already APPROVED.', async () => {
      prismaService.timeOffRequest.findUnique.mockResolvedValue({
        ...submittedRequest,
        status: 'APPROVED',
        hcmSubmitted: true,
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .expect(409);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.5.8',
      );
      expect(response.body).toHaveProperty('title', 'Conflict');
      expect(response.body).toHaveProperty(
        'detail',
        'Cannot approve request with status APPROVED.',
      );
      expect(hcmAdapter.submitDeduction).not.toHaveBeenCalled();
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });

    it("Returns 403 when caller is not the employee's manager.", async () => {
      approvalUser = {
        role: 'manager',
        employeeId: '44444444-4444-4444-4444-444444444444',
        managedLocationIds: ['55555555-5555-5555-5555-555555555555'],
      };
      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/requests/${requestId}/approve`)
        .expect(403);

      expect(response.body).toHaveProperty(
        'detail',
        "Managers can only approve requests for their managed locations.",
      );
      expect(hcmAdapter.submitDeduction).not.toHaveBeenCalled();
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /requests/:id', () => {
    const requestId = '33333333-3333-3333-3333-333333333333';

    const submittedRequest = {
      id: requestId,
      employeeId,
      locationId,
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-05'),
      daysRequested: 5,
      status: 'SUBMITTED',
      hcmSubmitted: false,
      idempotencyKey,
      createdAt: new Date(),
    };

    it('Returns 200 and sets status=CANCELLED for a pending request.', async () => {
      const cancelledRequest = {
        ...submittedRequest,
        status: 'CANCELLED',
      };

      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);
      prismaService.timeOffRequest.update.mockResolvedValue(cancelledRequest);
      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });
      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId,
        actorId: employeeId,
        action: 'CANCELLED',
        prevStatus: 'SUBMITTED',
        newStatus: 'CANCELLED',
        timestamp: new Date(),
        metadata: null,
      });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/requests/${requestId}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: requestId,
        employeeId,
        locationId,
        startDate: '2026-12-01T00:00:00.000Z',
        endDate: '2026-12-05T00:00:00.000Z',
        daysRequested: 5,
        status: 'CANCELLED',
        hcmSubmitted: false,
        idempotencyKey,
      });
      expect(prismaService.timeOffRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: 'CANCELLED',
        },
      });
    });

    it('Decrements pending_days on balance_snapshot.', async () => {
      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);
      prismaService.timeOffRequest.update.mockResolvedValue({
        ...submittedRequest,
        status: 'CANCELLED',
      });
      prismaService.balanceSnapshot.update.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });
      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-id',
        requestId,
        actorId: employeeId,
        action: 'CANCELLED',
        prevStatus: 'SUBMITTED',
        newStatus: 'CANCELLED',
        timestamp: new Date(),
        metadata: null,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/requests/${requestId}`)
        .expect(200);

      expect(prismaService.balanceSnapshot.update).toHaveBeenCalledWith({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId,
          },
        },
        data: {
          pendingDays: {
            decrement: submittedRequest.daysRequested,
          },
        },
      });
    });

    it('Returns 403 when caller is not the request owner.', async () => {
      authUser = {
        role: 'employee',
        employeeId: '44444444-4444-4444-4444-444444444444',
      };
      prismaService.timeOffRequest.findUnique.mockResolvedValue(submittedRequest);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/requests/${requestId}`)
        .expect(403);

      expect(response.body).toHaveProperty(
        'detail',
        'Employees can only cancel their own requests.',
      );
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });

    it('Returns 409 when request is not in a cancellable state.', async () => {
      prismaService.timeOffRequest.findUnique.mockResolvedValue({
        ...submittedRequest,
        status: 'APPROVED',
        hcmSubmitted: true,
      });

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/requests/${requestId}`)
        .expect(409);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.5.8',
      );
      expect(response.body).toHaveProperty('title', 'Conflict');
      expect(response.body).toHaveProperty(
        'detail',
        'Cannot cancel request with status APPROVED.',
      );
      expect(prismaService.timeOffRequest.update).not.toHaveBeenCalled();
      expect(prismaService.balanceSnapshot.update).not.toHaveBeenCalled();
      expect(prismaService.auditEvent.create).not.toHaveBeenCalled();
    });
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
