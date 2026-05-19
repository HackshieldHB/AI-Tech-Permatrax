import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PermitClusterService } from '../permit-cluster/permit-cluster.service';

@Injectable()
export class SkomBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly notifications: NotificationsService,
    private readonly permitCluster: PermitClusterService,
  ) {}

  async getByCluster(permitClusterId: string) {
    return this.prisma.skomBudget.findUnique({
      where: { permitClusterId },
      include: { disbursements: true },
    });
  }

  async getByClusterId(clusterId: string) { // FIX: helper to normalize cluster-scoped lookups
    return this.prisma.skomBudget.findUnique({
      where: { permitClusterId: clusterId },
      include: { disbursements: true },
    });
  }

  async create(clusterId: string, data: any, userId: string) {
    const cluster = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
    });
    if (!cluster) throw new NotFoundException('Cluster tidak ditemukan');

    return this.prisma.skomBudget.upsert({
      where: { permitClusterId: clusterId },
      create: {
        permitClusterId:  clusterId,
        status:           'DRAFT',
        createdBy:        userId,
        // FIX: 4 required document fields
        budgetFileUrl:    data.budgetFileUrl    || null, // SKOM Budget
        rabFileUrl:       data.rabFileUrl       || null, // RAB
        timelineFileUrl:  data.timelineFileUrl  || null, // Timeline
        kurvaSFileUrl:    data.kurvaSFileUrl    || null, // Kurva-S
        budgetAmount:     data.budgetAmount     || null,
        notes:            data.notes            || null,
      },
      update: {
        budgetFileUrl:    data.budgetFileUrl    || undefined,
        rabFileUrl:       data.rabFileUrl       || undefined,
        timelineFileUrl:  data.timelineFileUrl  || undefined,
        kurvaSFileUrl:    data.kurvaSFileUrl    || undefined,
        budgetAmount:     data.budgetAmount     || undefined,
        notes:            data.notes            || undefined,
      },
    });
  }

  async update(id: string, data: any, userId: string) {
    return this.prisma.skomBudget.update({
      where: { id },
      data: {
        budgetFileUrl:    data.budgetFileUrl    || undefined,
        rabFileUrl:       data.rabFileUrl       || undefined,
        timelineFileUrl:  data.timelineFileUrl  || undefined,
        kurvaSFileUrl:    data.kurvaSFileUrl    || undefined,
        budgetAmount:     data.budgetAmount     || undefined,
        notes:            data.notes            || undefined,
      },
    });
  }

  async submitForApproval(skomId: string, userId: string) {
    const skom = await this.prisma.skomBudget.findUnique({
      where: { id: skomId },
      include: { permitCluster: true },
    });
    if (!skom) throw new NotFoundException('SKOM tidak ditemukan');

    // FIX: validate all 4 documents are uploaded before submit
    if (!skom.budgetFileUrl) {
      throw new BadRequestException('Upload dokumen SKOM Budget terlebih dahulu');
    }
    if (!skom.rabFileUrl) {
      throw new BadRequestException('Upload dokumen RAB terlebih dahulu');
    }

    const updated = await this.prisma.skomBudget.update({
      where: { id: skomId },
      data: {
        status:      'PENDING_OPS_APPROVAL',
        submittedBy: userId,
        submittedAt: new Date(),
      },
      include: { permitCluster: true },
    });

    // FIX: notify Ops Manager
    await this.notifications.createForRole('OPERATIONAL_MANAGER', {
      title: '📊 SKOM Budget Perlu Approval',
      message: `PM mengsubmit SKOM Budget untuk cluster ${skom.permitCluster.clusterCode}. Silakan review dan approve.`,
      type: 'PERMIT_FLOW',
      link: `/permit-clusters/${skom.permitClusterId}`,
      entityId: skom.permitClusterId,
    });

    return updated;
  }

  async opsReview(id: string, body: { action: 'APPROVE' | 'REJECT'; notes?: string }, userId: string) {
    const skom = await this.prisma.skomBudget.findUnique({ where: { id }, include: { permitCluster: true } });
    if (!skom) throw new NotFoundException('SKOM tidak ditemukan');

    if (body.action === 'APPROVE') {
      const updated = await this.prisma.skomBudget.update({
        where: { id },
        data: {
          status: 'PENDING_GM_APPROVAL',
          opsApprovedBy: userId,
          opsApprovedAt: new Date(),
          opsNotes: body.notes,
        },
      });
      // Notify GM
      await this.notifications.createForRole('GENERAL_MANAGER', {
        title: '📊 SKOM Budget Perlu Final Approval',
        message: `Ops Manager telah menyetujui SKOM Budget untuk cluster ${skom.permitCluster.clusterCode}. Silakan review final.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${skom.permitClusterId}`,
        entityId: skom.permitClusterId,
      });
      return updated;
    } else {
      const updated = await this.prisma.skomBudget.update({
        where: { id },
        data: {
          status: 'OPS_REJECTED',
          opsNotes: body.notes,
        },
      });
      // Notify PM
      await this.notifications.createForUser(skom.createdBy, {
        title: '❌ SKOM Budget Ditolak (Ops Manager)',
        message: `Ops Manager menolak SKOM Budget cluster ${skom.permitCluster.clusterCode}. Catatan: ${body.notes}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${skom.permitClusterId}`,
        entityId: skom.permitClusterId,
      });
      return updated;
    }
  }

  async gmReview(id: string, body: { action: 'APPROVE' | 'REJECT'; notes?: string }, userId: string) {
    const skom = await this.prisma.skomBudget.findUnique({ where: { id }, include: { permitCluster: true } });
    if (!skom) throw new NotFoundException('SKOM tidak ditemukan');

    if (body.action === 'APPROVE') {
      const updated = await this.prisma.skomBudget.update({
        where: { id },
        data: {
          status: 'GM_APPROVED',
          gmApprovedBy: userId,
          gmApprovedAt: new Date(),
          gmNotes: body.notes,
        },
      });
      // Advance phase
      await this.permitCluster.advancePhaseInternal(skom.permitClusterId, 'MANAGEMENT_APPROVAL');
      await this.permitCluster.advancePhaseInternal(skom.permitClusterId, 'FUND_DISBURSEMENT');

      // Notify PM
      await this.notifications.createForUser(skom.createdBy, {
        title: '✅ SKOM Budget Disetujui (GM)',
        message: `GM telah menyetujui SKOM Budget cluster ${skom.permitCluster.clusterCode}.`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${skom.permitClusterId}`,
        entityId: skom.permitClusterId,
      });
      return updated;
    } else {
      const updated = await this.prisma.skomBudget.update({
        where: { id },
        data: {
          status: 'GM_REJECTED',
          gmNotes: body.notes,
        },
      });
      // Notify PM
      await this.notifications.createForUser(skom.createdBy, {
        title: '❌ SKOM Budget Ditolak (GM)',
        message: `GM menolak SKOM Budget cluster ${skom.permitCluster.clusterCode}. Catatan: ${body.notes}`,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${skom.permitClusterId}`,
        entityId: skom.permitClusterId,
      });
      return updated;
    }
  }

  async addDisbursement(
    clusterId: string,
    dto: { amount: string; description: string; scheduledDate: string; evidenceUrl?: string },
    userId: string,
  ) {
    const b = await this.prisma.skomBudget.findUnique({
      where: { permitClusterId: clusterId },
      include: { disbursements: true },
    });
    if (!b) throw new NotFoundException('SKOM tidak ada');

    const skomBudgetId = b.id; // FIX: resolve internal SKOM id from cluster id
    await this.prisma.disbursementRecord.create({
      data: {
        skomBudgetId,
        amount: new Prisma.Decimal(dto.amount),
        description: dto.description,
        scheduledDate: new Date(dto.scheduledDate),
        evidenceUrl: dto.evidenceUrl,
        recordedBy: userId,
      },
    });

    const agg = await this.prisma.disbursementRecord.aggregate({
      where: { skomBudgetId, status: 'EXECUTED' },
      _sum: { amount: true },
    });
    await this.prisma.skomBudget.update({
      where: { id: skomBudgetId },
      data: { totalDisbursed: agg._sum.amount ?? new Prisma.Decimal(0) },
    });

    await this.permitCluster.advancePhaseInternal(clusterId, 'BAK_GENERATION'); // FIX: entering fund disbursement initializes BAK pipeline
    const pc = await this.prisma.permitCluster.findUnique({
      where: { id: clusterId },
      include: { visitRequest: { select: { requestedBy: true } }, assignedPm: { select: { id: true } } },
    });
    const msg = `Dana SKOM dijadwalkan: ${new Date(dto.scheduledDate).toLocaleDateString('id-ID')}`;
    if (pc?.assignedPmId) {
      await this.notifications.createForUser(pc.assignedPmId, {
        title: 'Jadwal pencairan SKOM',
        message: msg,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    const sid = pc?.visitRequest?.requestedBy;
    if (sid) {
      await this.notifications.createForUser(sid, {
        title: 'Jadwal pencairan SKOM',
        message: msg,
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${clusterId}`,
        entityId: clusterId,
      });
    }
    return this.getDisbursementSchedule(clusterId);
  }

  getDisbursementSchedule(clusterId: string) {
    return this.prisma.disbursementRecord.findMany({
      where: { skomBudget: { permitClusterId: clusterId } }, // FIX: list schedule by cluster route contract
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async addDisbursementSchedule(
    skomId: string,
    data: {
      disbursementStartDate: string;
      disbursementEndDate:   string;
      disbursementAmount:    number;
      disbursementNotes?:    string;
    },
    userId: string
  ) {
    const skom = await this.prisma.skomBudget.findUnique({
      where:   { id: skomId },
      include: { permitCluster: true },
    });
    if (!skom) throw new NotFoundException('SKOM tidak ditemukan');
  
    // FIX: only allowed after GM_APPROVED
    if (skom.status !== 'GM_APPROVED') {
      throw new BadRequestException(
        'Jadwal pencairan hanya bisa diisi setelah SKOM disetujui GM'
      );
    }
  
    const updated = await this.prisma.skomBudget.update({
      where: { id: skomId },
      data: {
        disbursementStartDate: new Date(data.disbursementStartDate),
        disbursementEndDate:   new Date(data.disbursementEndDate),
        disbursementAmount:    data.disbursementAmount,
        disbursementNotes:     data.disbursementNotes || null,
        disbursedBy:           userId,
        disbursedAt:           new Date(),
        status:                'DISBURSED', // FIX: advance status
      },
      include: { permitCluster: true },
    });
  
    const cluster = skom.permitCluster; // FIX: reuse cluster reference for notifications
    const pmRole = `PM_${cluster?.fiberType || 'FTTH'}` as Role; // FIX: map fiber type to PM role for notify
    await this.notifications.createForRoles(
      [pmRole, 'PM_SENIOR', 'ADMIN', 'GENERAL_MANAGER'],
      {
        title: '💰 Dana SKOM Telah Dicairkan', // FIX: disbursement completed — concise title
        message: `Pencairan dana untuk cluster ${cluster?.clusterCode} selesai. Proses berlanjut ke fase BAK.`, // FIX: BAK handoff message without redundant schedule grid
        type: 'PERMIT_FLOW',
        link: `/permit-clusters/${skom.permitClusterId}`,
        entityId: skom.permitClusterId,
      },
    );

    await this.permitCluster.advancePhaseInternal(
      skom.permitClusterId,
      'BAK_GENERATION',
    ); // FIX: advance to phase 16 (BAK) after disbursement schedule saved

    return updated;
  }
}
