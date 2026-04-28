import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { BalancesService } from './balances.service';
import { AdminGuard } from './admin.guard';

@Controller('balances')
@UseGuards(AuthGuard)
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  /**
   * Retrieves all location balances for an employee after refreshing them from HCM.
   * Forces a fresh read from the external HCM system for real-time data.
   */
  @Get(':employeeId')
  async getEmployeeBalances(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
  ) {
    return await this.balancesService.getEmployeeBalances(employeeId);
  }

  /**
   * Retrieves a single location balance for an employee after forcing a fresh HCM read.
   * Ensures the most up-to-date balance information is returned.
   */
  @Get(':employeeId/:locationId')
  async getBalance(
    @Param('employeeId', new ParseUUIDPipe()) employeeId: string,
    @Param('locationId', new ParseUUIDPipe()) locationId: string,
  ) {
    return await this.balancesService.getBalance(employeeId, locationId);
  }

  /**
   * Initiates a manual batch reconciliation job to sync all balances from HCM.
   * Returns a job ID for tracking the asynchronous operation.
   * Requires admin privileges.
   */
  @Post('batch-sync')
  @UseGuards(AuthGuard, AdminGuard)
  async triggerBatchSync() {
    return await this.balancesService.triggerBatchSync();
  }

  /**
   * Retrieves the current status of a previously initiated batch sync job.
   * Provides progress information including completion status and any errors.
   * Requires admin privileges.
   */
  @Get('sync-status/:jobId')
  @UseGuards(AuthGuard, AdminGuard)
  async getBatchSyncStatus(@Param('jobId') jobId: string) {
    return await this.balancesService.getBatchSyncStatus(jobId);
  }
}
