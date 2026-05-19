import { Module } from '@nestjs/common';
import { CompensationService } from './compensation.service';
import { CompensationController } from './compensation.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule],
  controllers: [CompensationController],
  providers: [CompensationService],
  exports: [CompensationService],
})
export class CompensationModule {}
