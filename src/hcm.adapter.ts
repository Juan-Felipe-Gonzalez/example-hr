import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export class InsufficientBalanceError extends Error {
  constructor(message = 'Insufficient balance at approval time.') {
    super(message);
    this.name = 'InsufficientBalanceError';
  }
}

export { InsufficientBalanceError as HcmInsufficientBalanceError };

export class HcmUnavailableError extends Error {
  constructor(message = 'HCM system is currently unavailable.') {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}

export class InvalidDimensionError extends Error {
  constructor(message = 'Invalid HCM dimension.') {
    super(message);
    this.name = 'InvalidDimensionError';
  }
}

export class HcmRetryExhaustedError extends Error {
  constructor(message = 'HCM retry attempts exhausted.') {
    super(message);
    this.name = 'HcmRetryExhaustedError';
  }
}

@Injectable()
export class HcmAdapter {
  private axiosInstance?: AxiosInstance;
  private readonly maxRetries = 3;
  private readonly retryBackoffMs = 25;

  constructor() {
    const baseURL = process.env.HCM_BASE_URL;
    if (baseURL) {
      this.axiosInstance = axios.create({
        baseURL,
        timeout: 5000,
      });
    }
  }

  async getBalance(
    employee: { hcmEmployeeId: string },
    location: { hcmLocationId: string },
  ) {
    if (!this.axiosInstance) {
      return this.getFallbackBalance(employee, location);
    }

    try {
      const response = await this.axiosInstance.get(
        `/balances/${employee.hcmEmployeeId}/${location.hcmLocationId}`,
      );

      return {
        availableDays: response.data.availableDays,
        pendingDays: response.data.pendingDays,
        hcmSyncedAt: new Date(response.data.hcmSyncedAt),
      };
    } catch (error) {
      if (this.getHttpStatus(error) === 503) {
        throw new HcmUnavailableError();
      }

      throw error;
    }
  }

  // Simulates the real-time HCM balance lookup used by read endpoints.
  async fetchBalance(
    employee: { hcmEmployeeId: string },
    location: { hcmLocationId: string },
  ) {
    return this.getBalance(employee, location);
  }

  // Simulates the batch HCM corpus used by reconciliation jobs.
  async fetchBalanceCorpus(
    employees: Array<{ id: string; hcmEmployeeId: string }>,
    locations: Array<{ id: string; hcmLocationId: string }>,
  ) {
    if (this.axiosInstance) {
      const response = await this.axiosInstance.get('/balances/corpus', {
        params: {
          employees: employees.map(e => e.hcmEmployeeId).join(','),
          locations: locations.map(l => l.hcmLocationId).join(','),
        },
      });
      return response.data.balances.map((b: any) => ({
        employeeId: employees.find(e => e.hcmEmployeeId === b.hcmEmployeeId)?.id,
        locationId: locations.find(l => l.hcmLocationId === b.hcmLocationId)?.id,
        availableDays: b.availableDays,
        pendingDays: b.pendingDays,
        hcmSyncedAt: new Date(b.hcmSyncedAt),
      }));
    }

    // Fallback
    const balances = await Promise.all(
      employees.flatMap((employee) =>
        locations.map(async (location) => ({
          employeeId: employee.id,
          locationId: location.id,
          ...(await this.fetchBalance(employee, location)),
        })),
      ),
    );

    return balances;
  }

  /**
   * Submit a time-off deduction to the HCM system.
   */
  async submitDeduction(request: {
    hcmEmployeeId: string;
    hcmLocationId: string;
    startDate: Date;
    endDate: Date;
    daysRequested: number;
  }) {
    if (this.axiosInstance) {
      return this.submitDeductionToHcm(this.axiosInstance, request);
    }

    // Simulates HCM API call
    return {
      success: true,
      hcmRequestId: `HCM-${Date.now()}`,
      submittedAt: new Date(),
    };
  }

  /**
   * Submit a time-off request to the HCM system
   */
  async submitTimeOffRequestToHcm(request: {
    hcmEmployeeId: string;
    hcmLocationId: string;
    startDate: Date;
    endDate: Date;
    daysRequested: number;
  }) {
    return this.submitDeduction(request);
  }

  private getFallbackBalance(
    employee: { hcmEmployeeId: string },
    location: { hcmLocationId: string },
  ) {
    // Fallback to fake logic
    const employeeScore = employee.hcmEmployeeId.length;
    const locationScore = location.hcmLocationId.length;
    const pendingDays = Number((locationScore % 5).toFixed(2));
    const availableDays = Number((20 + employeeScore - pendingDays).toFixed(2));

    return {
      availableDays,
      pendingDays,
      hcmSyncedAt: new Date(),
    };
  }

  private async submitDeductionToHcm(
    axiosInstance: AxiosInstance,
    request: {
      hcmEmployeeId: string;
      hcmLocationId: string;
      startDate: Date;
      endDate: Date;
      daysRequested: number;
    },
  ) {
    let lastGatewayTimeout: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await axiosInstance.post('/requests', {
          employeeId: request.hcmEmployeeId,
          locationId: request.hcmLocationId,
          startDate: request.startDate.toISOString(),
          endDate: request.endDate.toISOString(),
          daysRequested: request.daysRequested,
        });

        return {
          success: true,
          hcmRequestId: response.data?.hcmRequestId ?? `HCM-${Date.now()}`,
          submittedAt: response.data?.submittedAt
            ? new Date(response.data.submittedAt)
            : new Date(),
        };
      } catch (error) {
        const status = this.getHttpStatus(error);

        if (status === 422) {
          throw new InsufficientBalanceError();
        }

        if (
          status === 400 &&
          this.getErrorCode(error) === 'BAD_DIMENSION'
        ) {
          throw new InvalidDimensionError();
        }

        if (status === 504) {
          lastGatewayTimeout = error;
          if (attempt < this.maxRetries) {
            await this.backoff(attempt);
            continue;
          }

          throw new HcmRetryExhaustedError();
        }

        throw error;
      }
    }

    throw lastGatewayTimeout;
  }

  private async backoff(attempt: number) {
    await new Promise((resolve) =>
      setTimeout(resolve, this.retryBackoffMs * attempt),
    );
  }

  private getHttpStatus(error: unknown) {
    return (error as any)?.response?.status;
  }

  private getErrorCode(error: unknown) {
    return (error as any)?.response?.data?.code;
  }
}

