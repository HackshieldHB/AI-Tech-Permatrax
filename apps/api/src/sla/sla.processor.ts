import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Processor('sla-queue')
export class SlaProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway
  ) {}

  @Process('warning')
  async handleWarning(job: Job<{ requestId: string }>) {
    const { requestId } = job.data;
    console.log(`[SLA Processor] Triggering warning for Request: ${requestId}`);

    const request = await this.prisma.request.findUnique({ where: { id: requestId } });

    // Validate that the request hasn't been approved yet
    if (request && request.status === 'PENDING') {
      await this.prisma.request.update({
        where: { id: requestId },
        data: { slaStatus: 'WARNING' },
      });

      await this.prisma.activityLog.create({
        data: {
          action: 'SLA_ESCALATION',
          performedBy: 'SYSTEM_SLA_ENGINE',
          metadata: { escalationType: 'WARNING', requestId },
          project: { connect: { id: request.projectId } }
        },
      });

      // Emit push notification to all active field clients
      this.notificationsGateway.notifyClient('sla_alert', { 
        requestId, 
        escalationType: 'WARNING',
        message: 'A Permit SLA is approaching Breach boundaries.'
      });
    }
  }

  @Process('breach')
  async handleBreach(job: Job<{ requestId: string }>) {
    const { requestId } = job.data;
    console.log(`[SLA Processor] Triggering BREACH for Request: ${requestId}`);

    const request = await this.prisma.request.findUnique({ where: { id: requestId } });

    // Validate that the request hasn't been approved yet
    if (request && request.status === 'PENDING') {
      await this.prisma.request.update({
        where: { id: requestId },
        data: { slaStatus: 'BREACHED' },
      });

      await this.prisma.activityLog.create({
        data: {
          action: 'SLA_ESCALATION',
          performedBy: 'SYSTEM_SLA_ENGINE',
          metadata: { escalationType: 'BREACH', requestId },
          project: { connect: { id: request.projectId } }
        },
      });

      // Blast critical breach notification telemetry natively to Next.js VM
      this.notificationsGateway.notifyClient('sla_alert', { 
        requestId, 
        escalationType: 'BREACH',
        message: 'CRITICAL: SLA Deadline has been Breached!'
      });
    }
  }
}
