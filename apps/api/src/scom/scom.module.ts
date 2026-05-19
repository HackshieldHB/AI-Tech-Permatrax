import { Module } from '@nestjs/common';
import { ScomService } from './scom.service';
import { ScomController } from './scom.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule],
  controllers: [ScomController],
  providers: [ScomService],
  exports: [ScomService],
})
export class ScomModule {}
