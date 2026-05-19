import { Module } from '@nestjs/common';
import { BudgetTransferService } from './budget-transfer.service';
import { BudgetTransferController } from './budget-transfer.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, BudgetLedgerModule, NotificationsModule],
  controllers: [BudgetTransferController],
  providers: [BudgetTransferService],
  exports: [BudgetTransferService],
})
export class BudgetTransferModule {}
