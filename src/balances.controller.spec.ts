import { Test } from '@nestjs/testing';
import {
  jest,
  describe,
  it,
  beforeEach,
  afterEach,
  expect,
} from '@jest/globals';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

describe('BalancesController', () => {
  let controller: BalancesController;
  const balancesService: jest.Mocked<BalancesService> = {
    getBalance: jest.fn(),
    getEmployeeBalances: jest.fn(),
    triggerBatchSync: jest.fn(),
    getBatchSyncStatus: jest.fn(),
    validateRequest: jest.fn(),
    applyOptimisticLock: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [BalancesController],
      providers: [
        {
          provide: BalancesService,
          useValue: balancesService,
        },
      ],
    }).compile();

    controller = module.get(BalancesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to the balances service', async () => {
    balancesService.getBalance.mockResolvedValue({ data: { version: 1 } });

    await expect(
      controller.getBalance(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ),
    ).resolves.toEqual({ data: { version: 1 } });

    expect(balancesService.getBalance).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    );
  });

  it('delegates employee-wide balance fetches to the balances service', async () => {
    balancesService.getEmployeeBalances.mockResolvedValue({ data: [] });

    await expect(
      controller.getEmployeeBalances('11111111-1111-1111-1111-111111111111'),
    ).resolves.toEqual({ data: [] });

    expect(balancesService.getEmployeeBalances).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('delegates batch sync triggers to the balances service', async () => {
    balancesService.triggerBatchSync.mockResolvedValue({
      data: { jobId: 'sync-job-1' },
    });

    await expect(controller.triggerBatchSync()).resolves.toEqual({
      data: { jobId: 'sync-job-1' },
    });

    expect(balancesService.triggerBatchSync).toHaveBeenCalled();
  });

  it('delegates sync status lookups to the balances service', async () => {
    balancesService.getBatchSyncStatus.mockResolvedValue({
      data: { jobId: 'sync-job-1', status: 'running' },
    });

    await expect(controller.getBatchSyncStatus('sync-job-1')).resolves.toEqual({
      data: { jobId: 'sync-job-1', status: 'running' },
    });

    expect(balancesService.getBatchSyncStatus).toHaveBeenCalledWith(
      'sync-job-1',
    );
  });
});
