import { Module } from '@nestjs/common';
import { SuratJalanController } from './surat-jalan.controller';
import { SuratJalanService } from './surat-jalan.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports:     [StockModule],
  controllers: [SuratJalanController],
  providers:   [SuratJalanService],
  exports:     [SuratJalanService],
})
export class SuratJalanModule {}
