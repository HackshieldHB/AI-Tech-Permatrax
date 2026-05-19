import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull'; // NEW: Bull queue registration
import { BaOpenController } from './ba-open.controller';
import { BaOpenService } from './ba-open.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { BA_OPEN_PDF_QUEUE } from './ba-open.queue';
import { BaOpenProcessor } from './ba-open.processor';

// NEW: BaOpenModule — auto-generation of BA Open documents
@Module({
  imports:     [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule, BullModule.registerQueue({ name: BA_OPEN_PDF_QUEUE })], // NEW: register BA Open PDF queue
  controllers: [BaOpenController],
  providers:   [BaOpenService, BaOpenProcessor], // NEW: include queue processor
  exports:     [BaOpenService],
})
export class BaOpenModule {}
