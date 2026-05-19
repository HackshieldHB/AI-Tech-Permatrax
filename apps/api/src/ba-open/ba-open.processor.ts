import { Process, Processor, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { BaOpenService } from './ba-open.service';
import { BA_OPEN_PDF_QUEUE } from './ba-open.queue';

interface BaOpenPdfJobData {
  baOpenId: string;
  visitRequestId: string;
  assignedPmId: string;
}

@Processor(BA_OPEN_PDF_QUEUE)
export class BaOpenProcessor {
  private readonly logger = new Logger(BaOpenProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly baOpenService: BaOpenService, // FIX: shared PDF layout + generation
  ) {}

  @Process('generate-pdf')
  async generateBaOpenPdf(job: Job<BaOpenPdfJobData>) {
    const { baOpenId, assignedPmId } = job.data;
    this.logger.log(`Generating BA Open PDF for ${baOpenId}`);

    const baOpen = await this.prisma.baOpen.findUniqueOrThrow({
      where: { id: baOpenId },
      include: {
        visitRequest: {
          include: {
            cleanList: true,
            requester: { select: { id: true, name: true } },
          },
        },
      },
    });

    const pdfBuffer = await this.baOpenService.buildBaOpenPdfBuffer(baOpenId); // FIX: single source of truth for PDF layout

    const year = new Date().getFullYear();
    const key = `ba-open/${year}/${baOpen.documentNumber.replace(/\//g, '-')}.pdf`;
    const pdfUrl = await this.storageService.uploadBuffer(pdfBuffer, key, 'application/pdf');

    await this.prisma.baOpen.update({
      where: { id: baOpenId },
      data: { pdfUrl, status: 'GENERATED' },
    });

    this.notificationsGateway.emitToRoom(`user:${assignedPmId}`, 'baOpen:generated', {
      baOpenId,
      documentNumber: baOpen.documentNumber,
      pdfUrl,
    });
    this.logger.log(`BA Open PDF generated: ${pdfUrl}`);
    return { pdfUrl };
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`BA Open PDF job ${job.id} failed: ${error.message}`);
  }
}
