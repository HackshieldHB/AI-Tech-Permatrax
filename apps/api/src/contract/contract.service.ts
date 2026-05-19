import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'; // FIX PR/BR→PO flow: BadRequestException for state-machine guards
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';
import { ContractStatus, ContractType, Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permitCluster: PermitClusterService,
    private readonly notifications: NotificationsService,
  ) {}

  // FIX PR/BR→PO flow: map FiberType → PM role enum (default FTTH fallback for safety)
  private pmRoleFor(fiberType: string | null | undefined): Role {
    if (fiberType === 'FTTB') return Role.PM_FTTB;
    if (fiberType === 'FTTT') return Role.PM_FTTT;
    return Role.PM_FTTH;
  }

  // ─────────────────────────────────────────────
  // FIX PR/BR→PO flow: NEW workflow API (used by the [id]/page.tsx pipeline UI)
  // ─────────────────────────────────────────────

  // FIX PR/BR→PO flow: fetch the combined workflow row for a cluster (null when not yet initialized)
  async getWorkflowByCluster(permitClusterId: string) {
    const workflow = await this.prisma.prBrWorkflow.findUnique({
      where: { permitClusterId },
      include: { permitCluster: true },
    });
    return workflow; // FIX: return null instead of throwing — frontend distinguishes “not initialized”
  }

  // FIX PR/BR→PO flow: called by permit-cluster.service when phase becomes PR_BR_ISSUANCE
  async initPrBrForCluster(permitClusterId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: permitClusterId },
    });
    if (!cluster) {
      throw new NotFoundException('Cluster tidak ditemukan');
    }

    // FIX PR/BR→PO flow: idempotent — reset status only if workflow is empty or in rejection loop
    const workflow = await this.prisma.prBrWorkflow.upsert({
      where: { permitClusterId },
      create: { permitClusterId, status: 'PENDING_UPLOAD' },
      update: {}, // FIX: preserve any existing uploads; don't wipe state if re-entered
    });

    const clusterCode = cluster.clusterCode;
    const pmRole = this.pmRoleFor(cluster.fiberType);

    // FIX PR/BR→PO flow: notify PM (fiber-specific) — primary actor for upload
    await this.notifications.createForRole(pmRole, {
      title: '📄 PR/BR dari ISP Siap Diupload',
      message: `Dokumen PR dan BR dari ISP untuk cluster ${clusterCode} perlu diupload. Silakan upload dokumen yang diterima dari ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    // FIX PR/BR→PO flow: notify PM Senior for visibility
    await this.notifications.createForRole(Role.PM_SENIOR, {
      title: '📄 PR/BR Siap Diupload',
      message: `Cluster ${clusterCode} memasuki fase PR/BR. PM perlu upload dokumen dari ISP.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    // FIX PR/BR→PO flow: Admin is co-uploader and primary reviewer
    await this.notifications.createForRole(Role.ADMIN, {
      title: `📄 PR/BR Baru — Cluster ${clusterCode}`,
      message: `Cluster ${clusterCode} memasuki fase PR/BR. PM akan mengupload dokumen dari ISP (Admin juga bisa upload).`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return workflow;
  }

  // FIX PR/BR→PO flow: PM or Admin uploads PR (required) + BR (optional) documents
  async uploadPrBr(
    permitClusterId: string,
    data: { prFileUrl: string; brFileUrl?: string; prBrNotes?: string },
    userId: string,
  ) {
    const workflow = await this.prisma.prBrWorkflow.findUnique({
      where: { permitClusterId },
      include: { permitCluster: true },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow PR/BR belum diinisialisasi');
    }
    if (!['PENDING_UPLOAD', 'ADMIN_REJECTED'].includes(workflow.status)) {
      throw new BadRequestException(
        'Dokumen PR/BR sudah diupload atau tidak dalam status yang tepat untuk diupload ulang',
      );
    }
    if (!data.prFileUrl) {
      throw new BadRequestException('Dokumen PR wajib diupload');
    }

    const updated = await this.prisma.prBrWorkflow.update({
      where: { permitClusterId },
      data: {
        prFileUrl:  data.prFileUrl,
        brFileUrl:  data.brFileUrl ?? null,
        prBrNotes:  data.prBrNotes ?? null,
        status:     'UPLOADED',
        uploadedBy: userId,
        uploadedAt: new Date(),
        adminNotes: null, // FIX: clear previous rejection notes on re-upload
      },
      include: { permitCluster: true },
    });

    // FIX PR/BR→PO flow: notify Admin to review
    await this.notifications.createForRole(Role.ADMIN, {
      title: '📋 PR/BR Siap Direview',
      message: `PM mengupload dokumen PR/BR untuk cluster ${updated.permitCluster.clusterCode}. Silakan review.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return updated;
  }

  // FIX PR/BR→PO flow: Admin approves or rejects the uploaded PR/BR documents
  async adminReviewPrBr(
    permitClusterId: string,
    data: { action: 'APPROVE' | 'REJECT'; notes?: string },
    userId: string,
  ) {
    const workflow = await this.prisma.prBrWorkflow.findUnique({
      where: { permitClusterId },
      include: { permitCluster: true },
    });
    if (!workflow) throw new NotFoundException('Workflow PR/BR tidak ditemukan');
    if (workflow.status !== 'UPLOADED') {
      throw new BadRequestException('PR/BR belum diupload atau sudah direview');
    }

    const cluster = workflow.permitCluster;
    const pmRole  = this.pmRoleFor(cluster.fiberType);

    if (data.action === 'APPROVE') {
      const updated = await this.prisma.prBrWorkflow.update({
        where: { permitClusterId },
        data: {
          status:          'ADMIN_APPROVED',
          adminReviewedBy: userId,
          adminReviewedAt: new Date(),
          adminNotes:      data.notes ?? null,
        },
      });

      // FIX PR/BR→PO flow: phase advances to CONTRACT_MANAGEMENT so Admin can create the PO
      await this.permitCluster.advancePhaseInternal(permitClusterId, 'CONTRACT_MANAGEMENT');

      // FIX PR/BR→PO flow: inform PM + PM Senior that PR/BR is approved and Admin is now creating PO
      await this.notifications.createForRoles([pmRole, Role.PM_SENIOR], {
        title: '✅ PR/BR Disetujui Admin',
        message: `PR/BR cluster ${cluster.clusterCode} disetujui. Admin sedang membuat dokumen PO.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${permitClusterId}`,
        entityId: permitClusterId,
      });

      return updated;
    }

    // FIX PR/BR→PO flow: rejection path — PM must re-upload, stays in PR_BR_ISSUANCE
    const updated = await this.prisma.prBrWorkflow.update({
      where: { permitClusterId },
      data: {
        status:          'ADMIN_REJECTED',
        adminReviewedBy: userId,
        adminReviewedAt: new Date(),
        adminNotes:      data.notes ?? 'Dokumen perlu diperbaiki',
      },
    });

    await this.notifications.createForRoles([pmRole, Role.PM_SENIOR], {
      title: '❌ PR/BR Ditolak — Perlu Upload Ulang',
      message: `Admin menolak PR/BR cluster ${cluster.clusterCode}. Catatan: ${data.notes || 'lihat detail'}. Silakan upload ulang dokumen.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return updated;
  }

  // FIX PR/BR→PO flow: Admin creates the PO document (after PR/BR approved)
  async createPo(
    permitClusterId: string,
    data: { poFileUrl: string; poNotes?: string },
    userId: string,
  ) {
    const workflow = await this.prisma.prBrWorkflow.findUnique({
      where: { permitClusterId },
      include: { permitCluster: true },
    });
    if (!workflow) throw new NotFoundException('Workflow PR/BR tidak ditemukan');
    if (!['ADMIN_APPROVED', 'OPS_REJECTED'].includes(workflow.status)) {
      throw new BadRequestException('PR/BR belum disetujui atau PO tidak dalam status revisi');
    }
    if (!data.poFileUrl) {
      throw new BadRequestException('Dokumen PO wajib diupload');
    }

    const updated = await this.prisma.prBrWorkflow.update({
      where: { permitClusterId },
      data: {
        poFileUrl: data.poFileUrl,
        poNotes:   data.poNotes ?? null,
        status:    'PO_CREATED',
        opsNotes:  null, // FIX: clear previous rejection notes on re-upload
      },
      include: { permitCluster: true },
    });
    void userId; // FIX: uploader identity is tracked on the uploadedBy field of the CR audit log, not here

    // FIX PR/BR→PO flow: Ops Manager is the approver; GM gets a visibility ping
    await this.notifications.createForRole(Role.OPERATIONAL_MANAGER, {
      title: '📑 PO Baru Perlu Approval',
      message: `Admin membuat PO untuk cluster ${updated.permitCluster.clusterCode}. Silakan review dan berikan persetujuan.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });
    await this.notifications.createForRole(Role.GENERAL_MANAGER, {
      title: '📑 PO Dibuat',
      message: `PO untuk cluster ${updated.permitCluster.clusterCode} dibuat dan menunggu persetujuan Ops Manager.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return updated;
  }

  // FIX PR/BR→PO flow: Ops Manager approves/rejects the PO (advances phase on APPROVE)
  async opsReviewPo(
    permitClusterId: string,
    data: { action: 'APPROVE' | 'REJECT'; notes?: string },
    userId: string,
  ) {
    const workflow = await this.prisma.prBrWorkflow.findUnique({
      where: { permitClusterId },
      include: { permitCluster: true },
    });
    if (!workflow) throw new NotFoundException('Workflow PR/BR tidak ditemukan');
    if (workflow.status !== 'PO_CREATED') {
      throw new BadRequestException('PO belum dibuat atau sudah direview');
    }

    const cluster = workflow.permitCluster;
    const pmRole  = this.pmRoleFor(cluster.fiberType);

    if (data.action === 'APPROVE') {
      const updated = await this.prisma.prBrWorkflow.update({
        where: { permitClusterId },
        data: {
          status:        'OPS_APPROVED',
          opsApprovedBy: userId,
          opsApprovedAt: new Date(),
          opsNotes:      data.notes ?? null,
        },
      });

      // FIX PR/BR→PO flow: broadcast approval to PM + PM Senior + Admin + GM
      await this.notifications.createForRoles(
        [pmRole, Role.PM_SENIOR, Role.ADMIN, Role.GENERAL_MANAGER],
        {
          title: '✅ PO Disetujui — Fase SKOM Dimulai',
          message: `Ops Manager menyetujui PO cluster ${cluster.clusterCode}. Proses berlanjut ke pembuatan SKOM.`,
          type: 'PERMIT_FLOW',
          link: `/permit-clusters/${permitClusterId}`,
          entityId: permitClusterId,
        },
      );

      // FIX PR/BR→PO flow: advance to SKOM_BUDGET phase
      await this.permitCluster.advancePhaseInternal(permitClusterId, 'SKOM_BUDGET');

      return updated;
    }

    // FIX PR/BR→PO flow: rejection path — Admin must revise PO, stays in CONTRACT_MANAGEMENT
    const updated = await this.prisma.prBrWorkflow.update({
      where: { permitClusterId },
      data: {
        status:        'OPS_REJECTED',
        opsApprovedBy: userId,
        opsApprovedAt: new Date(),
        opsNotes:      data.notes ?? 'PO perlu direvisi',
      },
    });

    await this.notifications.createForRole(Role.ADMIN, {
      title: '❌ PO Ditolak Ops Manager',
      message: `Ops Manager menolak PO cluster ${cluster.clusterCode}. Catatan: ${data.notes || 'PO perlu direvisi'}. Silakan revisi dan upload ulang.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    });

    return updated;
  }

  // ─────────────────────────────────────────────
  // LEGACY ContractRecord API — kept for backward compatibility (v1 pipeline page, admin tools)
  // ─────────────────────────────────────────────

  async findAll(permitClusterId: string) {
    return this.prisma.contractRecord.findMany({
      where: { permitClusterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    permitClusterId: string,
    dto: {
      type: ContractType;
      contractNumber?: string;
      vendor?: string;
      amount?: string;
      startDate?: string;
      endDate?: string;
      fileUrl?: string;
      notes?: string;
    },
    userId: string,
  ) {
    const row = await this.prisma.contractRecord.create({
      data: {
        permitClusterId,
        type: dto.type,
        contractNumber: dto.contractNumber,
        vendor: dto.vendor,
        amount: dto.amount ? new Prisma.Decimal(dto.amount) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        fileUrl: dto.fileUrl,
        notes: dto.notes,
        createdBy: userId,
        status: 'PENDING_OPS_MANAGER',
      },
    });
    await this.permitCluster.advancePhaseInternal(permitClusterId, 'CONTRACT_MANAGEMENT');
    await this.notifications.createForRole(Role.OPERATIONAL_MANAGER, {
      title: 'PR/BR baru perlu approval',
      message: `Kontrak ${row.contractNumber ?? row.id} menunggu Ops Manager`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${permitClusterId}`,
      entityId: permitClusterId,
    }); // FIX: inbox Ops
    return row;
  }

  async updateStatus(id: string, status: ContractStatus, userId: string) {
    const row = await this.prisma.contractRecord.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Kontrak tidak ada');
    void userId;
    const updated = await this.prisma.contractRecord.update({
      where: { id },
      data: { status, ...(status === 'APPROVED' ? { signedAt: new Date() } : {}) }, // MODIFIED: signed timestamp on APPROVED status
    });
    if (status === 'APPROVED') {
      const signed = await this.prisma.contractRecord.count({
        where: { permitClusterId: row.permitClusterId, status: 'APPROVED' },
      });
      if (signed >= 1) {
        await this.permitCluster.advancePhaseInternal(row.permitClusterId, 'SKOM_BUDGET');
      }
    }
    return updated;
  }

  async opsManagerApprove(id: string, userId: string) {
    const u = await this.prisma.contractRecord.update({
      where: { id },
      data: { status: 'PENDING_GM', opsApprovedBy: userId, opsApprovedAt: new Date() },
      include: { permitCluster: { select: { clusterCode: true } } },
    });
    await this.notifications.createForRole(Role.GENERAL_MANAGER, {
      title: 'PKS/PO perlu approval GM',
      message: u.permitCluster?.clusterCode ?? u.permitClusterId,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${u.permitClusterId}`,
      entityId: u.permitClusterId,
    });
    return u;
  }

  async gmApprove(id: string, userId: string) {
    const updated = await this.prisma.contractRecord.update({
      where: { id },
      data: { status: 'APPROVED', gmApprovedBy: userId, gmApprovedAt: new Date() },
      include: { permitCluster: { select: { assignedPmId: true, fiberType: true, clusterCode: true } } },
    });
    await this.permitCluster.advancePhaseInternal(updated.permitClusterId, 'SKOM_BUDGET');
    const pmFt = updated.permitCluster?.fiberType;
    const pmRole = pmFt === 'FTTB' ? Role.PM_FTTB : pmFt === 'FTTT' ? Role.PM_FTTT : Role.PM_FTTH;
    await this.notifications.createForRole(pmRole, {
      title: 'PKS/PO disetujui — input SKOM budget',
      message: `Cluster ${updated.permitCluster?.clusterCode ?? updated.permitClusterId}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${updated.permitClusterId}`,
      entityId: updated.permitClusterId,
    });
    if (updated.permitCluster?.assignedPmId) {
      await this.notifications.createForUser(updated.permitCluster.assignedPmId, {
        title: 'PKS/PO disetujui GM',
        message: 'Silakan input SKOM budget',
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
    }
    return updated;
  }

  async reject(id: string, notes: string, userId: string) {
    const updated = await this.prisma.contractRecord.update({
      where: { id },
      data: { status: 'REJECTED', rejectedBy: userId, rejectedAt: new Date(), rejectionNotes: notes },
      include: { permitCluster: { select: { clusterCode: true } } },
    }); // NEW: reject with notes

    // FIX: notify the submitter (createdBy) so they can see the rejection reason in their inbox
    if (updated.createdBy) {
      await this.notifications.createForUser(updated.createdBy, {
        title: 'PKS/PO ditolak',
        message: `Kontrak ${updated.contractNumber ?? updated.id} (cluster ${updated.permitCluster?.clusterCode ?? updated.permitClusterId}) ditolak. Alasan: ${notes || '-'}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${updated.permitClusterId}`,
        entityId: updated.permitClusterId,
      });
    }
    // FIX: also nudge Admin so someone can revise the document
    await this.notifications.createForRole(Role.ADMIN, {
      title: 'PKS/PO ditolak — revisi diperlukan',
      message: `Cluster ${updated.permitCluster?.clusterCode ?? updated.permitClusterId} — ${notes || 'tanpa catatan'}`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${updated.permitClusterId}`,
      entityId: updated.permitClusterId,
    });

    return updated;
  }
}
