import { Module } from '@nestjs/common';
import { FtttProjectService } from './fttt-project.service';
import { FtttProjectController } from './fttt-project.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DailyActivityModule } from '../daily-activity/daily-activity.module';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, DailyActivityModule],
  controllers: [FtttProjectController],
  providers: [FtttProjectService],
  exports: [FtttProjectService],
})
export class FtttProjectModule {}
