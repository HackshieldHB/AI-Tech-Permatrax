import { Module } from '@nestjs/common';
import { SipService } from './sip.service';
import { SipController } from './sip.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule],
  controllers: [SipController],
  providers: [SipService],
  exports: [SipService],
})
export class SipModule {}
