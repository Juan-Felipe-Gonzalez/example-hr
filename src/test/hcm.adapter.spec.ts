import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import axios from 'axios';
import {
  HcmAdapter,
  HcmRetryExhaustedError,
  HcmUnavailableError,
  InsufficientBalanceError,
  InvalidDimensionError,
} from '../hcm.adapter';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

describe('HcmAdapter', () => {
  const originalHcmBaseUrl = process.env.HCM_BASE_URL;
  const axiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };

  const deduction = {
    hcmEmployeeId: 'hcm-emp-1',
    hcmLocationId: 'hcm-loc-1',
    startDate: new Date('2026-12-01'),
    endDate: new Date('2026-12-05'),
    daysRequested: 5,
  };

  beforeEach(() => {
    process.env.HCM_BASE_URL = 'https://hcm.example.test';
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(axiosInstance);
  });

  afterEach(() => {
    process.env.HCM_BASE_URL = originalHcmBaseUrl;
    jest.restoreAllMocks();
  });

  it('getBalance maps HCM 200 response to BalanceDto correctly.', async () => {
    const syncedAt = '2026-04-29T10:00:00.000Z';
    axiosInstance.get.mockResolvedValue({
      data: {
        availableDays: 15,
        pendingDays: 2,
        hcmSyncedAt: syncedAt,
      },
    });

    const adapter = new HcmAdapter();

    await expect(
      adapter.getBalance(
        { hcmEmployeeId: 'hcm-emp-1' },
        { hcmLocationId: 'hcm-loc-1' },
      ),
    ).resolves.toEqual({
      availableDays: 15,
      pendingDays: 2,
      hcmSyncedAt: new Date(syncedAt),
    });
    expect(axiosInstance.get).toHaveBeenCalledWith(
      '/balances/hcm-emp-1/hcm-loc-1',
    );
  });

  it('getBalance throws HcmUnavailableError on HCM 503.', async () => {
    axiosInstance.get.mockRejectedValue({
      response: {
        status: 503,
      },
    });

    const adapter = new HcmAdapter();

    await expect(
      adapter.getBalance(
        { hcmEmployeeId: 'hcm-emp-1' },
        { hcmLocationId: 'hcm-loc-1' },
      ),
    ).rejects.toThrow(HcmUnavailableError);
  });

  it('submitDeduction throws InsufficientBalanceError on HCM 422.', async () => {
    axiosInstance.post.mockRejectedValue({
      response: {
        status: 422,
      },
    });

    const adapter = new HcmAdapter();

    await expect(adapter.submitDeduction(deduction)).rejects.toThrow(
      InsufficientBalanceError,
    );
  });

  it('submitDeduction throws InvalidDimensionError on HCM 400 with BAD_DIMENSION code.', async () => {
    axiosInstance.post.mockRejectedValue({
      response: {
        status: 400,
        data: {
          code: 'BAD_DIMENSION',
        },
      },
    });

    const adapter = new HcmAdapter();

    await expect(adapter.submitDeduction(deduction)).rejects.toThrow(
      InvalidDimensionError,
    );
  });

  it('submitDeduction retries on HCM 504 up to 3 times with backoff.', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    axiosInstance.post
      .mockRejectedValueOnce({
        response: {
          status: 504,
        },
      })
      .mockRejectedValueOnce({
        response: {
          status: 504,
        },
      })
      .mockResolvedValueOnce({
        data: {
          hcmRequestId: 'hcm-request-id',
          submittedAt: '2026-04-29T10:00:00.000Z',
        },
      });

    const adapter = new HcmAdapter();

    await expect(adapter.submitDeduction(deduction)).resolves.toEqual({
      success: true,
      hcmRequestId: 'hcm-request-id',
      submittedAt: new Date('2026-04-29T10:00:00.000Z'),
    });
    expect(axiosInstance.post).toHaveBeenCalledTimes(3);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);
  });

  it('submitDeduction throws HcmRetryExhaustedError after 3 failed retries.', async () => {
    axiosInstance.post.mockRejectedValue({
      response: {
        status: 504,
      },
    });

    const adapter = new HcmAdapter();

    await expect(adapter.submitDeduction(deduction)).rejects.toThrow(
      HcmRetryExhaustedError,
    );
    expect(axiosInstance.post).toHaveBeenCalledTimes(3);
  });
});
