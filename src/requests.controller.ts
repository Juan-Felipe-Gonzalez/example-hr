import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Headers,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from './guards/auth.guard';
import { EmployeeGuard } from './guards/employee.guard';
import { ManagerOrAdminGuard } from './guards/manager-or-admin.guard';
import { RequestsService } from './requests.service';
import type { CreateTimeOffRequestDto } from './requests.service';

@Controller('requests')
@UseGuards(AuthGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  /**
   * Creates a new time-off request with idempotency support.
   * Validates request data, ensures employee and location exist, and handles duplicate submissions.
   * Requires employee role and idempotency key in headers.
   */
  @Post()
  @UseGuards(EmployeeGuard)
  async createTimeOffRequest(
    @Body() dto: CreateTimeOffRequestDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() req?: Request,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required.',
      );
    }

    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new BadRequestException(
        'Idempotency-Key header must be a non-empty string.',
      );
    }

    const user = (req as any)?.user;
    if (!user?.employeeId) {
      throw new BadRequestException('Employee ID not found in request context.');
    }

    const result = await this.requestsService.createTimeOffRequest(
      user.employeeId,
      dto,
      idempotencyKey,
    );

    // Set status code based on whether it's a new request or idempotent
    (req as any).res.status(result.isNew ? HttpStatus.CREATED : HttpStatus.OK);

    return result;
  }

  /**
   * Retrieves a single time-off request by ID.
   * Employees can only access their own requests; managers and admins can access any.
   */
  @Get(':id')
  async getTimeOffRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: Request,
  ) {
    const response = await this.requestsService.getTimeOffRequest(id);
    const user = (req as any)?.user;

    // Authorization check: employees can only see their own requests
    if (user?.role === 'employee') {
      if (user.employeeId !== response.data.employeeId) {
        throw new ForbiddenException(
          'Employees can only access their own requests.',
        );
      }
    }
    // Managers and admins can see any request

    return response;
  }

  /**
   * Lists time-off requests with optional filtering by employee, location, status, and date range.
   * Requires manager or admin role for access.
   */
  @Get()
  @UseGuards(ManagerOrAdminGuard)
  async listTimeOffRequests(
    @Query('employeeId') employeeId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return await this.requestsService.listTimeOffRequests({
      employeeId,
      locationId,
      status,
      from,
      to,
    });
  }

  /**
   * Approves a time-off request and submits it to the HCM system.
   * Updates request status, creates audit log, and integrates with external HCM.
   * Requires manager or admin role.
   */
  @Patch(':id/approve')
  @UseGuards(ManagerOrAdminGuard)
  async approveTimeOffRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: Request,
  ) {
    const user = (req as any)?.user;
    return await this.requestsService.approveTimeOffRequest(id, {
      role: user.role,
      employeeId: user.employeeId,
      managedLocationIds: user.managedLocationIds,
    });
  }

  /**
   * Rejects a time-off request.
   * Updates request status and creates an audit log.
   * Requires manager or admin role.
   */
  @Patch(':id/reject')
  @UseGuards(ManagerOrAdminGuard)
  async rejectTimeOffRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: Request,
  ) {
    const user = (req as any)?.user;
    return await this.requestsService.rejectTimeOffRequest(id, user.role === 'admin' ? 'admin' : user.employeeId);
  }

  /**
   * Cancels a time-off request (employee's own or by admin).
   * Employees can cancel their own submitted requests; admins can cancel any.
   * Updates request status and creates an audit log.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async cancelTimeOffRequest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: Request,
  ) {
    const user = (req as any)?.user;

    if (!user) {
      throw new BadRequestException('User not found in request context.');
    }

    // Get the request to check ownership
    let response: any;
    try {
      response = await this.requestsService.getTimeOffRequest(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw error;
    }

    // Authorization check
    if (user.role === 'employee') {
      if (user.employeeId !== response.data.employeeId) {
        throw new ForbiddenException(
          'Employees can only cancel their own requests.',
        );
      }
    } else if (user.role !== 'admin') {
      throw new ForbiddenException('Admin or Employee role is required.');
    }

    return await this.requestsService.cancelTimeOffRequest(id, user.role === 'admin' ? 'admin' : user.employeeId);
  }
}
