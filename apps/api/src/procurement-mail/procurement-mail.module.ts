import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ProcurementMailService } from './procurement-mail.service';

@Module({
  imports: [MailModule],
  providers: [ProcurementMailService],
  exports: [ProcurementMailService],
})
export class ProcurementMailModule {}
