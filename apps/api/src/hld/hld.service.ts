import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import {
  HLD_STATUS,
  HLD_STATE_TRANSITIONS,
  HLD_UPLOAD_STATES,
  HLD_SUBMIT_STATES,
  HLD_IMMUTABLE_SNAPSHOT_STATES,
  WAITING_INPUT_STALE_DAYS,
  isValidHldTransition,
  canUploadHld,
  canSubmitHld,
  isSnapshotImmutableHld,
  isIdempotentTransition,
  shouldSkipTransition,
  createStateTransitionLog,
  createStateViolationLog,
  createStateTimeoutLog,
  createSnapshotViolationLog,
  createFileIntegrityLog,
} from '@shared/constants/pipelineStates';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class HldService {
  private readonly logger = new Logger(HldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
    private readonly storageService: StorageService, // HARDEN: For file integrity validation
  ) {}

  // HARDEN: Check if state transition is allowed using shared constants
  private validateStateTransition(
    hldId: string,
    currentStatus: string,
    newStatus: string,
    userId: string,
    role: string,
  ): void {
    if (!isValidHldTransition(currentStatus as any, newStatus as any)) {
      const error = createStateViolationLog('HLD', hldId, userId, role, currentStatus, newStatus);
      this.logger.error(JSON.stringify(error));
      throw new BadRequestException(`Invalid state transition: ${currentStatus} → ${newStatus}`);
    }
    const log = createStateTransitionLog('HLD', hldId, userId, role, currentStatus, newStatus);
    this.logger.log(JSON.stringify(log));
  }

  // HARDEN: Check if snapshot fields are immutable
  private validateSnapshotImmutability(hld: any, attemptedUpdates: string[]): void {
    if (isSnapshotImmutableHld(hld.status)) {
      const immutableFields = [
        'pmApproverName',
        'pmApproverRole',
        'pmApproverSignatureUrl',
        'adminApproverName',
        'adminApproverRole',
        'adminApproverSignatureUrl',
      ];
      const blockedFields = attemptedUpdates.filter(f => immutableFields.includes(f));
      if (blockedFields.length > 0) {
        const error = createSnapshotViolationLog('HLD', hld.id, blockedFields, hld.status, 'system');
        this.logger.error(JSON.stringify(error));
        throw new BadRequestException(`Cannot modify approval snapshots in status ${hld.status}`);
      }
    }
  }

  // HARDEN: Update lastActivityAt timestamp
  private getActivityUpdate(): { lastActivityAt: Date } {
    return { lastActivityAt: new Date() };
  }

  // HARDEN: Check for stale WAITING_INPUT state and update database
  async checkAndMarkStale(hldId: string): Promise<boolean> {
    const hld = await this.prisma.hld.findUnique({ where: { id: hldId } });
    if (!hld || hld.status !== HLD_STATUS.WAITING_INPUT || !hld.lastActivityAt) {
      return false;
    }

    const daysInactive = Math.floor(
      (Date.now() - hld.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysInactive > WAITING_INPUT_STALE_DAYS && !hld.isStale) {
      // FINAL HARDEN: Actually mark as stale in database
      await this.prisma.hld.update({
        where: { id: hldId },
        data: { isStale: true, staleMarkedAt: new Date() },
      });

      const log = createStateTimeoutLog('HLD', hldId, hld.status, daysInactive, true);
      this.logger.warn(JSON.stringify(log));
      return true;
    }

    return false;
  }

  // HARDEN: Validate file integrity in storage
  async validateFileIntegrity(fileUrl: string, fileType: string, hldId: string): Promise<boolean> {
    try {
      // Check file exists and has content
      const fileInfo = await this.storageService.getFileInfo(fileUrl);
      const valid = fileInfo.exists && fileInfo.size > 0;

      const log = createFileIntegrityLog('HLD', hldId, fileType, fileUrl, valid, valid ? undefined : 'File missing or empty');
      this.logger.log(JSON.stringify(log));

      if (!valid) {
        throw new BadRequestException(`File integrity check failed for ${fileType}: ${fileUrl}`);
      }
      return true;
    } catch (error) {
      const log = createFileIntegrityLog('HLD', hldId, fileType, fileUrl, false, String(error));
      this.logger.error(JSON.stringify(log));
      throw new BadRequestException(`Cannot access file ${fileType}: ${fileUrl}`);
    }
  }

  // HARDEN: Idempotent state transition with skip check
  private async executeStateTransition(
    hldId: string,
    currentStatus: string,
    targetStatus: string,
    userId: string,
    role: string,
    updateData: any,
  ): Promise<any> {
    // Check idempotency - already in target state
    const { skip, reason } = shouldSkipTransition(currentStatus, targetStatus);
    if (skip) {
      this.logger.log(`[HLD IDEMPOTENT] ${hldId}: ${reason}, returning existing record`);
      return this.prisma.hld.findUnique({ where: { id: hldId } });
    }

    // Validate transition is allowed
    if (!isValidHldTransition(currentStatus as any, targetStatus as any)) {
      const log = createStateViolationLog('HLD', hldId, userId, role, currentStatus, targetStatus);
      this.logger.error(JSON.stringify(log));
      throw new BadRequestException(`Invalid state transition: ${currentStatus} → ${targetStatus}`);
    }

    // Execute transition with structured logging
    const result = await this.prisma.hld.update({
      where: { id: hldId },
      data: { ...updateData, status: targetStatus },
    });

    const log = createStateTransitionLog('HLD', hldId, userId, role, currentStatus, targetStatus);
    this.logger.log(JSON.stringify(log));

    return result;
  }

  // VALIDATION: Log missing files
  private validateRequiredFiles(hld: any, context: string): void {
    const missing: string[] = [];
    if (!hld.kmzFileUrl) missing.push('KMZ');
    if (!hld.boqFileUrl) missing.push('BOQ');
    if (missing.length > 0) {
      this.logger.warn(`[HLD VALIDATION] ${context}: Missing required files: ${missing.join(', ')}`);
    }
  }

  async getByCluster(permitClusterId: string) {
    return this.prisma.hld.findUnique({
      where: { permitClusterId },
      include: { revisions: true },
    });
  }

  async create(
    permitClusterId: string,
    dto: { kmzFileUrl?: string; boqFileUrl?: string; additionalFiles?: string[] },
    userId: string,
  ) {
    // HARDEN: Initialize with WAITING_INPUT — upload UI visible but not yet "drafted"
    const hasMinimumFiles = dto.kmzFileUrl && dto.boqFileUrl; // HARDEN: Both required
    const initialStatus = HLD_STATUS.WAITING_INPUT;

    this.logger.log(`[HLD CREATE] cluster=${permitClusterId}, user=${userId}, hasMinimumFiles=${!!hasMinimumFiles}`);

    const row = await this.prisma.hld.create({
      data: {
        permitClusterId,
        createdBy: userId,
        kmzFileUrl: dto.kmzFileUrl ?? null,
        boqFileUrl: dto.boqFileUrl ?? null,
        additionalFiles: dto.additionalFiles ?? [],
        status: initialStatus,
        lastActivityAt: new Date(), // HARDEN: Track initial activity
      },
      include: { revisions: true },
    });

    // Only advance phase when minimum required files are uploaded
    if (hasMinimumFiles) {
      await this.permitCluster.advancePhaseInternal(permitClusterId, 'HLD_SUBMISSION');
      this.logger.log(`[HLD CREATE] Phase advanced to HLD_SUBMISSION for cluster=${permitClusterId}`);
    } else {
      this.logger.log(`[HLD CREATE] Staying in WAITING_INPUT - missing required files for cluster=${permitClusterId}`);
    }

    return row;
  }

  async update(
    hldId: string,
    dto: { kmzFileUrl?: string; boqFileUrl?: string; additionalFiles?: string[] },
    userId: string,
    userRole: string,
  ) {
    const h = await this.prisma.hld.findUnique({ where: { id: hldId } });
    if (!h) throw new NotFoundException('HLD tidak ada');

    // HARDEN: Validate snapshot immutability
    const attemptedFields = Object.keys(dto).filter(k => !['kmzFileUrl', 'boqFileUrl', 'additionalFiles'].includes(k));
    this.validateSnapshotImmutability(h, attemptedFields);

    const data: any = {
      ...(dto.kmzFileUrl !== undefined && { kmzFileUrl: dto.kmzFileUrl }),
      ...(dto.boqFileUrl !== undefined && { boqFileUrl: dto.boqFileUrl }),
      ...(dto.additionalFiles !== undefined && { additionalFiles: dto.additionalFiles }),
      ...this.getActivityUpdate(), // HARDEN: Update activity timestamp
    };

    // HARDEN: State machine transitions for update with minimum files check
    if (h.status === HLD_STATUS.WAITING_INPUT) {
      // Only transition to DRAFT if BOTH required files are present
      const willHaveKMZ = dto.kmzFileUrl !== undefined ? dto.kmzFileUrl : h.kmzFileUrl;
      const willHaveBOQ = dto.boqFileUrl !== undefined ? dto.boqFileUrl : h.boqFileUrl;
      const hasMinimumFiles = willHaveKMZ && willHaveBOQ;

      if (hasMinimumFiles) {
        this.validateStateTransition(hldId, h.status, HLD_STATUS.DRAFT, userId, userRole);
        data.status = HLD_STATUS.DRAFT;
        this.logger.log(`[HLD UPDATE] ${hldId}: Minimum files met, transitioning WAITING_INPUT → DRAFT`);
      } else {
        this.logger.log(`[HLD UPDATE] ${hldId}: Staying in WAITING_INPUT - missing required files`);
      }
    } else if (h.status === HLD_STATUS.ISP_REVISION) {
      this.validateStateTransition(hldId, h.status, HLD_STATUS.DRAFT, userId, userRole);
      data.status = HLD_STATUS.DRAFT;
    }

    this.validateRequiredFiles({ ...h, ...data }, `update(${hldId})`);

    // HARDEN: Check for stale state after update
    await this.checkAndMarkStale(hldId);

    return this.prisma.hld.update({ where: { id: hldId }, data });
  }

  async submitToIsp(hldId: string, userId: string) {
    const h = await this.prisma.hld.findUnique({ where: { id: hldId }, include: { permitCluster: true } });
    if (!h) throw new NotFoundException('HLD tidak ada');
    const updated = await this.prisma.hld.update({
      where: { id: hldId },
      data: { status: 'PENDING_ISP', submittedToIsp: new Date() }, // MODIFIED: status aligned with PM/Admin chain
    });
    this.gateway.emitToRoom('role:PM_SENIOR', 'hld:submittedToIsp', { hldId, clusterId: h.permitClusterId });
    void userId;
    return updated;
  }

  async submit(hldId: string, userId: string) {
    // FIX: Load HLD data first to validate status and documents
    const h = await this.prisma.hld.findUnique({
      where: { id: hldId },
      include: { permitCluster: { select: { id: true, clusterCode: true, fiberType: true } } },
    });
    if (!h) throw new NotFoundException('HLD tidak ada');

    // FIX: Validate status allows submission
    if (!canSubmitHld(h.status as any)) {
      throw new BadRequestException(`Tidak bisa submit dari status ${h.status}. Status harus WAITING_INPUT, DRAFT, atau rejection/revision state.`);
    }

    // FIX: Validate mandatory documents are uploaded before submission
    const missingDocs: string[] = [];
    if (!h.kmzFileUrl) missingDocs.push('KMZ');
    if (!h.boqFileUrl) missingDocs.push('BOQ');
    if (missingDocs.length > 0) {
      throw new BadRequestException(`Dokumen wajib belum lengkap: ${missingDocs.join(', ')}. Silakan upload semua dokumen sebelum submit.`);
    }

    const updated = await this.prisma.hld.update({
      where: { id: hldId },
      data: { status: HLD_STATUS.SUBMITTED_FOR_REVIEW, submittedAt: new Date(), approvedBy: userId },
      include: { permitCluster: { select: { id: true, clusterCode: true, fiberType: true } } },
    }); // NEW: submit HLD for PM review

    // FIX: notify PM_SENIOR + fiber-specific PM so HLD shows up in their review inbox
    const pmRole: Role =
      updated.permitCluster?.fiberType === 'FTTB'
        ? Role.PM_FTTB
        : updated.permitCluster?.fiberType === 'FTTT'
          ? Role.PM_FTTT
          : Role.PM_FTTH;
    await this.notifications.createForRoles([Role.PM_SENIOR, pmRole], {
      title: 'HLD baru perlu review',
      message: `HLD cluster ${updated.permitCluster?.clusterCode ?? updated.permitClusterId} disubmit — menunggu review PM.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${updated.permitClusterId}`,
      entityId: updated.permitClusterId,
    });

    return updated;
  }

  async pmApprove(hldId: string, userId: string) {
    // REFACTOR: Fetch PM data for snapshot storage
    const pmUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true, signatureUrl: true },
    });

    if (!pmUser) {
      this.logger.error(`[HLD PM_APPROVE] Approver user not found: ${userId}`);
      throw new NotFoundException('Approver data not found');
    }

    // REFACTOR: Validate PM role
    const isPMRole = pmUser.role?.startsWith('PM_') || pmUser.role === 'PM_SENIOR';
    if (!isPMRole) {
      this.logger.error(`[HLD PM_APPROVE] User ${userId} with role ${pmUser.role} is not authorized to PM approve`);
      throw new BadRequestException('Only PM can perform PM approval');
    }

    // Log signature validation
    if (!pmUser.signatureUrl) {
      this.logger.warn(`[HLD PM_APPROVE] PM ${userId} has no signature stored`);
    }

    const u = await this.prisma.hld.update({
      where: { id: hldId },
      data: {
        status: 'PM_APPROVED',
        pmApprovedBy: userId,
        pmApprovedAt: new Date(),
        // SNAPSHOT: Store PM data at approval time for document consistency
        pmApproverName: pmUser.name,
        pmApproverRole: pmUser.role,
        pmApproverSignatureUrl: pmUser.signatureUrl,
      },
      include: { permitCluster: { select: { id: true, clusterCode: true } } },
    });

    this.logger.log(`[HLD PM_APPROVE] ${hldId}: PM ${pmUser.name} (${pmUser.role}) approved`);

    await this.notifications.createForRole(Role.ADMIN, {
      title: 'HLD perlu pengecekan admin',
      message: `Cluster ${u.permitCluster?.clusterCode ?? u.permitClusterId}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });
    return u;
  }

  async pmReject(hldId: string, notes: string | undefined, _userId: string) {
    void _userId; // FIX: reserved for audit expansion
    const hld = await this.prisma.hld.findUnique({
      where: { id: hldId },
      include: { permitCluster: { select: { clusterCode: true, id: true } } },
    });
    if (!hld) throw new NotFoundException('HLD tidak ada');
    const updated = await this.prisma.hld.update({
      where: { id: hldId },
      data: {
        status: 'DRAFT', // FIX: designer can revise after PM rejection
        pmNotes: notes ?? null,
        pmRejectedAt: new Date(),
      },
      include: { permitCluster: { select: { clusterCode: true, id: true } } },
    });
    await this.notifications.createForRole(Role.DESIGNER, {
      title: '↺ HLD Perlu Revisi (PM)',
      message: `PM menolak HLD cluster ${hld.permitCluster?.clusterCode ?? ''}. Catatan: ${notes ?? '—'}. Silakan upload ulang.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${hld.permitClusterId}/hld`,
      entityId: hld.permitClusterId,
    }); // FIX: notify design team
    return updated;
  }

  async adminApprove(hldId: string, userId: string) {
    // REFACTOR: Fetch Admin data for snapshot storage
    const adminUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true, signatureUrl: true },
    });

    if (!adminUser) {
      this.logger.error(`[HLD ADMIN_APPROVE] Approver user not found: ${userId}`);
      throw new NotFoundException('Approver data not found');
    }

    // REFACTOR: Validate Admin role
    if (adminUser.role !== 'ADMIN') {
      this.logger.error(`[HLD ADMIN_APPROVE] User ${userId} with role ${adminUser.role} is not authorized to Admin approve`);
      throw new BadRequestException('Only Admin can perform Admin approval');
    }

    // Log signature validation
    if (!adminUser.signatureUrl) {
      this.logger.warn(`[HLD ADMIN_APPROVE] Admin ${userId} has no signature stored`);
    }

    const u = await this.prisma.hld.update({
      where: { id: hldId },
      data: {
        status: 'PENDING_ISP',
        adminApprovedBy: userId,
        adminApprovedAt: new Date(),
        slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        // SNAPSHOT: Store Admin data at approval time for document consistency
        adminApproverName: adminUser.name,
        adminApproverRole: adminUser.role,
        adminApproverSignatureUrl: adminUser.signatureUrl,
      },
      include: { permitCluster: { select: { id: true, clusterCode: true } } },
    });

    this.logger.log(`[HLD ADMIN_APPROVE] ${hldId}: Admin ${adminUser.name} approved`);

    await this.notifications.createForAllUsers({
      title: 'HLD dikirim ke ISP',
      message: `Menunggu approval ISP (1 minggu) — ${u.permitCluster?.clusterCode ?? ''}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });
    return u;
  }

  async adminReject(hldId: string, notes: string | undefined, _userId: string) {
    void _userId;
    const hld = await this.prisma.hld.findUnique({
      where: { id: hldId },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    if (!hld) throw new NotFoundException('HLD tidak ada');
    const updated = await this.prisma.hld.update({
      where: { id: hldId },
      data: {
        status: 'DRAFT', // FIX: back to designer-editable
        adminNotes: notes ?? null,
        adminRejectedAt: new Date(),
      },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    await this.notifications.createForRole(Role.DESIGNER, {
      title: '↺ HLD Perlu Revisi (Admin)',
      message: `Admin menolak HLD cluster ${hld.permitCluster?.clusterCode ?? ''}. Catatan: ${notes ?? '—'}. Silakan upload ulang.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${hld.permitClusterId}/hld`,
      entityId: hld.permitClusterId,
    }); // FIX: notify designers
    return updated;
  }

  async recordIspDecision(
    hldId: string,
    action: 'APPROVE' | 'REVISE',
    feedback: string | undefined,
    userId: string,
  ) {
    const h = await this.prisma.hld.findUnique({
      where: { id: hldId },
      include: { permitCluster: { select: { assignedPmId: true } } },
    });
    if (!h) throw new NotFoundException('HLD tidak ada');

    if (action === 'APPROVE') {
      const u = await this.prisma.hld.update({
        where: { id: hldId },
        data: { status: 'ISP_APPROVED', ispApprovedAt: new Date(), ispFeedback: feedback },
      });
      await this.permitCluster.advancePhaseInternal(h.permitClusterId, 'LLD_SUBMISSION');
      this.gateway.emitToRoom(`user:${h.permitCluster.assignedPmId}`, 'hld:ispApproved', { hldId });
      if (h.permitCluster.assignedPmId) {
        await this.notifications.createForUser(h.permitCluster.assignedPmId, {
          title: 'HLD disetujui ISP',
          message: 'Upload LLD sekarang',
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${h.permitClusterId}`,
          entityId: h.permitClusterId,
        });
      }
      await this.notifications.createForRoles([Role.PM_SENIOR, Role.ADMIN, Role.OPERATIONAL_MANAGER], {
        title: 'HLD disetujui ISP',
        message: `Cluster ${h.permitClusterId}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${h.permitClusterId}`,
        entityId: h.permitClusterId,
      }); // FIX: cross-team visibility
      void userId;
      return u;
    }

    const v = h.version + 1;
    await this.prisma.hldRevision.create({
      data: {
        hldId,
        version: v,
        notes: feedback,
        createdBy: userId,
      },
    });
    const u = await this.prisma.hld.update({
      where: { id: hldId },
      data: { status: 'ISP_REVISION', ispFeedback: feedback, rejectionReason: feedback, version: v }, // MODIFIED: enum value per spec
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    this.gateway.emitToRoom(`user:${h.permitCluster!.assignedPmId}`, 'hld:revisionRequired', { hldId });
    await this.notifications.createForRole(Role.DESIGNER, {
      title: '🔄 HLD Perlu Revisi (ISP)',
      message: `ISP meminta revisi HLD cluster ${u.permitCluster?.clusterCode ?? h.permitClusterId}. Feedback: ${feedback ?? '—'}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${h.permitClusterId}/hld`,
      entityId: h.permitClusterId,
    }); // FIX: explicit designer inbox
    return u;
  }
}
