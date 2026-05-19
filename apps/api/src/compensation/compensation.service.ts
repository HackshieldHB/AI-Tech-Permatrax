import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

const AUTO_THRESHOLD = new Prisma.Decimal(100000);

@Injectable()
export class CompensationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async getByCluster(permitClusterId: string) {
    return this.prisma.compensation.findUnique({
      where: { permitClusterId },
      include: { negotiations: true, bak: true },
    });
  }

  async create(
    permitClusterId: string,
    dto: {
      homepasCount: number;
      scheme: 'PER_HOMEPASS' | 'LUMP_SUM';
      proposedAmount: string;
      notes?: string;
    },
    userId: string,
  ) {
    const pc = await this.prisma.permitCluster.findUnique({ where: { id: permitClusterId } });
    if (!pc) throw new NotFoundException('Cluster tidak ditemukan');
    if (pc.currentPhase !== 'CONTRACT_MANAGEMENT') {
      // MODIFIED: kompensasi mapped under kontrak
      throw new BadRequestException(`Fase tidak valid: ${pc.currentPhase}`);
    }
    if (await this.prisma.compensation.findUnique({ where: { permitClusterId } })) {
      throw new BadRequestException('Kompensasi sudah ada');
    }

    const proposed = new Prisma.Decimal(dto.proposedAmount);

    const comp = await this.prisma.compensation.create({
      data: {
        permitClusterId,
        homepasCount: dto.homepasCount,
        scheme: dto.scheme,
        proposedAmount: proposed,
        notes: dto.notes,
        createdBy: userId,
      },
    });

    await this.prisma.negotiationLog.create({
      data: {
        compensationId: comp.id,
        roundNumber: 1,
        proposedAmount: proposed,
        rtResponse: 'INITIAL',
        recordedBy: userId,
      },
    });

    return this.prisma.compensation.findUnique({
      where: { id: comp.id },
      include: { negotiations: true },
    });
  }

  async addNegotiationRound(
    compensationId: string,
    dto: { proposedAmount: string; rtResponse: string; notes?: string },
    userId: string,
  ) {
    const comp = await this.prisma.compensation.findUnique({
      where: { id: compensationId },
      include: { permitCluster: true },
    });
    if (!comp) throw new NotFoundException('Tidak ada');

    const lastRound = await this.prisma.negotiationLog.findFirst({
      where: { compensationId },
      orderBy: { roundNumber: 'desc' },
    });
    const next = (lastRound?.roundNumber ?? 0) + 1;

    await this.prisma.negotiationLog.create({
      data: {
        compensationId,
        roundNumber: next,
        proposedAmount: new Prisma.Decimal(dto.proposedAmount),
        rtResponse: dto.rtResponse,
        notes: dto.notes,
        recordedBy: userId,
      },
    });

    if (dto.rtResponse === 'AGREED') {
      const finalAmt = new Prisma.Decimal(dto.proposedAmount);
      await this.prisma.compensation.update({
        where: { id: compensationId },
        data: {
          agreementStatus: 'AGREED',
          negotiatedAmount: finalAmt,
          finalAmount: finalAmt,
        },
      });
      return this.generateBak(compensationId, userId);
    }

    return this.prisma.compensation.findUnique({
      where: { id: compensationId },
      include: { negotiations: true },
    });
  }

  async generateBak(compensationId: string, createdBy: string) {
    const comp = await this.prisma.compensation.findUnique({
      where: { id: compensationId },
      include: { permitCluster: true },
    });
    if (!comp) throw new NotFoundException('Kompensasi tidak ada');
    if (!comp.finalAmount) throw new BadRequestException('Jumlah final belum ada');

    if (await this.prisma.bak.findUnique({ where: { compensationId } })) {
      throw new BadRequestException('BAK sudah dibuat');
    }

    const year = new Date().getFullYear();
    const count = await this.prisma.bak.count({
      where: { createdAt: { gte: new Date(`${year}-01-01`) } },
    });
    const documentNumber = `BAK-${year}-${String(count + 1).padStart(4, '0')}`;

    const finalAmount = comp.finalAmount;
    const auto = finalAmount.lte(AUTO_THRESHOLD);

    const bak = await this.prisma.bak.create({
      data: {
        permitClusterId: comp.permitClusterId,
        compensationId: comp.id,
        documentNumber,
        finalAmount,
        recipientName: '—',
        recipientBank: '—',
        recipientAccount: '—',
        status: auto ? 'AUTO_APPROVED' : 'PENDING_APPROVAL',
        autoApproved: auto,
        createdBy,
        ...(auto && { approvedAt: new Date(), approvedBy: createdBy }),
      },
    });

    const pdfBuf = await this.buildBakPdf(documentNumber, comp, finalAmount);
    const pdfUrl = await this.storage.uploadBuffer(
      `bak/${year}/${documentNumber}.pdf`,
      pdfBuf,
      'application/pdf',
    );

    await this.prisma.bak.update({
      where: { id: bak.id },
      data: { pdfUrl, generatedAt: new Date() },
    });

    if (auto) {
      await this.permitCluster.advancePhaseInternal(comp.permitClusterId, 'BAK_GENERATION');
      this.gateway.emitToRoom(`user:${comp.permitCluster.assignedPmId}`, 'bak:autoApproved', {
        bakId: bak.id,
        documentNumber,
      });
    } else {
      await this.permitCluster.advancePhaseInternal(comp.permitClusterId, 'BAK_GENERATION'); // MODIFIED
      this.gateway.emitToRoom('role:PM_SENIOR', 'bak:pendingApproval', {
        bakId: bak.id,
        documentNumber,
        amount: finalAmount.toString(),
        clusterCode: comp.permitCluster.clusterCode,
      });
    }

    return this.prisma.bak.findUnique({ where: { id: bak.id } });
  }

  private buildBakPdf(
    documentNumber: string,
    comp: any,
    amount: Prisma.Decimal,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.fontSize(14).text('BERITA ACARA KESEPAKATAN (BAK)', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`No: ${documentNumber}`);
      doc.text(`Cluster: ${comp.permitCluster.clusterCode}`);
      doc.text(`Jumlah: Rp ${amount.toString()}`);
      doc.end();
    });
  }

  async approveBak(
    bakId: string,
    action: 'APPROVE' | 'REJECT',
    notes: string | undefined,
    pmSeniorId: string,
  ) {
    const bak = await this.prisma.bak.findUnique({
      where: { id: bakId },
      include: { permitCluster: true },
    });
    if (!bak) throw new NotFoundException('BAK tidak ada');

    if (action === 'APPROVE') {
      await this.prisma.bak.update({
        where: { id: bakId },
        data: {
          status: 'APPROVED',
          approvedBy: pmSeniorId,
          approvedAt: new Date(),
        },
      });
      await this.permitCluster.advancePhaseInternal(bak.permitClusterId, 'BAK_GENERATION'); // MODIFIED
      this.gateway.emitToRoom(`user:${bak.permitCluster.assignedPmId}`, 'bak:approved', { bakId });
      return this.prisma.bak.findUnique({ where: { id: bakId } });
    }

    await this.prisma.bak.update({
      where: { id: bakId },
      data: { status: 'REJECTED', rejectionReason: notes },
    });
    await this.permitCluster.advancePhaseInternal(bak.permitClusterId, 'CONTRACT_MANAGEMENT'); // MODIFIED
    this.gateway.emitToRoom(`user:${bak.permitCluster.assignedPmId}`, 'bak:rejected', { bakId, notes });
    return this.prisma.bak.findUnique({ where: { id: bakId } });
  }
}

