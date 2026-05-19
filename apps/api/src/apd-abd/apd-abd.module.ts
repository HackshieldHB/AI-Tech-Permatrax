import { Module } from '@nestjs/common';
import { ApdAbdService } from './apd-abd.service';
import { ApdAbdController } from './apd-abd.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [ApdAbdController],
  providers: [ApdAbdService],
  exports: [ApdAbdService],
})
export class ApdAbdModule {}
