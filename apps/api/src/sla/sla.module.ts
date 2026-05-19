import { Module } from '@nestjs/common';
import { SlaProcessor } from './sla.processor';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    // The processor needs to be aware of the queue it will process occasionally 
    // Usually @Processor is sufficient, but good to ensure Queue bindings exist in provider topology
    BullModule.registerQueue({
      name: 'sla-queue',
    }),
  ],
  providers: [SlaProcessor],
})
export class SlaModule {}
