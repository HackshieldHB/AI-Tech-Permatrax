import { Module } from '@nestjs/common';
import { FinanceForecastService } from './finance-forecast.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';

@Module({
  imports: [PrismaModule, BudgetLedgerModule],
  providers: [FinanceForecastService],
  exports: [FinanceForecastService],
})
export class FinanceForecastModule {}
