import { Module } from '@nestjs/common';
import { FinanceProjectService } from './finance-project.service';
import { FinanceProjectController } from './finance-project.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';

import { FinanceForecastModule } from '../finance-forecast/finance-forecast.module';

@Module({
  imports: [PrismaModule, BudgetLedgerModule, FinanceForecastModule],
  controllers: [FinanceProjectController],
  providers: [FinanceProjectService],
  exports: [FinanceProjectService],
})
export class FinanceProjectModule {}
