import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { AuthGuard } from './guards/auth.guard';
import { HcmAdapter } from './hcm.adapter';
import { AdminGuard } from './guards/admin.guard';
import { EmployeeGuard } from './guards/employee.guard';
import { ManagerOrAdminGuard } from './guards/manager-or-admin.guard';
import { IdempotencyService } from './idempotency.service';
import { ReconcilerService } from './reconciler.service';

@Module({
  imports: [PrismaModule],
  controllers: [BalancesController, RequestsController],
  providers: [
    BalancesService,
    RequestsService,
    AuthGuard,
    AdminGuard,
    EmployeeGuard,
    ManagerOrAdminGuard,
    HcmAdapter,
    IdempotencyService,
    ReconcilerService,
  ],
})
export class AppModule {}
