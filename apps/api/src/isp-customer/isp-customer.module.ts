import { Module } from '@nestjs/common';
import { IspCustomerController } from './isp-customer.controller';
import { IspCustomerService } from './isp-customer.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [IspCustomerController],
  providers:   [IspCustomerService],
  exports:     [IspCustomerService],
})
export class IspCustomerModule {}
