import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { SurveyorDocPackageController } from './surveyor-doc-package.controller';
import { SurveyorDocPackageService } from './surveyor-doc-package.service';

@Module({
  imports: [PrismaModule, NotificationsModule, PermitClusterModule],
  controllers: [SurveyorDocPackageController],
  providers: [SurveyorDocPackageService],
  exports: [SurveyorDocPackageService],
})
export class SurveyorDocPackageModule {}
