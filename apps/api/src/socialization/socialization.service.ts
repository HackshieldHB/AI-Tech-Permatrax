import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { SocializationAgreement } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

@Injectable()
export class SocializationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly permitCluster: PermitClusterService,
  ) {}

  private async seq(prefix: string, year: number) {
    const count = await this.prisma.socialization.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    return `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private async buildPdfBuffer(title: string, lines: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).font('Helvetica');
      lines.forEach((l) => {
        doc.text(l);
        doc.moveDown(0.3);
      });
      doc.end();
    });
  }

  async create(
    permitClusterId: string,
    dto: {
      conductedAt: string;
      location: string;
      attendees: object;
      constructionScope?: string;
      affectedRoutes?: string;
      plannedSchedule?: string;
      communityFeedback?: string;
    },
    userId: string,
  ) {
    const pc = await this.prisma.permitCluster.findUnique({ where: { id: permitClusterId } });
    if (!pc) throw new NotFoundException('Cluster tidak ditemukan');
    if (pc.currentPhase !== 'PR_BR_ISSUANCE') {
      // MODIFIED: sosialisasi mapped to PR_BR_ISSUANCE
      throw new BadRequestException(`Fase harus PR_BR_ISSUANCE, sekarang: ${pc.currentPhase}`);
    }
    if (await this.prisma.socialization.findUnique({ where: { permitClusterId } })) {
      throw new BadRequestException('Sosialisasi sudah ada');
    }

    const year = new Date().getFullYear();
    const baSurveyNumber = await this.seq('BA-SURVEY-SOC', year);
    const momNumber = await this.seq('MOM-SOC', year);

    const soc = await this.prisma.socialization.create({
      data: {
        permitClusterId,
        conductedBy: userId,
        conductedAt: new Date(dto.conductedAt),
        location: dto.location,
        attendees: dto.attendees as any,
        constructionScope: dto.constructionScope,
        affectedRoutes: dto.affectedRoutes,
        plannedSchedule: dto.plannedSchedule,
        communityFeedback: dto.communityFeedback,
        evidencePhotos: [],
        baSurveyNumber,
        momNumber,
      },
    });

    const clusterLine = `Cluster: ${pc.clusterCode} | ISP: ${pc.ispCustomer}`;
    const baPdf = await this.buildPdfBuffer(`BA SURVEY — ${baSurveyNumber}`, [
      clusterLine,
      `Tanggal: ${new Date(dto.conductedAt).toLocaleString('id-ID')}`,
      `Lokasi: ${dto.location}`,
      `Peserta: ${JSON.stringify(dto.attendees)}`,
      `Ruang lingkup: ${dto.constructionScope ?? '-'}`,
      `Feedback warga: ${dto.communityFeedback ?? '-'}`,
    ]);
    const momPdf = await this.buildPdfBuffer(`MoM SOSIALISASI — ${momNumber}`, [
      clusterLine,
      `Ringkasan diskusi dan kesepakatan`,
      `Jadwal rencana: ${dto.plannedSchedule ?? '-'}`,
    ]);

    const baUrl = await this.storage.uploadBuffer(
      `ba-survey/${year}/${baSurveyNumber}.pdf`,
      baPdf,
      'application/pdf',
    );
    const momUrl = await this.storage.uploadBuffer(
      `mom/${year}/${momNumber}.pdf`,
      momPdf,
      'application/pdf',
    );

    const updated = await this.prisma.socialization.update({
      where: { id: soc.id },
      data: {
        baSurveyPdfUrl: baUrl,
        momPdfUrl: momUrl,
        generatedAt: new Date(),
      },
    });

    this.gateway.emitToRoom(`user:${pc.assignedPmId}`, 'socialization:documentsGenerated', {
      permitClusterId,
      baSurveyUrl: baUrl,
      momUrl,
    });
    this.gateway.emitToRoom('role:ADMIN', 'socialization:documentsGenerated', {
      permitClusterId,
      baSurveyUrl: baUrl,
      momUrl,
    });

    return updated;
  }

  async updateAgreementStatus(id: string, status: SocializationAgreement, _userId: string) {
    const soc = await this.prisma.socialization.findUnique({
      where: { id },
      include: { permitCluster: true },
    });
    if (!soc) throw new NotFoundException('Sosialisasi tidak ditemukan');

    await this.prisma.socialization.update({
      where: { id },
      data: { agreementStatus: status },
    });

    if (status === 'AGREED') {
      await this.permitCluster.advancePhaseInternal(soc.permitClusterId, 'CONTRACT_MANAGEMENT'); // MODIFIED
    } else if (status === 'REJECTED') {
      await this.prisma.permitCluster.update({
        where: { id: soc.permitClusterId },
        data: { status: 'ON_HOLD' },
      });
    }

    return this.prisma.socialization.findUnique({ where: { id } });
  }

  async uploadEvidence(id: string, photoUrls: string[], _userId: string) {
    const soc = await this.prisma.socialization.findUnique({ where: { id } });
    if (!soc) throw new NotFoundException('Tidak ditemukan');
    return this.prisma.socialization.update({
      where: { id },
      data: { evidencePhotos: [...soc.evidencePhotos, ...photoUrls] },
    });
  }
}
