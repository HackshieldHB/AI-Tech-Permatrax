import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StockModule } from '../stock/stock.module';
import { SuratJalanModule } from '../surat-jalan/surat-jalan.module';
import { StockOutController } from './stock-out.controller';
import { StockOutService } from './stock-out.service';

@Module({
  imports: [PrismaModule, NotificationsModule, StockModule, SuratJalanModule],
  controllers: [StockOutController],
  providers: [StockOutService],
  exports: [StockOutService],
})
export class StockOutModule {}
