import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('sla-queue') private readonly slaQueue: Queue,
  ) {}

  async create(createRequestDto: CreateRequestDto) {
    // Business Logic: SLA Deadline is current time + 6 hours
    const slaDeadline = new Date();
    slaDeadline.setHours(slaDeadline.getHours() + 6);

    const request = await this.prisma.request.create({
      data: {
        ...createRequestDto,
        status: 'PENDING',
        slaStatus: 'SAFE',
        slaDeadline,
        currentApprover: createRequestDto.assignedToRole,
      },
    });

    // Dispatch warning job to BullQueue (delayed by 4 hours)
    await this.slaQueue.add(
      'warning', // job name
      { requestId: request.id }, // payload
      { 
        delay: 4 * 60 * 60 * 1000, 
        jobId: `warning-${request.id}` // specific job ID to fetch/remove later
      },
    );

    // Dispatch breach job to BullQueue (delayed by 6 hours)
    await this.slaQueue.add(
      'breach',
      { requestId: request.id },
      { 
        delay: 6 * 60 * 60 * 1000, 
        jobId: `breach-${request.id}` 
      },
    );

    return request;
  }

  async approve(id: string) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Request not found');
    }

    const updatedRequest = await this.prisma.request.update({
      where: { id },
      data: { status: 'APPROVED' },
    });

    // Remove pending SLA escalation jobs to prevent "ghost" escalations
    const warningJob = await this.slaQueue.getJob(`warning-${id}`);
    if (warningJob) {
      await warningJob.remove();
    }

    const breachJob = await this.slaQueue.getJob(`breach-${id}`);
    if (breachJob) {
      await breachJob.remove();
    }

    return updatedRequest;
  }
}
