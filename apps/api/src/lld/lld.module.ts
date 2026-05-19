import { Module } from '@nestjs/common';
import { LldService } from './lld.service';
import { LldController } from './lld.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [LldController],
  providers: [LldService],
  exports: [LldService],
})
export class LldModule {}
