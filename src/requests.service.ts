/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { HcmAdapter } from './hcm.adapter';
import { TimeOffRequest } from '@prisma/client';

export type CreateTimeOffRequestDto = {
  locationId: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  daysRequested: number;
};

type TimeOffRequestResponse = {
  id: string;
  employeeId: string;
  locationId: string;
  startDate: string;
  endDate: string;
  daysRequested: number;
  status: string;
  hcmSubmitted: boolean;
  idempotencyKey: string;
  createdAt: string;
};

type CreateTimeOffRequestResponse = {
  data: TimeOffRequestResponse;
  isNew: boolean;
};

type ListTimeOffRequestsResponse = {
  data: TimeOffRequestResponse[];
};

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hcmAdapter: HcmAdapter,
  ) {}

  async createTimeOffRequest(
    employeeId: string,
    dto: CreateTimeOffRequestDto,
    idempotencyKey: string,
  ): Promise<CreateTimeOffRequestResponse> {
    // Validate dates
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException(
        'Invalid date format. Use ISO 8601 format.',
      );
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate.');
    }

    if (dto.daysRequested <= 0) {
      throw new BadRequestException('daysRequested must be greater than 0.');
    }

    // Verify employee exists
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }

    // Verify location exists
    const location = await this.prisma.location.findUnique({
      where: { id: dto.locationId },
    });

    if (!location) {
      throw new NotFoundException('Location not found.');
    }

    // Check balance
    const balanceSnapshot = await this.prisma.balanceSnapshot.findUnique({
      where: {
        employeeId_locationId: {
          employeeId,
          locationId: dto.locationId,
        },
      },
    });

    if (!balanceSnapshot) {
      throw new NotFoundException('Balance snapshot not found.');
    }

    if (balanceSnapshot.availableDays < dto.daysRequested) {
      throw new UnprocessableEntityException('Insufficient balance.');
    }

    // Check for conflicting pending requests
    const conflictingRequests = await this.prisma.timeOffRequest.findMany({
      where: {
        employeeId,
        status: 'SUBMITTED',
        OR: [
          {
            AND: [
              { startDate: { lte: new Date(dto.startDate) } },
              { endDate: { gte: new Date(dto.startDate) } },
            ],
          },
          {
            AND: [
              { startDate: { lte: new Date(dto.endDate) } },
              { endDate: { gte: new Date(dto.endDate) } },
            ],
          },
          {
            AND: [
              { startDate: { gte: new Date(dto.startDate) } },
              { endDate: { lte: new Date(dto.endDate) } },
            ],
          },
        ],
      },
    });

    if (conflictingRequests.length > 0) {
      throw new ConflictException('Conflicting pending request covers overlapping dates.');
    }

    // Check startDate not in past
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (startDate < now) {
      throw new UnprocessableEntityException('startDate must not be in the past.');
    }

    if (startDate >= endDate) {
      throw new UnprocessableEntityException('startDate must be before endDate.');
    }

    try {
      // Attempt to create the request with idempotency
      const request = await this.prisma.timeOffRequest.create({
        data: {
          employeeId,
          locationId: dto.locationId,
          startDate,
          endDate,
          daysRequested: dto.daysRequested,
          status: 'SUBMITTED',
          idempotencyKey,
        },
      });

      // Increment pending days
      await this.prisma.balanceSnapshot.update({
        where: {
          employeeId_locationId: {
            employeeId,
            locationId: dto.locationId,
          },
        },
        data: {
          pendingDays: {
            increment: dto.daysRequested,
          },
        },
      });

      // Create audit event
      await this.prisma.auditEvent.create({
        data: {
          requestId: request.id,
          actorId: employeeId,
          action: 'CREATED',
          newStatus: 'SUBMITTED',
        },
      });

      return {
        data: this.formatTimeOffRequest(request),
        isNew: true,
      };
    } catch (error) {
      // Handle unique constraint violation on idempotencyKey
      if (
        error.code === 'P2002' &&
        error.meta?.target?.includes('idempotencyKey')
      ) {
        // Return the existing request for idempotency
        const existingRequest = await this.prisma.timeOffRequest.findUnique({
          where: { idempotencyKey },
        });

        if (existingRequest) {
          return {
            data: this.formatTimeOffRequest(existingRequest),
            isNew: false,
          };
        }
      }

      throw error;
    }
  }

  /**
   * Fetch a single time-off request by ID
   */
  async getTimeOffRequest(
    requestId: string,
  ): Promise<CreateTimeOffRequestResponse> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Time-off request not found.');
    }

    return {
      data: this.formatTimeOffRequest(request),
    };
  }

  /**
   * List time-off requests with optional filters
   */
  async listTimeOffRequests(filters: {
    employeeId?: string;
    locationId?: string;
    status?: string;
    from?: string;
    to?: string;
  }): Promise<ListTimeOffRequestsResponse> {
    const where: any = {};

    if (filters.employeeId) {
      where.employeeId = filters.employeeId;
    }

    if (filters.locationId) {
      where.locationId = filters.locationId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.from || filters.to) {
      where.startDate = {};
      if (filters.from) {
        where.startDate.gte = new Date(filters.from);
      }
      if (filters.to) {
        where.startDate.lte = new Date(filters.to);
      }
    }

    const requests = await this.prisma.timeOffRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: requests.map((req) => this.formatTimeOffRequest(req)),
    };
  }

  /**
   * Approve a time-off request and submit to HCM
   */
  async approveTimeOffRequest(
    requestId: string,
    managerId: string,
  ): Promise<CreateTimeOffRequestResponse> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: true,
        location: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Time-off request not found.');
    }

    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot approve request with status ${request.status}.`,
      );
    }

    // Submit to HCM
    await this.hcmAdapter.submitTimeOffRequestToHcm({
      hcmEmployeeId: request.employee.hcmEmployeeId,
      hcmLocationId: request.location.hcmLocationId,
      startDate: request.startDate,
      endDate: request.endDate,
      daysRequested: request.daysRequested,
    });

    // Update request status
    const updatedRequest = await this.prisma.timeOffRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        hcmSubmitted: true,
      },
    });

    // Audit log
    await this.prisma.auditEvent.create({
      data: {
        requestId,
        actorId: managerId,
        action: 'APPROVED',
        prevStatus: 'SUBMITTED',
        newStatus: 'APPROVED',
      },
    });

    return {
      data: this.formatTimeOffRequest(updatedRequest),
    };
  }

  /**
   * Reject a time-off request
   */
  async rejectTimeOffRequest(
    requestId: string,
    managerId: string,
  ): Promise<CreateTimeOffRequestResponse> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Time-off request not found.');
    }

    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot reject request with status ${request.status}.`,
      );
    }

    // Update request status
    const updatedRequest = await this.prisma.timeOffRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
      },
    });

    // Audit log
    await this.prisma.auditEvent.create({
      data: {
        requestId,
        actorId: managerId,
        action: 'REJECTED',
        prevStatus: 'SUBMITTED',
        newStatus: 'REJECTED',
      },
    });

    return {
      data: this.formatTimeOffRequest(updatedRequest),
    };
  }

  /**
   * Cancel a time-off request (only SUBMITTED requests)
   */
  async cancelTimeOffRequest(
    requestId: string,
    employeeId: string,
  ): Promise<CreateTimeOffRequestResponse> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Time-off request not found.');
    }

    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot cancel request with status ${request.status}.`,
      );
    }

    // Update request status
    const updatedRequest = await this.prisma.timeOffRequest.update({
      where: { id: requestId },
      data: {
        status: 'CANCELLED',
      },
    });

    // Audit log
    await this.prisma.auditEvent.create({
      data: {
        requestId,
        actorId: employeeId,
        action: 'CANCELLED',
        prevStatus: 'SUBMITTED',
        newStatus: 'CANCELLED',
      },
    });

    return {
      data: this.formatTimeOffRequest(updatedRequest),
    };
  }

  private formatTimeOffRequest(
    request: TimeOffRequest,
  ): TimeOffRequestResponse {
    /**
     * Formats a TimeOffRequest entity into the API response format.
     * Converts dates to ISO strings and ensures consistent response structure.
     */
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      startDate: request.startDate.toISOString(),
      endDate: request.endDate.toISOString(),
      daysRequested: request.daysRequested,
      status: request.status,
      hcmSubmitted: request.hcmSubmitted,
      idempotencyKey: request.idempotencyKey,
      createdAt: request.createdAt.toISOString(),
    };
  }
}
