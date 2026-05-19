import { Process, Processor, OnQueueFailed } from '@nestjs/bull'; // NEW: Bull processor decorators
import { Job } from 'bull'; // NEW: Bull job type
import { Logger } from '@nestjs/common'; // NEW: processor logger
import { PrismaService } from '../prisma/prisma.service'; // NEW: DB access for BAKP data
import { StorageService } from '../storage/storage.service'; // NEW: S3 upload service
import { NotificationsGateway } from '../notifications/notifications.gateway'; // NEW: realtime notification gateway
// FIX: CommonJS require — pdfkit does not have a default ES export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

export const BAKP_PDF_QUEUE = 'bakp-pdf'; // NEW: BAKP PDF queue name constant

interface BakpPdfJobData { // NEW: queue job payload
  bakpId: string; // NEW: BAKP id
  adminId: string; // NEW: approver/admin id
}

@Processor(BAKP_PDF_QUEUE) // NEW: process jobs for BAKP queue
export class BakpProcessor {
  private readonly logger = new Logger(BakpProcessor.name); // NEW: processor logger

  constructor(
    private readonly prisma: PrismaService, // NEW: Prisma dependency
    private readonly storageService: StorageService, // NEW: Storage dependency
    private readonly notificationsGateway: NotificationsGateway, // NEW: Notifications dependency
  ) {}

  @Process('generate-bundle') // NEW: BAKP bundle generation worker
  async generateBundle(job: Job<BakpPdfJobData>) {
    const { bakpId } = job.data; // NEW: job payload
    this.logger.log(`Generating BAKP bundle for ${bakpId}`); // NEW: job start log

    const bakp = await this.prisma.bakp.findUniqueOrThrow({ // NEW: load BAKP with all required relations
      where: { id: bakpId },
      include: {
        permitCluster: {
          include: {
            baOpen: true,
            socialization: true,
            bak: true,
            scom: true,
          },
        },
      },
    });

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => { // NEW: generate bundle PDF
      const doc = new PDFDocument({ margin: 50, size: 'A4' }); // NEW: PDF document instance
      const chunks: Buffer[] = []; // NEW: chunk collector
      doc.on('data', (chunk) => chunks.push(chunk)); // NEW: collect chunks
      doc.on('end', () => resolve(Buffer.concat(chunks))); // NEW: resolve final buffer
      doc.on('error', reject); // NEW: propagate errors

      const checklistRows: [string, boolean][] = [ // NEW: checklist rows with completion flags
        ['BA Open', bakp.hasBAOpen],
        ['BA Survey', bakp.hasBASurvey],
        ['BA Sosialisasi', bakp.hasBASocialization],
        ['BAK Disetujui', bakp.hasApprovedBAK],
        ['BAK Tertandatangani', bakp.hasSignedBAK],
        ['KTP RT/RW', bakp.hasRtRwKtp],
        ['SK RT/RW', bakp.hasRtRwSk],
        ['SIP', bakp.hasSip],
        ['PKS', bakp.hasPks],
        ['Kuitansi', bakp.hasReceipt],
        ['Bukti Transfer', bakp.hasTransferProof],
        ['Foto Pembayaran', bakp.hasPaymentPhoto],
      ];

      doc.fontSize(16).font('Helvetica-Bold').text('BERITA ACARA KESEPAKATAN PENERIMAAN', { align: 'center' }); // NEW: document title
      doc.moveDown(0.4); // NEW: spacing
      doc.fontSize(12).font('Helvetica').text(`Nomor: ${bakp.documentNumber}`, { align: 'center' }); // NEW: document number
      doc.moveDown(1); // NEW: spacing

      doc.fontSize(12).font('Helvetica-Bold').text('INFORMASI CLUSTER'); // NEW: section title
      doc.fontSize(11).font('Helvetica'); // NEW: body font
      doc.text(`Cluster: ${bakp.permitCluster.clusterCode}`); // NEW: cluster code
      doc.text(`ISP: ${bakp.permitCluster.ispCustomer}`); // NEW: ISP name
      doc.text(`Status: ${bakp.status}`); // NEW: BAKP status
      doc.moveDown(0.8); // NEW: spacing

      doc.fontSize(12).font('Helvetica-Bold').text('CHECKLIST DOKUMEN'); // NEW: checklist section title
      doc.moveDown(0.3); // NEW: spacing
      checklistRows.forEach(([label, done]) => { // NEW: render checklist rows
        doc.fontSize(11).font('Helvetica').text(`${done ? '✓' : '✗'} ${label}`); // NEW: checklist entry
      });
      doc.moveDown(0.8); // NEW: spacing

      doc.fontSize(12).font('Helvetica-Bold').text('RINGKASAN PEMBAYARAN'); // NEW: payment summary title
      doc.fontSize(11).font('Helvetica').text(`Nilai Pembayaran: ${bakp.paymentAmount ? `Rp ${bakp.paymentAmount.toString()}` : '-'}`); // NEW: payment amount
      doc.text(`Tanggal Pembayaran: ${bakp.paymentDate ? new Date(bakp.paymentDate).toLocaleDateString('id-ID') : '-'}`); // NEW: payment date
      doc.moveDown(0.8); // NEW: spacing

      doc.fontSize(12).font('Helvetica-Bold').text('REFERENSI DOKUMEN'); // NEW: references title
      doc.fontSize(10).font('Helvetica'); // NEW: refs font
      doc.text(`BA Open: ${bakp.permitCluster.baOpen?.documentNumber ?? '-'}`); // NEW: BA Open ref
      doc.text(`BA Survey: ${bakp.permitCluster.socialization?.baSurveyNumber ?? '-'}`); // NEW: BA Survey ref
      doc.text(`MoM Sosialisasi: ${bakp.permitCluster.socialization?.momNumber ?? '-'}`); // NEW: socialization MoM ref
      doc.text(`BAK: ${bakp.permitCluster.bak?.documentNumber ?? '-'}`); // NEW: BAK ref
      doc.text(`MoM SCOM: ${bakp.permitCluster.scom?.momNumber ?? '-'}`); // NEW: SCOM MoM ref
      doc.moveDown(0.8); // NEW: spacing

      doc.fontSize(9).fillColor('gray').text(`Generated by PermaTrax at ${new Date().toLocaleString('id-ID')}`, { align: 'center' }); // NEW: footer line
      doc.end(); // NEW: finalize PDF
    });

    const year = new Date().getFullYear(); // NEW: year folder for S3 key
    const key = `bakp/${year}/${bakp.documentNumber}.pdf`; // NEW: S3 key
    const bundlePdfUrl = await this.storageService.uploadBuffer(key, pdfBuffer, 'application/pdf'); // NEW: upload bundle PDF

    await this.prisma.bakp.update({ // NEW: persist generated bundle URL
      where: { id: bakpId },
      data: { bundlePdfUrl, compiledAt: new Date() },
    });

    this.notificationsGateway.emitToRooms( // NEW: notify leadership roles when bundle is generated
      [`user:${bakp.permitCluster.assignedPmId}`, 'role:PM_SENIOR', 'role:GENERAL_MANAGER'],
      'bakp:approved',
      { bakpId, documentNumber: bakp.documentNumber, bundlePdfUrl },
    );
    this.logger.log(`BAKP bundle generated: ${bundlePdfUrl}`); // NEW: completion log
    return { bundlePdfUrl }; // NEW: job result payload
  }

  @OnQueueFailed() // NEW: queue failure logger
  onFailed(job: Job, error: Error) {
    this.logger.error(`BAKP PDF job ${job.id} failed: ${error.message}`); // NEW: failed job log
  }
}
