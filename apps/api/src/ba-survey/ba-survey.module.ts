import { Module, forwardRef } from '@nestjs/common';
import { BaSurveyService } from './ba-survey.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { SipModule } from '../sip/sip.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    NotificationsModule,
    PermitClusterModule,
    forwardRef(() => SipModule),
  ],
  providers: [BaSurveyService],
  exports: [BaSurveyService],
})
export class BaSurveyModule {}
