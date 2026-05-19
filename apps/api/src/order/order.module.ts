import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { StockModule } from '../stock/stock.module';
import { SuratJalanModule } from '../surat-jalan/surat-jalan.module';
import { PurchaseRequestModule } from '../purchase-request/purchase-request.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BudgetLedgerModule } from '../budget-ledger/budget-ledger.module';
import { PoGenerationModule } from '../po-generation/po-generation.module';

@Module({
  imports:     [StockModule, SuratJalanModule, PurchaseRequestModule, NotificationsModule, BudgetLedgerModule, PoGenerationModule],
  controllers: [OrderController],
  providers:   [OrderService],
  exports:     [OrderService],
})
export class OrderModule {}
