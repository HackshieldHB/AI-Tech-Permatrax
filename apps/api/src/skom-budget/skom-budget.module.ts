import { Module } from '@nestjs/common';
import { SkomBudgetService } from './skom-budget.service';
import { SkomBudgetController } from './skom-budget.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [SkomBudgetController],
  providers: [SkomBudgetService],
  exports: [SkomBudgetService],
})
export class SkomBudgetModule {}
