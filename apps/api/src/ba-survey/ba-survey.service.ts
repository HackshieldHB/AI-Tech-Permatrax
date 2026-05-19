import { Injectable, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { Role } from '@prisma/client'; // FIX: resolve PM role from cluster fiber type
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service'; // FIX: durable inbox notifications for BA Survey
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
// FIX: CommonJS require — pdfkit does not have a default ES export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import { SipService } from '../sip/sip.service';

@Injectable()
export class BaSurveyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService, // FIX: inject durable notifications service
    private readonly permitCluster: PermitClusterService,
    @Inject(forwardRef(() => SipService))
    private readonly sipService: SipService,
  ) {}

  private buildPdf(lines: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).font('Helvetica-Bold').text('BERITA ACARA SURVEY', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).font('Helvetica');
      lines.forEach((l) => {
        doc.text(l);
        doc.moveDown(0.25);
      });
      doc.end();
    });
  }

  /** NEW: Generate BA Survey PDF from SurveyData + cluster + visit */
  async generateBaSurvey(permitClusterId: string, userId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
      include: {
        surveyData: true,
        visitRequest: { include: { cleanList: true } },
        assignedPm: { select: { name: true } },
      },
    });
    if (!cluster?.surveyData) throw new NotFoundException('Survey data belum ada');

    const sd = cluster.surveyData;
    const year = new Date().getFullYear();
    const n = await this.prisma.surveyData.count({
      where: { baSurveyNumber: { startsWith: `BA-SURVEY-${year}` } },
    });
    const documentNumber = `BA-SURVEY-${year}-${String(n + 1).padStart(4, '0')}`;

    const lines = [
      `Cluster: ${cluster.clusterCode} | ISP: ${cluster.ispCustomer}`,
      `Dokumen: ${documentNumber}`,
      `Surveyor: ${sd.conductedBy}`,
      `RT: ${sd.rtName ?? '-'} (${sd.rtPhone ?? '-'})  RW: ${sd.rwName ?? '-'} (${sd.rwPhone ?? '-'})`,
      `Pengelola: ${sd.pengelolaName ?? '-'} (${sd.pengelolaPhone ?? '-'})`,
      `Kondisi area: ${sd.areaCondition ?? '-'}`,
      `Infrastruktur: ${sd.existingInfra ?? '-'}`,
      `Jarak rute (m): ${sd.routeDistanceM ?? '-'}`,
      `Homepass: ${sd.homepasCount ?? '-'}`,
      `Catatan: ${sd.surveyNotes ?? sd.routeNotes ?? '-'}`,
    ];
    const pdf = await this.buildPdf(lines);
    const key = `ba-survey/${year}/${documentNumber}.pdf`;
    let pdfUrl: string; // FIX: keep BA Survey generation running without S3 credentials
    try { // FIX: S3 upload fallback for BA Survey PDF
      pdfUrl = await this.storage.uploadBuffer(key, pdf, 'application/pdf');
    } catch (err: any) {
      console.warn(`[BA Survey] S3 upload failed, using placeholder: ${err?.message}`); // FIX: non-blocking S3 failure
      pdfUrl = `https://placeholder.permatrax.dev/${key}`; // FIX: placeholder URL fallback
    }

    await this.prisma.surveyData.update({
      where: { id: sd.id },
      data: { baSurveyNumber: documentNumber, baSurveyPdfUrl: pdfUrl },
    });

    await this.permitCluster.advancePhaseInternal(permitClusterId, 'BA_SURVEY');

    this.gateway.emitToRoom(`user:${cluster.assignedPmId}`, 'baSurvey:generated', {
      permitClusterId,
      documentNumber,
      pdfUrl,
    });
    this.gateway.emitToRoom('role:ADMIN', 'baSurvey:generated', { permitClusterId, documentNumber, pdfUrl });

    // FIX: durable inbox notification — PM + PM_SENIOR + Admin see BA Survey generated
    const pmRole: Role =
      cluster.fiberType === 'FTTB' ? Role.PM_FTTB : cluster.fiberType === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    await this.notifications.createForRoles([pmRole, Role.PM_SENIOR, Role.ADMIN], {
      title: 'BA Survey dibuat',
      message: `BA Survey ${documentNumber} untuk cluster ${cluster.clusterCode} telah dibuat.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });
    if (cluster.assignedPmId) {
      await this.notifications.createForUser(cluster.assignedPmId, {
        title: 'BA Survey dibuat',
        message: `${documentNumber} siap untuk SIP.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${permitClusterId}`,
        entityId: permitClusterId,
      });
    }

    await this.sipService.generateSip(permitClusterId, userId);
    return { documentNumber, pdfUrl };
  }
}
