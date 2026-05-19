import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CashOpRealisasiService } from './cash-op-realisasi.service';
import { CashOpRealisasiController } from './cash-op-realisasi.controller';

@Module({
  imports: [PrismaModule, BudgetLedgerModule, NotificationsModule],
  providers: [CashOpRealisasiService],
  controllers: [CashOpRealisasiController],
  exports: [CashOpRealisasiService],
})
export class CashOpRealisasiModule {}
