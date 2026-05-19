import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { MAIL_QUEUE } from './mail.constants';
import { MailQueueService } from './mail-queue.service';
import { MailProcessor } from './mail.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: MAIL_QUEUE }),
    ConfigModule,
    PrismaModule,
  ],
  providers: [MailQueueService, MailProcessor],
  exports: [MailQueueService],
})
export class MailModule {}
