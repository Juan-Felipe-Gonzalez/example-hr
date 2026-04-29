import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export class HcmInsufficientBalanceError extends Error {
  constructor(message = 'Insufficient balance at approval time.') {
    super(message);
    this.name = 'HcmInsufficientBalanceError';
  }
}

export class HcmUnavailableError extends Error {
  constructor(message = 'HCM system is currently unavailable.') {
    super(message);
    this.name = 'HcmUnavailableError';
  }
}

@Injectable()
export class HcmAdapter {
  private axiosInstance: AxiosInstance;

  constructor() {
    const baseURL = process.env.HCM_BASE_URL;
    if (baseURL) {
      this.axiosInstance = axios.create({
        baseURL,
        timeout: 5000,
      });
    }
  }

  // Simulates the real-time HCM balance lookup used by read endpoints.
  async fetchBalance(
    employee: { hcmEmployeeId: string },
    location: { hcmLocationId: string },
  ) {
    if (this.axiosInstance) {
      const response = await this.axiosInstance.get(`/balances/${employee.hcmEmployeeId}/${location.hcmLocationId}`);
      return {
        availableDays: response.data.availableDays,
        pendingDays: response.data.pendingDays,
        hcmSyncedAt: new Date(response.data.hcmSyncedAt),
      };
    }

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
      await this.axiosInstance.post('/requests', {
        employeeId: request.hcmEmployeeId,
        locationId: request.hcmLocationId,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        daysRequested: request.daysRequested,
      });
      return {
        success: true,
        hcmRequestId: `HCM-${Date.now()}`,
        submittedAt: new Date(),
      };
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
}

