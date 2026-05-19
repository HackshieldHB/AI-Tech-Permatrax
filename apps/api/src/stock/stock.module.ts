import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PrismaModule } from '../prisma/prisma.module';

// NEW: StockModule — manages inventory catalog and quantity tracking
@Module({
  imports:     [PrismaModule],
  controllers: [StockController],
  providers:   [StockService],
  exports:     [StockService], // Exported so OrderService and SuratJalanService can inject
})
export class StockModule {}
