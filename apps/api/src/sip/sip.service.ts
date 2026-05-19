import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Role, SipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
// FIX: CommonJS require — pdfkit does not have a default ES export
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
@Injectable()
export class SipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  // FIX 1: helper to resolve surveyor + PM role + cluster info for SIP notifications
  private async getSipNotifContext(sipId: string) {
    const sip = await this.prisma.sip.findUnique({
      where: { id: sipId },
      include: {
        permitCluster: {
          include: {
            visitRequest: { select: { requestedBy: true } },
          },
        },
      },
    });
    if (!sip) return null;
    const cluster = sip.permitCluster;
    const surveyorId = cluster?.visitRequest?.requestedBy ?? null;
    // FIX 1: map FiberType → PM role (FTTH/FTTB/FTTT) for fan-out
    const pmRole = (`PM_${cluster?.fiberType ?? 'FTTH'}` as unknown) as Role;
    return { sip, cluster, surveyorId, pmRole };
  }

  async initSip(permitClusterId: string, adminId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
      include: { visitRequest: { include: { cleanList: true } }, surveyData: true },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ada');
    const existing = await this.prisma.sip.findUnique({ where: { permitClusterId } });
    if (existing) return existing;
    const year = new Date().getFullYear();
    const count = await this.prisma.sip.count({ where: { createdAt: { gte: new Date(`${year}-01-01`) } } });
    const documentNumber = `SIP-${year}-${String(count + 1).padStart(4, '0')}`;
    const created = await this.prisma.sip.create({
      data: {
        permitClusterId,
        generatedBy: adminId,
        documentNumber,
        ispCustomer: cluster.ispCustomer,
        status: 'DRAFT',
        siteName: cluster.visitRequest?.cleanList?.siteName ?? cluster.visitRequest?.cleanList?.rwCode ?? null,
        coordinates: cluster.visitRequest?.cleanList?.coordinates ?? null,
        homepasCount: cluster.surveyData?.homepasCount ?? cluster.visitRequest?.cleanList?.homepasCount ?? null,
        kelurahan: cluster.visitRequest?.cleanList?.kelurahan ?? null,
        kecamatan: cluster.visitRequest?.cleanList?.kecamatan ?? null,
        kota: cluster.visitRequest?.cleanList?.kotaKabupaten ?? null,
      },
    });

    // FIX 1: notify Admin when SIP record is ready for completion
    await this.notifications.createForRole(Role.ADMIN, {
      title: '📝 SIP Draft Dibuat',
      message: `SIP ${documentNumber} siap untuk diisi lengkap dan dikirim ke ISP (Cluster ${cluster.clusterCode}).`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}/sip`,
      entityId: permitClusterId,
    });

    return created;
  }

  async updateSip(sipId: string, dto: Record<string, unknown>) {
    // FIX 1: load existing SIP so we can detect transitions (e.g. boundaryKmzUrl first upload)
    const before = await this.prisma.sip.findUnique({
      where: { id: sipId },
      include: {
        permitCluster: { select: { id: true, clusterCode: true, fiberType: true } },
      },
    });
    if (!before) throw new NotFoundException('SIP tidak ada');

    const updated = await this.prisma.sip.update({ where: { id: sipId }, data: dto as any });

    // FIX 1: when KMZ boundary is first uploaded and SIP is still DRAFT, notify Admin that SIP siap dikirim
    const kmzJustUploaded =
      !before.boundaryKmzUrl &&
      typeof (dto as any).boundaryKmzUrl === 'string' &&
      ((dto as any).boundaryKmzUrl as string).length > 0;
    if (kmzJustUploaded && updated.status === 'DRAFT') {
      await this.notifications.createForRole(Role.ADMIN, {
        title: '📤 SIP Siap Dikirim ke ISP',
        message: `SIP ${updated.documentNumber} (Cluster ${before.permitCluster.clusterCode}) telah lengkap dengan boundary KMZ. Silakan review dan kirim ke ISP.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${before.permitCluster.id}/sip`,
        entityId: before.permitCluster.id,
      });
    }

    return updated;
  }

  async generateSipPdf(sipId: string, adminId: string) {
    const sip = await this.prisma.sip.findUnique({ where: { id: sipId } });
    if (!sip) throw new NotFoundException('SIP tidak ada');
    const lines = [
      `Section 1: Site Information`,
      `Site Name: ${sip.siteName ?? '-'}`,
      `Coordinates: ${sip.coordinates ?? '-'}`,
      `Residence Type: ${sip.residenceType ?? '-'}`,
      `Classing: ${sip.classing ?? '-'}`,
      `Work Method: ${sip.workMethod ?? '-'}`,
      `Homepass: ${sip.homepasCount ?? '-'}`,
      `Occupancy: ${sip.occupancyPercent ?? '-'}`,
      `Section 2: Personnel`,
      `PIC Kawasan: ${sip.picKawasan ?? '-'}`,
      `Request By: ${sip.requestBy ?? '-'}`,
      `PIC FS: ${sip.picFs ?? '-'}`,
      `PIC CBN: ${sip.picCbn ?? '-'}`,
      `Branch: ${sip.branch ?? '-'}`,
      `Section 3: Location`,
      `Provinsi: ${sip.provinsi ?? '-'}`,
      `Kota: ${sip.kota ?? '-'}`,
      `Kecamatan: ${sip.kecamatan ?? '-'}`,
      `Kelurahan: ${sip.kelurahan ?? '-'}`,
      `Alamat: ${sip.alamat ?? '-'}`,
      `Remarks: ${sip.remarks ?? '-'}`,
      `Boundary KMZ: ${sip.boundaryKmzUrl ?? '-'}`, // FIX 2: include KMZ URL in PDF
    ];
    const pdf = await this.buildPdf(`SIP ${sip.documentNumber}`, lines);
    const year = new Date().getFullYear();
    const key = `sip/${year}/${sip.documentNumber}.pdf`;
    let pdfUrl: string; // FIX: keep SIP generation working without S3
    try { // FIX: S3 upload fallback for SIP PDF
      pdfUrl = await this.storage.uploadBuffer(key, pdf, 'application/pdf');
    } catch (err: any) {
      console.warn(`[SIP] S3 upload failed, using placeholder: ${err?.message}`); // FIX: non-blocking S3 failure
      pdfUrl = `https://placeholder.permatrax.dev/${key}`; // FIX: placeholder URL fallback
    }
    return this.prisma.sip.update({ where: { id: sipId }, data: { pdfUrl, generatedBy: adminId } });
  }

  private buildPdf(title: string, lines: string[]): Promise<Buffer> {
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
        doc.moveDown(0.25);
      });
      doc.end();
    });
  }

  /** NEW: auto after BA Survey */
  async generateSip(permitClusterId: string, userId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
      include: { surveyData: true },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ada');

    const existingSip = await this.prisma.sip.findUnique({ where: { permitClusterId } });
    if (existingSip) {
      await this.permitCluster.advancePhaseInternal(permitClusterId, 'SIP_REQUEST');
      return existingSip;
    }

    const year = new Date().getFullYear();
    const count = await this.prisma.sip.count({ where: { createdAt: { gte: new Date(`${year}-01-01`) } } });
    const documentNumber = `SIP-${year}-${String(count + 1).padStart(4, '0')}`;

    const lines = [
      `Survey Information Permit`,
      `No: ${documentNumber}`,
      `Cluster: ${cluster.clusterCode}`,
      `ISP / Pelanggan: ${cluster.ispCustomer}`,
      `Homepass (estimasi): ${cluster.surveyData?.homepasCount ?? '-'}`,
      `Route (m): ${cluster.surveyData?.routeDistanceM ?? '-'}`,
    ];
    const pdf = await this.buildPdf(`SIP ${documentNumber}`, lines);
    const key = `sip/${year}/${documentNumber}.pdf`;
    let pdfUrl: string; // FIX: keep auto SIP generation working without S3
    try { // FIX: S3 upload fallback for generated SIP PDF
      pdfUrl = await this.storage.uploadBuffer(key, pdf, 'application/pdf');
    } catch (err: any) {
      console.warn(`[SIP] S3 upload failed, using placeholder: ${err?.message}`); // FIX: non-blocking S3 failure
      pdfUrl = `https://placeholder.permatrax.dev/${key}`; // FIX: placeholder URL fallback
    }

    const sip = await this.prisma.sip.create({
      data: {
        permitClusterId,
        documentNumber,
        ispCustomer: cluster.ispCustomer,
        generatedBy: userId,
        pdfUrl,
        status: 'DRAFT',
      },
    });

    await this.permitCluster.advancePhaseInternal(permitClusterId, 'SIP_REQUEST');

    // FIX 1: notify Admin — SIP draft auto-generated from BA Survey, ready for review
    await this.notifications.createForRole(Role.ADMIN, {
      title: '📝 SIP Draft Dibuat Otomatis',
      message: `SIP ${documentNumber} untuk cluster ${cluster.clusterCode} telah dibuat dari BA Survey. Lengkapi data dan kirim ke ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}/sip`,
      entityId: permitClusterId,
    });

    return sip;
  }

  async getByCluster(permitClusterId: string) {
    return this.prisma.sip.findUnique({ where: { permitClusterId } });
  }

  async submitToIsp(sipId: string, _userId: string) {
    // FIX 1: load context for role-specific notifications
    const ctx = await this.getSipNotifContext(sipId);
    if (!ctx) throw new NotFoundException('SIP tidak ada');
    const { sip, cluster, pmRole } = ctx;
    const allowedSubmit: SipStatus[] = [
      SipStatus.DRAFT,
      SipStatus.FILLED,
      SipStatus.ISP_REVISION,
      SipStatus.REJECTED,
    ];
    if (!allowedSubmit.includes(sip.status)) {
      throw new BadRequestException(`SIP tidak bisa disubmit dari status: ${sip.status}`); // FIX: explicit status in error
    }

    const updated = await this.prisma.sip.update({
      where: { id: sipId },
      data: { status: SipStatus.SUBMITTED, submittedAt: new Date() },
    });

    this.gateway.emitToRoom('role:PM_SENIOR', 'sip:submittedToIsp', {
      sipId,
      clusterId: sip.permitClusterId,
      documentNumber: sip.documentNumber,
    });

    // FIX 1: notify PM Senior + PM (fiberType) that SIP was dispatched to ISP
    await this.notifications.createForRoles([Role.PM_SENIOR, pmRole], {
      title: '📤 SIP Dikirim ke ISP',
      message: `SIP ${sip.documentNumber} untuk cluster ${cluster?.clusterCode} telah dikirim ke ISP oleh Admin. Menunggu approval ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${sip.permitClusterId}`,
      entityId: sip.permitClusterId,
    });

    return updated;
  }

  async recordIspDecision(
    sipId: string,
    action: 'APPROVE' | 'REJECT' | 'REVISE',
    feedback: string | undefined,
    _userId: string,
  ) {
    // FIX 1: rich context for fan-out
    const ctx = await this.getSipNotifContext(sipId);
    if (!ctx) throw new NotFoundException('SIP tidak ada');
    const { sip, cluster, surveyorId, pmRole } = ctx;

    if (action === 'APPROVE') {
      const updated = await this.prisma.sip.update({
        where: { id: sipId },
        data: {
          status: SipStatus.APPROVED,
          approvedAt: new Date(),
          ispFeedback: feedback,
        },
      });
      await this.permitCluster.advancePhaseInternal(sip.permitClusterId, 'HLD_SUBMISSION');
      this.gateway.emitToRoom(`user:${cluster?.assignedPmId}`, 'sip:ispApproved', {
        sipId,
        clusterId: sip.permitClusterId,
      });

      // FIX 1: fan out APPROVED notification to PM Senior + PM (fiberType) + Admin + Operational Manager
      await this.notifications.createForRoles(
        [Role.PM_SENIOR, pmRole, Role.ADMIN, Role.OPERATIONAL_MANAGER],
        {
          title: '✅ SIP Disetujui ISP!',
          message: `ISP menyetujui SIP ${sip.documentNumber} untuk cluster ${cluster?.clusterCode}. Tim design dapat mulai upload HLD.`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${sip.permitClusterId}`,
          entityId: sip.permitClusterId,
        },
      );

      // FIX 1: direct ping to surveyor who started the flow
      if (surveyorId) {
        await this.notifications.createForUser(surveyorId, {
          title: '✅ SIP Disetujui ISP!',
          message: `SIP cluster ${cluster?.clusterCode} disetujui. Proses berlanjut ke tahap HLD.`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${sip.permitClusterId}`,
          entityId: sip.permitClusterId,
        });
      }
      return updated;
    }

    if (action === 'REVISE') {
      const updated = await this.prisma.sip.update({
        where: { id: sipId },
        data: {
          status: SipStatus.ISP_REVISION,
          ispFeedback: feedback,
        },
      });
      // Notifications for REVISE
      await this.notifications.createForRoles([Role.PM_SENIOR, pmRole, Role.ADMIN], {
        title: '🔄 SIP Direvisi ISP',
        message: `ISP meminta revisi SIP ${sip.documentNumber} untuk cluster ${cluster?.clusterCode}. Feedback: ${feedback || 'Lihat detail'}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${sip.permitClusterId}`,
        entityId: sip.permitClusterId,
      });
      return updated;
    }

    if (action === 'REJECT' && !feedback?.trim()) {
      throw new BadRequestException('Alasan penolakan ISP wajib diisi');
    }

    const reasonText = (feedback?.trim() || '—') as string;

    const updated = await this.prisma.sip.update({
      where: { id: sipId },
      data: {
        status: SipStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: feedback,
        ispFeedback: feedback,
      },
    });
    this.gateway.emitToRoom(`user:${cluster?.assignedPmId}`, 'sip:ispRejected', {
      sipId,
      clusterId: sip.permitClusterId,
    });

    const rejectMsgBase =
      `ISP menolak SIP ${sip.documentNumber} untuk cluster ${cluster?.clusterCode ?? ''}. ` +
      `Alasan penolakan: ${reasonText}. Silakan revisi data SIP lalu submit ulang ke ISP.`;

    await this.notifications.createForRoles([Role.PM_SENIOR, pmRole, Role.ADMIN], {
      title: '❌ SIP Ditolak ISP — perlu revisi',
      message: rejectMsgBase,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${sip.permitClusterId}/sip`,
      entityId: sip.permitClusterId,
    });

    if (surveyorId) {
      await this.notifications.createForUser(surveyorId, {
        title: '❌ SIP Ditolak ISP — perlu revisi',
        message: rejectMsgBase,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${sip.permitClusterId}/sip`,
        entityId: sip.permitClusterId,
      });
    }
    return updated;
  }

  async presignedDownload(sipId: string) {
    const sip = await this.prisma.sip.findUnique({ where: { id: sipId } });
    if (!sip?.pdfUrl) throw new NotFoundException('PDF tidak ada');
    const key = this.storage.extractKeyFromUploadedUrl(sip.pdfUrl);
    if (!key) throw new BadRequestException('URL tidak valid');
    return this.storage.generatePresignedGetUrl(key);
  }
}
