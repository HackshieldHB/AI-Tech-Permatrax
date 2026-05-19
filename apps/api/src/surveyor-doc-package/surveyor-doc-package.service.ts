import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DocPackageStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';

@Injectable()
export class SurveyorDocPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async getOrCreate(permitClusterId: string, userId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
      include: { baOpen: true, surveyData: { include: { evidenceFiles: true } } },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan');
    const sip = await this.prisma.sip.findUnique({ where: { permitClusterId } }); // FIX: include SIP readiness in doc checklist
    const data = {
      hasBaOpen: !!cluster.baOpen,
      hasSurveyData: cluster.surveyData?.status === 'COMPLETED',
      hasEvidencePhotos: (cluster.surveyData?.evidenceFiles?.length ?? 0) > 0,
      hasRouteData: cluster.surveyData?.routeGeoJson != null,
      hasSip: sip !== null && sip.siteName !== null, // FIX: SIP must exist and be filled
    };
    return this.prisma.surveyorDocPackage.upsert({
      where: { permitClusterId },
      create: { permitClusterId, submittedBy: userId, ...data },
      update: data,
    });
  }

  async submit(permitClusterId: string, userId: string, options?: { skipPhotoCheck?: boolean }) {
    const pkg = await this.getOrCreate(permitClusterId, userId);
    const missing: string[] = [];
    if (!pkg.hasBaOpen) missing.push('BA Open belum dibuat');
    if (!pkg.hasSurveyData) missing.push('Data survey lapangan belum diisi');
    if (!pkg.hasRouteData) missing.push('Route survey belum selesai'); // FIX: preserve route requirement order per official flow
    if (!(pkg as any).hasSip) missing.push('SIP belum diisi'); // FIX: SIP is mandatory in document list
    if (!pkg.hasEvidencePhotos) { // FIX: evidence photo gate configurable for non-production testing
      const skipPhotoCheck = options?.skipPhotoCheck === true && process.env.NODE_ENV !== 'production'; // FIX: bypass only outside production
      if (!skipPhotoCheck) {
        missing.push('Foto evidence belum diupload (wajib)');
      } else {
        console.warn('[DocPackage] Evidence photos missing — allowing submit in non-production'); // FIX: explicit bypass log
      }
    }
    if (missing.length) throw new BadRequestException(missing.join('; '));
    const updated = await this.prisma.surveyorDocPackage.update({
      where: { id: pkg.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: { permitCluster: true, submitter: true },
    });
    await this.permitCluster.advancePhaseInternal(permitClusterId, 'BA_SURVEY');
    const ft = updated.permitCluster.fiberType;
    const pmRole = ft === 'FTTB' ? Role.PM_FTTB : ft === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    this.gateway.emitToRoom(`role:${pmRole}`, 'docPackage:submittedForReview', {
      clusterId: permitClusterId,
      clusterCode: updated.permitCluster.clusterCode,
      submitterName: updated.submitter.name,
      submittedAt: updated.submittedAt,
    }); // FIX: route socket to PM by fiber
    await this.notifications.createForRole(pmRole, {
      title: 'Dokumen survey siap direview',
      message: `${updated.submitter.name} mengirim paket dokumen untuk cluster ${updated.permitCluster.clusterCode}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });
    await this.notifications.createForRole(Role.PM_SENIOR, {
      title: 'Paket dokumen survey',
      message: `Cluster ${updated.permitCluster.clusterCode} — menunggu review PM`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });
    return updated;
  }

  async pmReview(id: string, action: 'APPROVE' | 'REJECT', notes: string | undefined, pmUserId: string) {
    const status: DocPackageStatus = action === 'APPROVE' ? 'PM_APPROVED' : 'PM_REJECTED';
    const updated = await this.prisma.surveyorDocPackage.update({
      where: { id },
      data: { status, pmReviewedBy: pmUserId, pmReviewedAt: new Date(), pmNotes: notes },
      include: { permitCluster: true, submitter: { select: { id: true, name: true } } },
    });
    this.gateway.emitToRoom(action === 'APPROVE' ? 'role:ADMIN' : `user:${updated.submittedBy}`, action === 'APPROVE' ? 'docPackage:readyForAdminReview' : 'docPackage:rejectedByPm', { clusterId: updated.permitClusterId, notes });
    if (action === 'APPROVE') {
      await this.notifications.createForRole(Role.ADMIN, {
        title: 'Dokumen survey perlu pengecekan admin',
        message: `PM menyetujui paket dokumen cluster ${updated.permitCluster.clusterCode}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
    } else {
      await this.notifications.createForUser(updated.submittedBy, {
        title: 'Dokumen ditolak PM',
        message: notes ?? 'Revisi diperlukan',
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
    }
    return updated;
  }

  async adminReview(id: string, action: 'APPROVE' | 'REJECT', notes: string | undefined, adminUserId: string) {
    const status: DocPackageStatus = action === 'APPROVE' ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED';
    const updated = await this.prisma.surveyorDocPackage.update({
      where: { id },
      data: { status, adminReviewedBy: adminUserId, adminReviewedAt: new Date(), adminNotes: notes },
      include: { permitCluster: true, submitter: { select: { id: true, name: true } } },
    });
    if (action === 'APPROVE') {
      await this.permitCluster.advancePhaseInternal(updated.permitClusterId, 'SIP_REQUEST');
      this.gateway.emitToRoom('role:ADMIN', 'docPackage:adminApproved', { clusterId: updated.permitClusterId, clusterCode: updated.permitCluster.clusterCode });
      const ft = updated.permitCluster.fiberType;
      const pmRole = ft === 'FTTB' ? Role.PM_FTTB : ft === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
      await this.notifications.createForRole(pmRole, {
        title: 'Dokumen disetujui Admin',
        message: `Paket cluster ${updated.permitCluster.clusterCode} siap tahap berikutnya / kirim ISP`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
      await this.notifications.createForUser(updated.submittedBy, {
        title: 'Dokumen disetujui Admin',
        message: `Cluster ${updated.permitCluster.clusterCode} — lanjutkan alur permit`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
    } else {
      this.gateway.emitToRoom('role:PM_SENIOR', 'docPackage:adminRejected', { clusterId: updated.permitClusterId, notes });
    }
    return updated;
  }
}
