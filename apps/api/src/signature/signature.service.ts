import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';

@Injectable()
export class SignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async getSignaturesForBak(bakId: string) {
    return this.prisma.signatureRecord.findMany({
      where: { bakId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addSignature(
    bakId: string,
    dto: {
      signatoryName: string;
      signatoryNik: string;
      signatoryRole: string;
      ktpPhotoUrl?: string;
      signatureUrl?: string;
      hasStamp?: boolean;
    },
    userId: string,
  ) {
    const bak = await this.prisma.bak.findUnique({
      where: { id: bakId },
      include: { permitCluster: true },
    });
    if (!bak) throw new NotFoundException('BAK tidak ada');

    return this.prisma.signatureRecord.create({
      data: {
        bakId,
        signatoryName: dto.signatoryName,
        signatoryNik: dto.signatoryNik,
        signatoryRole: dto.signatoryRole,
        ktpPhotoUrl: dto.ktpPhotoUrl,
        signatureUrl: dto.signatureUrl,
        hasStamp: dto.hasStamp ?? false,
      },
    });
  }

  async validateSignature(
    signatureId: string,
    action: 'VALID' | 'INVALID',
    reason: string | undefined,
    adminId: string,
  ) {
    const sig = await this.prisma.signatureRecord.findUnique({
      where: { id: signatureId },
      include: {
        bak: {
          include: {
            permitCluster: { include: { visitRequest: { select: { requestedBy: true } } } },
          },
        },
      },
    });
    if (!sig) throw new NotFoundException('Tanda tangan tidak ada');

    if (action === 'VALID') {
      await this.prisma.signatureRecord.update({
        where: { id: signatureId },
        data: {
          validationStatus: 'VALID',
          validatedBy: adminId,
          validatedAt: new Date(),
        },
      });

      const all = await this.prisma.signatureRecord.findMany({ where: { bakId: sig.bakId } });
      const allValid = all.length > 0 && all.every((s) => s.validationStatus === 'VALID');
      if (allValid) {
        await this.prisma.bak.update({
          where: { id: sig.bakId },
          data: { status: 'SIGNATURES_VALID' },
        });
        // MODIFIED: stay on BAK_GENERATION until SCOM completes (avoid backward phase jumps vs 20-step order)
        await this.permitCluster.advancePhaseInternal(sig.bak.permitClusterId, 'BAK_GENERATION');
        this.gateway.emitToRoom(`user:${sig.bak.permitCluster.assignedPmId}`, 'signatures:allValid', {
          bakId: sig.bakId,
        });
        this.gateway.emitToRoom('role:ADMIN', 'signatures:allValid', { bakId: sig.bakId });
      }
      return this.prisma.signatureRecord.findUnique({ where: { id: signatureId } });
    }

    const att = (sig.attemptNumber ?? 1) + 1;
    await this.prisma.signatureRecord.update({
      where: { id: signatureId },
      data: {
        validationStatus: 'INVALID',
        rejectionReason: reason,
        attemptNumber: att,
        validatedBy: adminId,
        validatedAt: new Date(),
      },
    });

    const pmId = sig.bak.permitCluster.assignedPmId;
    const surveyorId = sig.bak.permitCluster.visitRequest?.requestedBy;
    this.gateway.emitToRoom(`user:${pmId}`, 'signature:invalid', {
      signatureId,
      bakId: sig.bakId,
    });
    if (surveyorId) {
      this.gateway.emitToRoom(`user:${surveyorId}`, 'signature:invalid', {
        signatureId,
        bakId: sig.bakId,
      });
    }
    return this.prisma.signatureRecord.findUnique({ where: { id: signatureId } });
  }
}
