import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { AuthGuard } from './auth.guard';
import { HcmAdapter } from './hcm.adapter';
import { AdminGuard } from './admin.guard';
import { EmployeeGuard } from './employee.guard';
import { ManagerOrAdminGuard } from './manager-or-admin.guard';

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
  ],
})
export class AppModule {}
