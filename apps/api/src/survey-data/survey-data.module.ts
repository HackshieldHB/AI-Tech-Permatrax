import { Module, forwardRef } from '@nestjs/common';
import { SurveyDataService } from './survey-data.service';
import { SurveyDataController } from './survey-data.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module';
import { BaSurveyModule } from '../ba-survey/ba-survey.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, PermitClusterModule, StorageModule, forwardRef(() => BaSurveyModule)],
  controllers: [SurveyDataController],
  providers: [SurveyDataService],
  exports: [SurveyDataService],
})
export class SurveyDataModule {}
