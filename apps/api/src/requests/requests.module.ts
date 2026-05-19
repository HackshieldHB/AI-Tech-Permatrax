import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sla-queue',
    }),
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
