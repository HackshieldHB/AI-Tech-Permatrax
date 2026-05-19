import { Module } from '@nestjs/common';
import { SocializationService } from './socialization.service';
import { SocializationController } from './socialization.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, PermitClusterModule],
  controllers: [SocializationController],
  providers: [SocializationService],
  exports: [SocializationService],
})
export class SocializationModule {}
