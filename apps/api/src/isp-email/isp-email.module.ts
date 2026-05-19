import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { IspEmailController } from './isp-email.controller';
import { IspEmailService } from './isp-email.service';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [IspEmailController],
  providers: [IspEmailService],
  exports: [IspEmailService],
})
export class IspEmailModule {}
