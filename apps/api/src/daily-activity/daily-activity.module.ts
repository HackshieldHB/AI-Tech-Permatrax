import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { DailyActivityController } from './daily-activity.controller';
import { DailyActivityService } from './daily-activity.service';

@Module({
  imports: [PrismaModule, MailModule, StorageModule],
  controllers: [DailyActivityController],
  providers: [DailyActivityService],
  exports: [DailyActivityService],
})
export class DailyActivityModule {}
