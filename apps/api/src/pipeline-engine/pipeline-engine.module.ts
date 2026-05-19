import { Module } from '@nestjs/common';
import { PipelineEngineService } from './pipeline-engine.service';
import { PipelineEngineController } from './pipeline-engine.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [PipelineEngineService],
  controllers: [PipelineEngineController],
  exports: [PipelineEngineService],
})
export class PipelineEngineModule {}
