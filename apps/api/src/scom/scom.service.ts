import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

@Injectable()
export class ScomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly permitCluster: PermitClusterService,
  ) {}

  private async momSeq(year: number) {
    const count = await this.prisma.scom.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    return `MOM-SCOM-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private buildMomPdf(title: string, lines: string[]): Promise<Buffer> {
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
        doc.moveDown(0.35);
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
      agreementPoints: object;
      workingHours?: string;
      safetyRules?: string;
      cleanlinessRules?: string;
    },
    userId: string,
  ) {
    const pc = await this.prisma.permitCluster.findUnique({ where: { id: permitClusterId } });
    if (!pc) throw new NotFoundException('Cluster tidak ditemukan');
    if (pc.currentPhase !== 'BAK_GENERATION') {
      // MODIFIED: SCOM follows BAK / signature workflow
      throw new BadRequestException(`Fase harus BAK_GENERATION, sekarang: ${pc.currentPhase}`);
    }
    if (await this.prisma.scom.findUnique({ where: { permitClusterId } })) {
      throw new BadRequestException('SCOM sudah ada');
    }

    return this.prisma.scom.create({
      data: {
        permitClusterId,
        conductedBy: userId,
        conductedAt: new Date(dto.conductedAt),
        location: dto.location,
        attendees: dto.attendees as any,
        agreementPoints: dto.agreementPoints as any,
        workingHours: dto.workingHours,
        safetyRules: dto.safetyRules,
        cleanlinessRules: dto.cleanlinessRules,
        createdBy: userId,
        isComplete: false,
      },
    });
  }

  async complete(
    scomId: string,
    pksSignedUrl: string | undefined,
    userId: string,
  ) {
    const row = await this.prisma.scom.findUnique({
      where: { id: scomId },
      include: { permitCluster: true },
    });
    if (!row) throw new NotFoundException('SCOM tidak ditemukan');
    if (row.createdBy !== userId && row.conductedBy !== userId) {
      throw new BadRequestException('Akses ditolak');
    }

    const att = row.attendees as any;
    const pts = row.agreementPoints as any;
    if (!att || (Array.isArray(att) && att.length === 0)) {
      throw new BadRequestException('Peserta wajib diisi');
    }
    if (!pts || (Array.isArray(pts) && pts.length === 0)) {
      throw new BadRequestException('Poin kesepakatan wajib diisi');
    }

    const year = new Date().getFullYear();
    const momNumber = await this.momSeq(year);
    const lines = [
      `Cluster: ${row.permitCluster.clusterCode}`,
      `Lokasi: ${row.location}`,
      `Tanggal: ${row.conductedAt.toISOString()}`,
      `Jam kerja: ${row.workingHours ?? '-'}`,
      `K3 / safety: ${row.safetyRules ?? '-'}`,
      `Kebersihan: ${row.cleanlinessRules ?? '-'}`,
      `Peserta: ${JSON.stringify(row.attendees)}`,
      `Kesepakatan: ${JSON.stringify(row.agreementPoints)}`,
    ];
    const pdfBuf = await this.buildMomPdf(`Minutes of Meeting — ${momNumber}`, lines);
    const momPdfUrl = await this.storage.uploadBuffer(
      `mom-scom/${year}/${momNumber}.pdf`,
      pdfBuf,
      'application/pdf',
    );

    const updated = await this.prisma.scom.update({
      where: { id: scomId },
      data: {
        isComplete: true,
        momNumber,
        momPdfUrl,
        pksSignedUrl: pksSignedUrl ?? row.pksSignedUrl,
        generatedAt: new Date(),
      },
    });

    await this.permitCluster.advancePhaseInternal(row.permitClusterId, 'BAKP_COMPILATION');

    this.gateway.emitToRoom('role:ADMIN', 'scom:completed', {
      scomId,
      permitClusterId: row.permitClusterId,
    });
    this.gateway.emitToRoom(`user:${row.permitCluster.assignedPmId}`, 'scom:completed', {
      scomId,
      permitClusterId: row.permitClusterId,
    });

    return updated;
  }
}
