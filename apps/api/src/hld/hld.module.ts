import { Module } from '@nestjs/common';
import { HldService } from './hld.service';
import { HldController } from './hld.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { StorageModule } from '../storage/storage.module'; // STEP 5: Import StorageModule

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule, StorageModule], // STEP 5: Add StorageModule
  controllers: [HldController],
  providers: [HldService],
  exports: [HldService],
})
export class HldModule {}
