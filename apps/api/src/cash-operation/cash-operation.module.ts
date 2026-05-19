import { Module } from '@nestjs/common';
import { CashOperationController } from './cash-operation.controller';
import { CashOperationService } from './cash-operation.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';

@Module({
  imports: [PrismaModule, NotificationsModule, StorageModule, BudgetLedgerModule],
  controllers: [CashOperationController],
  providers: [CashOperationService],
  exports: [CashOperationService],
})
export class CashOperationModule {}
