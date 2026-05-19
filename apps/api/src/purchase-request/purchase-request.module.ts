import { Module } from '@nestjs/common';
import { PurchaseRequestController } from './purchase-request.controller';
import { PurchaseRequestService } from './purchase-request.service';
import { SuratJalanModule } from '../surat-jalan/surat-jalan.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [SuratJalanModule, StockModule],
  controllers: [PurchaseRequestController],
  providers:   [PurchaseRequestService],
  exports:     [PurchaseRequestService],
})
export class PurchaseRequestModule {}
