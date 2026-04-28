import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HcmAdapter } from '../src/hcm.adapter';
import { AuthGuard } from '../src/auth.guard';
import { ProblemDetailsFilter } from '../src/problem-details-filter';
import { jest } from '@jest/globals';

describe('Balances (integration)', () => {
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
    submitTimeOffRequestToHcm: jest.fn(),
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
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
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

  describe('GET /balances/:employeeId/:locationId', () => {
    it('Returns fresh HCM balance and updates snapshot timestamp.', async () => {
      const freshBalance = {
        availableDays: 15,
        pendingDays: 2,
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

      // Mock existing snapshot
      const existingSnapshot = {
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date('2024-01-01'),
        version: 1,
      };
      prismaService.balanceSnapshot.findUnique.mockResolvedValue(
        existingSnapshot,
      );

      // Mock HCM fetch
      hcmAdapter.fetchBalance.mockResolvedValue({
        availableDays: 15,
        pendingDays: 2,
        hcmSyncedAt: new Date(),
      });

      // Mock upsert
      const updatedSnapshot = {
        ...existingSnapshot,
        availableDays: freshBalance.availableDays,
        pendingDays: freshBalance.pendingDays,
        hcmSyncedAt: new Date(),
        version: 2,
      };
      prismaService.balanceSnapshot.upsert.mockResolvedValue(updatedSnapshot);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/balances/${employeeId}/${locationId}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        employeeId,
        locationId,
        availableDays: 15,
        pendingDays: 2,
        hcmSyncedAt: expect.any(String),
        version: 2,
      });

      expect(hcmAdapter.fetchBalance).toHaveBeenCalledWith(
        'hcm-emp-1',
        'hcm-loc-1',
      );

      expect(prismaService.balanceSnapshot.upsert).toHaveBeenCalledWith({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId,
          },
        },
        update: {
          availableDays: 15,
          pendingDays: 2,
          hcmSyncedAt: expect.any(Date),
          version: { increment: 1 },
        },
        create: {
          employeeId,
          locationId,
          availableDays: 15,
          pendingDays: 2,
          hcmSyncedAt: expect.any(Date),
          version: 1,
        },
      });
    });

    it('Returns 404 when combination does not exist.', async () => {
      // Mock employee not found
      prismaService.employee.findUnique.mockResolvedValue(null);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/balances/${employeeId}/${locationId}`)
        .expect(404);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.5.4',
      );
      expect(response.body).toHaveProperty('title', 'Not Found');
      expect(response.body).toHaveProperty('detail', 'Employee not found.');
    });

    it('Returns 503 with retry-after header when HCM is unavailable.', async () => {
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

      // Mock existing snapshot
      prismaService.balanceSnapshot.findUnique.mockResolvedValue({
        id: 'balance-id',
        employeeId,
        locationId,
        availableDays: 10,
        pendingDays: 0,
        hcmSyncedAt: new Date(),
        version: 1,
      });

      // Mock HCM unavailable
      hcmAdapter.fetchBalance.mockRejectedValue(new Error('HCM unavailable'));

      const response = await request(app.getHttpServer())
        .get(`/api/v1/balances/${employeeId}/${locationId}`)
        .expect(503);

      expect(response.body).toHaveProperty(
        'type',
        'https://tools.ietf.org/html/rfc7231#section-6.6.4',
      );
      expect(response.body).toHaveProperty('title', 'Service Unavailable');
      expect(response.body).toHaveProperty(
        'detail',
        'HCM system is currently unavailable.',
      );
    });
  });
});
