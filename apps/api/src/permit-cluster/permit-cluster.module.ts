import { Module } from '@nestjs/common';
import { PermitClusterService } from './permit-cluster.service';
import { PermitClusterController } from './permit-cluster.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [PermitClusterController],
  providers: [PermitClusterService],
  exports: [PermitClusterService],
})
export class PermitClusterModule {}
