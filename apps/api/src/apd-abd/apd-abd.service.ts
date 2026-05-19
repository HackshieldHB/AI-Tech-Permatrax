import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { ApdStatus, AbdStatus, Role, TechnicalDiagramType } from '@prisma/client';

@Injectable()
export class ApdAbdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly permitCluster: PermitClusterService,
  ) {}

  private async loadCluster(clusterId: string, userId: string, userRole: Role) {
    const pc = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      include: { apd: true, assignedPm: true },
    });
    if (!pc) throw new NotFoundException('Permit cluster tidak ditemukan');
    if (([Role.PM_FTTH, Role.PM_FTTB, Role.PM_FTTT] as Role[]).includes(userRole) && pc.assignedPmId !== userId) {
      throw new ForbiddenException('Bukan PM untuk cluster ini');
    }
    return pc;
  }

  async getApdAbd(clusterId: string, userId: string, userRole: Role) {
    await this.loadCluster(clusterId, userId, userRole);
    const apd = await this.prisma.apd.findUnique({
      where: { permitClusterId: clusterId },
      include: {
        revisions: true,
        abd: { include: { revisions: true, technicalDiagrams: true } },
      },
    });
    return { apd };
  }

  async createApd(clusterId: string, dto: { notes?: string }, pmUserId: string, userRole: Role) {
    const pc = await this.loadCluster(clusterId, pmUserId, userRole);
    if (pc.currentPhase !== 'HLD_SUBMISSION') {
      // MODIFIED: legacy APD step mapped to HLD_SUBMISSION
      throw new BadRequestException(`Fase tidak sesuai: ${pc.currentPhase}`);
    }
    if (pc.apd) throw new BadRequestException('APD sudah ada');

    return this.prisma.apd.create({
      data: {
        permitClusterId: clusterId,
        createdBy: pmUserId,
        status: 'DRAFT',
        notes: dto.notes,
      },
    });
  }

  async updateApdGis(apdId: string, gisRouteData: object, pmUserId: string) {
    const apd = await this.prisma.apd.findUnique({ where: { id: apdId } });
    if (!apd) throw new NotFoundException('APD tidak ditemukan');
    if (apd.createdBy !== pmUserId) throw new ForbiddenException('Bukan pembuat APD');

    const data: any = { gisRouteData: gisRouteData as any };
    if (apd.status === 'REVISION_REQUIRED') data.status = 'DRAFT';

    return this.prisma.apd.update({ where: { id: apdId }, data });
  }

  async submitApdForDrm(apdId: string, drmScheduledAt: Date, pmUserId: string) {
    const apd = await this.prisma.apd.findUnique({ where: { id: apdId }, include: { permitCluster: true } });
    if (!apd) throw new NotFoundException('APD tidak ditemukan');
    if (apd.createdBy !== pmUserId) throw new ForbiddenException('Bukan pembuat APD');

    const updated = await this.prisma.apd.update({
      where: { id: apdId },
      data: {
        status: 'SUBMITTED_FOR_DRM',
        drmScheduledAt,
      },
    });

    await this.permitCluster.advancePhaseInternal(apd.permitClusterId, 'HLD_SUBMISSION'); // MODIFIED: DRM → HLD

    this.gateway.emitToRoom('role:PM_SENIOR', 'apd:drmScheduled', {
      apdId,
      clusterCode: apd.permitCluster.clusterCode,
      drmDate: drmScheduledAt,
      submittedBy: pmUserId,
    });

    return updated;
  }

  async conductDrm(
    apdId: string,
    drmNotes: string,
    action: 'APPROVE' | 'REVISE',
    pmSeniorId: string,
  ) {
    const apd = await this.prisma.apd.findUnique({
      where: { id: apdId },
      include: { permitCluster: true },
    });
    if (!apd) throw new NotFoundException('APD tidak ditemukan');

    if (action === 'APPROVE') {
      const nextVersion = apd.version;
      const updated = await this.prisma.apd.update({
        where: { id: apdId },
        data: {
          status: 'APPROVED',
          drmNotes,
          drmCompletedAt: new Date(),
          approvedBy: pmSeniorId,
          approvedAt: new Date(),
        },
      });

      await this.prisma.abd.create({
        data: {
          apdId: apd.id,
          createdBy: apd.createdBy,
          status: 'DRAFT',
        },
      });

      await this.permitCluster.advancePhaseInternal(apd.permitClusterId, 'LLD_SUBMISSION'); // MODIFIED: ABD → LLD

      this.gateway.emitToRoom(`user:${apd.permitCluster.assignedPmId}`, 'apd:drmApproved', {
        apdId,
        clusterId: apd.permitClusterId,
      });

      return updated;
    }

    const v = apd.version + 1;
    await this.prisma.apdRevision.create({
      data: {
        apdId,
        version: v,
        notes: drmNotes,
        createdBy: pmSeniorId,
      },
    });

    const updated = await this.prisma.apd.update({
      where: { id: apdId },
      data: { status: 'REVISION_REQUIRED', rejectionReason: drmNotes, version: v },
    });

    this.gateway.emitToRoom(`user:${apd.permitCluster.assignedPmId}`, 'apd:revisionRequired', {
      apdId,
      drmNotes,
    });

    return updated;
  }

  async submitAbdToIsp(abdId: string, fileUrl: string, notes: string | undefined, pmUserId: string) {
    const abd = await this.prisma.abd.findUnique({
      where: { id: abdId },
      include: { apd: { include: { permitCluster: true } } },
    });
    if (!abd) throw new NotFoundException('ABD tidak ditemukan');
    if (abd.createdBy !== pmUserId) throw new ForbiddenException('Bukan pembuat ABD');

    const updated = await this.prisma.abd.update({
      where: { id: abdId },
      data: {
        status: 'SUBMITTED_TO_ISP',
        fileUrl,
        notes,
        submittedToIspAt: new Date(),
      },
    });

    this.gateway.emitToRoom('role:PM_SENIOR', 'abd:submittedToIsp', {
      abdId,
      clusterCode: abd.apd.permitCluster.clusterCode,
    });

    return updated;
  }

  async recordIspDecision(
    abdId: string,
    action: 'APPROVE' | 'REVISE',
    ispFeedback: string,
    pmSeniorId: string,
  ) {
    const abd = await this.prisma.abd.findUnique({
      where: { id: abdId },
      include: { apd: { include: { permitCluster: true } } },
    });
    if (!abd) throw new NotFoundException('ABD tidak ditemukan');

    if (action === 'APPROVE') {
      const updated = await this.prisma.abd.update({
        where: { id: abdId },
        data: {
          status: 'ISP_APPROVED',
          ispFeedback,
          approvedByIspAt: new Date(),
          approvedBy: pmSeniorId,
        },
      });
      await this.permitCluster.advancePhaseInternal(abd.apd.permitClusterId, 'PR_BR_ISSUANCE'); // MODIFIED: sosialisasi → PR/BR

      this.gateway.emitToRoom(`user:${abd.apd.permitCluster.assignedPmId}`, 'abd:ispApproved', {
        abdId,
        clusterId: abd.apd.permitClusterId,
      });
      return updated;
    }

    const v = abd.version + 1;
    await this.prisma.abdRevision.create({
      data: {
        abdId,
        version: v,
        notes: ispFeedback,
        createdBy: pmSeniorId,
      },
    });

    const updated = await this.prisma.abd.update({
      where: { id: abdId },
      data: { status: 'ISP_REVISION_REQUIRED', ispFeedback, rejectionReason: ispFeedback, version: v },
    });

    await this.permitCluster.advancePhaseInternal(abd.apd.permitClusterId, 'LLD_SUBMISSION'); // MODIFIED: revisi ABD → LLD

    this.gateway.emitToRoom(`user:${abd.apd.permitCluster.assignedPmId}`, 'abd:ispRevisionRequired', {
      abdId,
      feedback: ispFeedback,
    });

    return updated;
  }

  async uploadTechnicalDiagram(
    abdId: string,
    type: TechnicalDiagramType,
    fileUrl: string,
    userId: string,
  ) {
    const abd = await this.prisma.abd.findUnique({ where: { id: abdId } });
    if (!abd) throw new NotFoundException('ABD tidak ditemukan');
    if (abd.createdBy !== userId) throw new ForbiddenException('Akses ditolak');

    return this.prisma.technicalDiagram.create({
      data: { abdId, type, fileUrl, uploadedBy: userId },
    });
  }
}
