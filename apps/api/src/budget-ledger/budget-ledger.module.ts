import { Module } from '@nestjs/common';
import { BudgetLedgerService } from './budget-ledger.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [BudgetLedgerService],
  exports: [BudgetLedgerService],
})
export class BudgetLedgerModule {}
