import { Module } from '@nestjs/common';
import { FinanceReportService } from './finance-report.service';
import { FinanceReportController } from './finance-report.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';

@Module({
  imports: [PrismaModule, BudgetLedgerModule],
  controllers: [FinanceReportController],
  providers: [FinanceReportService],
})
export class FinanceReportModule {}
