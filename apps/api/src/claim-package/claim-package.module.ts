import { Module } from '@nestjs/common';
import { ClaimPackageService } from './claim-package.service';
import { ClaimPackageController } from './claim-package.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [ClaimPackageController],
  providers: [ClaimPackageService],
  exports: [ClaimPackageService],
})
export class ClaimPackageModule {}
