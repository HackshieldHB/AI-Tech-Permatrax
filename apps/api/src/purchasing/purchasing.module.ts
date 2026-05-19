import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
