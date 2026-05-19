import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import {
  LLD_STATUS,
  LLD_STATE_TRANSITIONS,
  isValidLldTransition,
} from '@shared/constants/pipelineStates';

@Injectable()
export class LldService {
  private readonly logger = new Logger(LldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  // VALIDATION: Check if state transition is allowed (using shared constants)
  private validateStateTransition(currentStatus: string, newStatus: string, context: string): void {
    if (!isValidLldTransition(currentStatus as any, newStatus as any)) {
      this.logger.error(`[LLD STATE VIOLATION] ${context}: Cannot transition from ${currentStatus} to ${newStatus}`);
      throw new BadRequestException(`Invalid state transition: ${currentStatus} → ${newStatus}`);
    }
    this.logger.log(`[LLD STATE] ${context}: ${currentStatus} → ${newStatus}`);
  }

  // VALIDATION: Log missing files
  private validateRequiredFiles(lld: any, context: string): void {
    const missing: string[] = [];
    if (!lld.apdFileUrl) missing.push('APD');
    if (!lld.schematicFileUrl) missing.push('Schematic');
    if (!lld.coreConnectionUrl) missing.push('Core Connection');
    if (missing.length > 0) {
      this.logger.warn(`[LLD VALIDATION] ${context}: Missing required files: ${missing.join(', ')}`);
    }
  }

  // VALIDATION: Check if LLD can be submitted (safety check)
  private validateCanSubmit(lld: any, userId: string, userRole: string): void {
    if (!lld) {
      this.logger.error(`[LLD SUBMIT] Cannot submit: LLD record is null`);
      throw new BadRequestException('Cannot submit: LLD record does not exist');
    }

    // Validate role
    const isDesigner = userRole === 'DESIGNER';
    const isPM = userRole?.startsWith('PM_') || userRole === 'PM_SENIOR';
    if (!isDesigner && !isPM) {
      this.logger.error(`[LLD SUBMIT] User ${userId} with role ${userRole} is not authorized to submit`);
      throw new BadRequestException('Only Designer or PM can submit LLD');
    }

    // Validate required files
    const missing: string[] = [];
    if (!lld.apdFileUrl) missing.push('APD');
    if (!lld.schematicFileUrl) missing.push('Schematic');
    if (!lld.coreConnectionUrl) missing.push('Core Connection');
    if (missing.length > 0) {
      this.logger.error(`[LLD SUBMIT] Cannot submit: Missing files: ${missing.join(', ')}`);
      throw new BadRequestException(`Cannot submit: Missing required files: ${missing.join(', ')}`);
    }

    // Validate status (using shared constants)
    const allowedStatuses = [LLD_STATUS.DRAFT, LLD_STATUS.ISP_REVISION, LLD_STATUS.PM_REJECTED, LLD_STATUS.ADMIN_REJECTED];
    if (!allowedStatuses.includes(lld.status as any)) {
      this.logger.error(`[LLD SUBMIT] Cannot submit from status: ${lld.status}`);
      throw new BadRequestException(`Cannot submit from status: ${lld.status}`);
    }

    this.logger.log(`[LLD SUBMIT] ${lld.id}: Validated for user ${userId} (${userRole})`);
  }

  async getByCluster(permitClusterId: string) {
    return this.prisma.lld.findUnique({
      where: { permitClusterId },
      include: { revisions: true },
    });
  }

  // REFACTOR: Designer uploads LLD — initialize with WAITING_INPUT
  async create(
    permitClusterId: string,
    dto: { apdFileUrl?: string; schematicFileUrl?: string; coreConnectionUrl?: string; additionalFiles?: string[] },
    userId: string,
  ) {
    const hasFiles = dto.apdFileUrl || dto.schematicFileUrl || dto.coreConnectionUrl;
    const initialStatus = LLD_STATUS.WAITING_INPUT;

    this.logger.log(`[LLD CREATE] cluster=${permitClusterId}, user=${userId}, hasFiles=${!!hasFiles}`);

    const row = await this.prisma.lld.create({
      data: {
        permitClusterId,
        createdBy: userId,
        apdFileUrl: dto.apdFileUrl ?? null,
        schematicFileUrl: dto.schematicFileUrl ?? null,
        coreConnectionUrl: dto.coreConnectionUrl ?? null,
        additionalFiles: dto.additionalFiles ?? [],
        status: initialStatus,
      },
    });
    await this.permitCluster.advancePhaseInternal(permitClusterId, 'LLD_SUBMISSION'); // FIX Fix 1: advance cluster phase to LLD_SUBMISSION on first upload

    const pc = await this.prisma.permitCluster.findUnique({ // FIX Fix 1: hydrate fiberType + clusterCode for notifications
      where: { id: permitClusterId },
      select: { fiberType: true, clusterCode: true, assignedPmId: true },
    });
    const pmRole = // FIX Fix 1: route notification to the correct PM based on fiber type
      pc?.fiberType === 'FTTB' ? Role.PM_FTTB
      : pc?.fiberType === 'FTTT' ? Role.PM_FTTT
      : Role.PM_FTTH;

    await this.notifications.createForRole(pmRole, { // FIX Fix 1: primary PM queue gets the new LLD review task
      title: '📐 LLD Baru Perlu Review',
      message: `Designer mengupload LLD untuk cluster ${pc?.clusterCode ?? permitClusterId}. Silakan review.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}/lld`,
      entityId: permitClusterId,
    });
    await this.notifications.createForRole(Role.PM_SENIOR, { // FIX Fix 1: PM Senior also monitors every new LLD
      title: '📐 LLD Baru Diupload',
      message: `Designer mengupload LLD cluster ${pc?.clusterCode ?? permitClusterId}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}/lld`,
      entityId: permitClusterId,
    });
    return row;
  }

  async update(
    lldId: string,
    dto: { apdFileUrl?: string; schematicFileUrl?: string; coreConnectionUrl?: string; additionalFiles?: string[] },
    userId: string,
  ) {
    const l = await this.prisma.lld.findUnique({ where: { id: lldId } });
    if (!l) throw new NotFoundException('LLD tidak ada');
    const data: any = {
      ...(dto.apdFileUrl !== undefined && { apdFileUrl: dto.apdFileUrl }),
      ...(dto.schematicFileUrl !== undefined && { schematicFileUrl: dto.schematicFileUrl }),
      ...(dto.coreConnectionUrl !== undefined && { coreConnectionUrl: dto.coreConnectionUrl }),
      ...(dto.additionalFiles !== undefined && { additionalFiles: dto.additionalFiles }),
    };
    void userId; // FIX: tetap ISP_REVISION sampai Designer submit — jangan paksa DRAFT di PATCH
    return this.prisma.lld.update({ where: { id: lldId }, data });
  }

  async submitToIsp(lldId: string, userId: string) {
    const l = await this.prisma.lld.findUnique({ where: { id: lldId } });
    if (!l) throw new NotFoundException('LLD tidak ada');
    void userId;
    return this.prisma.lld.update({
      where: { id: lldId },
      data: { status: 'PENDING_ISP', submittedToIsp: new Date() },
    });
  }

  // FIX Fix 1 — Designer submit → notify PM for review (SUBMITTED_FOR_REVIEW)
  async submit(lldId: string, userId: string) {
    const l = await this.prisma.lld.findUnique({ // FIX Fix 1: load cluster meta for proper PM routing
      where: { id: lldId },
      include: {
        permitCluster: { select: { id: true, clusterCode: true, fiberType: true } },
      },
    });
    if (!l) throw new NotFoundException('LLD tidak ada');

    // FIX: Allow submit from WAITING_INPUT, DRAFT, and all rejection/revision states
    const allowedSubmit = [LLD_STATUS.WAITING_INPUT, LLD_STATUS.DRAFT, LLD_STATUS.ISP_REVISION, LLD_STATUS.PM_REJECTED, LLD_STATUS.ADMIN_REJECTED];
    if (!allowedSubmit.includes(l.status as any)) {
      throw new BadRequestException(`Tidak bisa submit dari status ${l.status}. Status harus WAITING_INPUT, DRAFT, atau rejection/revision state.`);
    }

    // FIX: Validate mandatory documents are uploaded before submission
    const missingDocs: string[] = [];
    if (!l.apdFileUrl) missingDocs.push('APD');
    if (!l.schematicFileUrl) missingDocs.push('Schematic');
    if (!l.coreConnectionUrl) missingDocs.push('Core Connection');
    if (missingDocs.length > 0) {
      throw new BadRequestException(`Dokumen wajib belum lengkap: ${missingDocs.join(', ')}. Silakan upload semua dokumen sebelum submit.`);
    }

    const updated = await this.prisma.lld.update({
      where: { id: lldId },
      data: {
        status: LLD_STATUS.SUBMITTED_FOR_REVIEW,
        submittedAt: new Date(),
        approvedBy: userId,
        rejectionReason: null,
        adminNotes: null,
        ispFeedback: null,
      },
      include: { permitCluster: { select: { clusterCode: true, fiberType: true } } },
    });

    const pc = updated.permitCluster;
    const pmRole = // FIX Fix 1: fiber-specific PM receives the review task
      pc?.fiberType === 'FTTB' ? Role.PM_FTTB
      : pc?.fiberType === 'FTTT' ? Role.PM_FTTT
      : Role.PM_FTTH;

    await this.notifications.createForRole(pmRole, { // FIX Fix 1: PM primary review queue notification
      title: '📋 LLD Siap Direview',
      message: `LLD cluster ${pc?.clusterCode ?? l.permitClusterId} telah disubmit. Silakan review dan approve.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${l.permitClusterId}/lld`,
      entityId: l.permitClusterId,
    });
    return updated;
  }

  async recordIspDecision(
    lldId: string,
    action: 'APPROVE' | 'REVISE',
    feedback: string | undefined,
    userId: string,
  ) {
    const l = await this.prisma.lld.findUnique({
      where: { id: lldId },
      include: { permitCluster: { select: { id: true, clusterCode: true, fiberType: true, assignedPmId: true } } }, // FIX Fix 1: include clusterCode + fiberType for richer notifications
    });
    if (!l) throw new NotFoundException('LLD tidak ada');
    if (l.status !== 'PENDING_ISP') {
      throw new BadRequestException('Hanya LLD menunggu respon ISP (PENDING_ISP) yang bisa diproses'); // FIX: siklus ke-2+ konsisten
    }

    const pc = l.permitCluster;
    const pmRole = // FIX Fix 1: pick fiber-specific PM for notifications
      pc?.fiberType === 'FTTB' ? Role.PM_FTTB
      : pc?.fiberType === 'FTTT' ? Role.PM_FTTT
      : Role.PM_FTTH;

    if (action === 'APPROVE') {
      const u = await this.prisma.lld.update({
        where: { id: lldId },
        data: { status: 'ISP_APPROVED', ispApprovedAt: new Date(), ispFeedback: feedback },
      });
      await this.permitCluster.advancePhaseInternal(l.permitClusterId, 'PR_BR_ISSUANCE'); // FIX Fix 1: advance cluster phase after ISP approves LLD
      if (pc?.assignedPmId) {
        this.gateway.emitToRoom(`user:${pc.assignedPmId}`, 'lld:ispApproved', { lldId });
      }

      await this.notifications.createForRoles( // FIX Fix 1: notify PM Senior + fiber PM + Admin + Ops on ISP approval
        [Role.PM_SENIOR, pmRole, Role.ADMIN, Role.OPERATIONAL_MANAGER],
        {
          title: '🎉 LLD Disetujui ISP!',
          message: `ISP menyetujui LLD cluster ${pc?.clusterCode ?? l.permitClusterId}. Proses berlanjut ke PR/BR.`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${l.permitClusterId}`,
          entityId: l.permitClusterId,
        },
      );

      const designer = await this.prisma.user.findFirst({ // FIX Fix 1: notify Designer — uploader sees their work approved end-to-end
        where: { role: Role.DESIGNER, isActive: true },
      });
      if (designer) {
        await this.notifications.createForUser(designer.id, { // FIX Fix 1: direct-to-designer congratulatory notification
          title: '🎉 LLD Disetujui ISP!',
          message: `LLD cluster ${pc?.clusterCode ?? l.permitClusterId} Anda disetujui ISP!`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${l.permitClusterId}`,
          entityId: l.permitClusterId,
        });
      }
      void userId;
      return u;
    }

    const v = l.version + 1;
    await this.prisma.lldRevision.create({
      data: {
        lldId,
        version: v,
        notes: feedback,
        createdBy: userId,
      },
    });
    const u = await this.prisma.lld.update({
      where: { id: lldId },
      data: { status: 'ISP_REVISION', ispFeedback: feedback, rejectionReason: feedback, version: v },
    });
    if (pc?.assignedPmId) {
      this.gateway.emitToRoom(`user:${pc.assignedPmId}`, 'lld:revisionRequired', { lldId });
    }

    const designer = await this.prisma.user.findFirst({ // FIX Fix 1: notify Designer to take action on ISP revision
      where: { role: Role.DESIGNER, isActive: true },
    });
    if (designer) {
      await this.notifications.createForUser(designer.id, { // FIX Fix 1: actionable revision notification straight to uploader
        title: '↺ LLD Perlu Revisi',
        message: `ISP meminta revisi LLD cluster ${pc?.clusterCode ?? l.permitClusterId}. Feedback: ${feedback || 'Lihat detail'}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${l.permitClusterId}/lld`,
        entityId: l.permitClusterId,
      });
    }
    return u;
  }

  async pmApprove(lldId: string, userId: string) {
    const u = await this.prisma.lld.update({
      where: { id: lldId },
      data: { status: LLD_STATUS.PM_APPROVED, pmApprovedBy: userId, pmApprovedAt: new Date() },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    await this.notifications.createForRole(Role.ADMIN, { // FIX Fix 1: Admin picks up PM-approved LLD for final check before sending to ISP
      title: '✅ LLD Disetujui PM — Perlu Pengecekan Admin',
      message: `PM menyetujui LLD cluster ${u.permitCluster?.clusterCode ?? u.permitClusterId}. Silakan review dan kirim ke ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}/lld`,
      entityId: u.permitClusterId,
    });
    return u;
  }

  /** FIX: PM tolak → DRAFT + Designer revisi (bukan terminal PM_REJECTED) */
  async pmReject(lldId: string, notes: string, userId: string) {
    void userId; // FIX: siap untuk audit log
    const lld = await this.prisma.lld.findUnique({
      where:   { id: lldId },
      include: { permitCluster: { select: { clusterCode: true, fiberType: true, id: true } } },
    });
    if (!lld) throw new NotFoundException('LLD tidak ada'); // FIX
    if (lld.status !== LLD_STATUS.SUBMITTED_FOR_REVIEW) {
      throw new BadRequestException('Hanya LLD dalam review PM yang bisa ditolak'); // FIX
    }
    if (!notes?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi'); // FIX

    const updated = await this.prisma.lld.update({
      where: { id: lldId },
      data: {
        status: LLD_STATUS.DRAFT,
        rejectionReason: notes.trim(), // FIX: catatan PM
        ispFeedback:     notes.trim(), // FIX: tampil di banner revisi
      },
    });

    const designer = await this.prisma.user.findFirst({ where: { role: Role.DESIGNER, isActive: true } });
    if (designer) { // FIX
      await this.notifications.createForUser(designer.id, {
        title: '↺ LLD Perlu Revisi (PM)',
        message: `PM menolak LLD cluster ${lld.permitCluster?.clusterCode ?? ''}. Catatan: ${notes.trim()}`,
        type:    'PERMIT_FLOW',
        link:    `/permit-clusters/${lld.permitClusterId}/lld`,
        entityId: lld.permitClusterId,
      });
    }
    return updated;
  }

  async adminApprove(lldId: string, userId: string) {
    const u = await this.prisma.lld.update({ // FIX Fix 1: Admin approval transitions LLD to PENDING_ISP with SLA deadline
      where: { id: lldId },
      data: {
        status: 'PENDING_ISP',
        adminApprovedBy: userId,
        adminApprovedAt: new Date(),
        slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      include: { permitCluster: { select: { clusterCode: true, fiberType: true } } },
    });

    const pmRole = // FIX Fix 1: pick fiber-specific PM for the "sent to ISP" update
      u.permitCluster?.fiberType === 'FTTB' ? Role.PM_FTTB
      : u.permitCluster?.fiberType === 'FTTT' ? Role.PM_FTTT
      : Role.PM_FTTH;

    await this.notifications.createForRoles( // FIX Fix 1: broad status broadcast — Senior PM + fiber PM + Ops
      [Role.PM_SENIOR, pmRole, Role.OPERATIONAL_MANAGER],
      {
        title: '📤 LLD Dikirim ke ISP',
        message: `Admin mengirim LLD cluster ${u.permitCluster?.clusterCode ?? u.permitClusterId} ke ISP. Menunggu persetujuan.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${u.permitClusterId}/lld`,
        entityId: u.permitClusterId,
      },
    );

    const designer = await this.prisma.user.findFirst({ // FIX Fix 1: direct notification so Designer knows their LLD left the internal chain
      where: { role: Role.DESIGNER, isActive: true },
    });
    if (designer) {
      await this.notifications.createForUser(designer.id, { // FIX Fix 1: personal update on upload progress
        title: '📤 LLD Dikirim ke ISP',
        message: `LLD cluster ${u.permitCluster?.clusterCode ?? u.permitClusterId} yang Anda buat dikirim ke ISP.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${u.permitClusterId}/lld`,
        entityId: u.permitClusterId,
      });
    }
    return u;
  }

  /** FIX: Admin menolak LLD pasca PM_APPROVED — kembali ke DRAFT agar Designer revisi. */
  async adminReject(lldId: string, notes: string, userId: string) {
    void userId; // FIX: reserved for audit / future actor log
    const lld = await this.prisma.lld.findUnique({
      where:   { id: lldId },
      include: { permitCluster: true },
    });
    if (!lld) throw new NotFoundException('LLD tidak ditemukan'); // FIX
    if (lld.status !== LLD_STATUS.PM_APPROVED) {
      throw new BadRequestException('Hanya LLD yang sudah disetujui PM yang bisa ditolak Admin');
    }
    if (!notes?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi'); // FIX

    const updated = await this.prisma.lld.update({
      where: { id: lldId },
      data: {
        status: LLD_STATUS.DRAFT,
        adminNotes: notes.trim(), // FIX: catatan untuk tim desain
        ispFeedback: notes.trim(), // FIX: tampil di UI feedback (shared field)
      },
      include: { permitCluster: true },
    });

    const designer = await this.prisma.user.findFirst({
      where: { role: Role.DESIGNER, isActive: true },
    });
    if (designer) { // FIX: kabari Designer
      await this.notifications.createForUser(designer.id, {
        title: '↺ LLD Perlu Revisi (Admin)',
        message:
          `Admin menolak LLD cluster ${lld.permitCluster?.clusterCode ?? ''}. Catatan: ${notes.trim()}. Silakan upload ulang.`,
        type:    'PERMIT_FLOW',
        link:    `/permit-clusters/${lld.permitClusterId}/lld`,
        entityId: lld.permitClusterId,
      });
    }

    const pmRole = // FIX: kabari PM fiber terkait
      lld.permitCluster?.fiberType === 'FTTB' ? Role.PM_FTTB
      : lld.permitCluster?.fiberType === 'FTTT' ? Role.PM_FTTT
      : Role.PM_FTTH;

    await this.notifications.createForRole(pmRole, {
      title: '↺ LLD Ditolak Admin',
      message: `Admin menolak LLD cluster ${lld.permitCluster?.clusterCode ?? ''}. Designer akan merevisi.`,
      type:    'PERMIT_FLOW',
      link:    `/permit-clusters/${lld.permitClusterId}/lld`,
      entityId: lld.permitClusterId,
    });

    return updated;
  }
}
