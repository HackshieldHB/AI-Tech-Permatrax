import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull'; // NEW: Bull queue registration
import { BakpService } from './bakp.service';
import { BakpController } from './bakp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { BakpProcessor, BAKP_PDF_QUEUE } from './bakp.processor'; // NEW: BAKP queue processor + queue name
import { BakpMergeService } from './bakp-merge.service';
import { IspEmailModule } from '../isp-email/isp-email.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule, IspEmailModule, BullModule.registerQueue({ name: BAKP_PDF_QUEUE })], // NEW: register BAKP PDF queue
  controllers: [BakpController],
  providers: [BakpService, BakpProcessor, BakpMergeService], // NEW: add BAKP queue processor
  exports: [BakpService],
})
export class BakpModule {}
