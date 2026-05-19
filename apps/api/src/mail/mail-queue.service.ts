import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';
import { MAIL_QUEUE } from './mail.constants';
import type { MailJobData } from './mail-job.types';

@Injectable()
export class MailQueueService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJobData>) {}

  async enqueue(data: MailJobData): Promise<void> {
    await this.queue.add('deliver', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 100,
    });
  }
}
