import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashOperationRequest,
  CashOpStatus,
  CashOpRealisasiItem,
  CashOpRealisasiStep,
  Prisma,
  RealisasiStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService, CashOpPartialRefundType } from '../budget-ledger/budget-ledger.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { NotificationsService } from '../notifications/notifications.service';
import { computeRealisasiOpenAtUtc } from './utils/wib-realisasi-window.util';
import type { RealisasiDraftDtoType } from './cash-op-realisasi.dto';

export type RealisasiBundleStep = CashOpRealisasiStep & {
  approver: { id: string; name: string } | null;
};

export type RealisasiBundle = {
  cashOp: CashOperationRequest;
  items: CashOpRealisasiItem[];
  steps: RealisasiBundleStep[];
  windowOpenAt: Date | null;
  isWindowOpen: boolean;
};

const VIEW_ROLES = new Set<Role>([Role.FINANCE, Role.GENERAL_MANAGER, Role.ADMIN, Role.OPERATIONAL_MANAGER, Role.MARKETING_HEAD]);
const OPS_PENDING_STATUSES: CashOpStatus[] = ['REALISASI_PENDING_OPS', 'REALISASI_IN_PROGRESS'];
const REJECTED_REALISASI_STATUSES: CashOpStatus[] = [
  'REALISASI_REJECTED_BY_PM',
  'REALISASI_REJECTED_BY_OPS',
  'REALISASI_REJECTED_BY_GM',
  'REALISASI_REJECTED_BY_FINANCE',
  'REALISASI_REJECTED_BY_MARKETING_HEAD' as CashOpStatus,
];

export type RealisasiActionResponse = {
  success: true;
  data: {
    id: string;
    status: string;
    realisasiStatus: string | null;
    updatedAt: Date;
  };
};

function toRealisasiActionResponse(
  cashOp: Pick<CashOperationRequest, 'id' | 'status' | 'realisasiStatus' | 'updatedAt'>,
): RealisasiActionResponse {
  return {
    success: true,
    data: {
      id: cashOp.id,
      status: cashOp.status,
      realisasiStatus: cashOp.realisasiStatus,
      updatedAt: cashOp.updatedAt,
    },
  };
}

function realisasiStateError(
  action: string,
  currentStatus: string,
  expected: readonly string[],
): BadRequestException {
  return new BadRequestException({
    message: 'Invalid state transition',
    action,
    currentStatus,
    expected: [...expected],
  });
}

@Injectable()
export class CashOpRealisasiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetLedger: BudgetLedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  private buildRealisasiApprovalChain(requesterRole: string): string[] {
    if (requesterRole === Role.MARKETING || requesterRole === Role.MARKETING_HEAD) {
      // Marketing flow: Marketing Head → Finance → GM
      return [Role.MARKETING_HEAD, Role.FINANCE, Role.GENERAL_MANAGER];
    }
    // Non-marketing flow (Admin/Surveyor/Designer/PM/Ops): Ops Manager → Finance → GM
    return [Role.OPERATIONAL_MANAGER, Role.FINANCE, Role.GENERAL_MANAGER];
  }

  private async assertActorRole(actorId: string, role: Role): Promise<void> {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor?.role !== role) {
      throw new ForbiddenException('Anda tidak memiliki akses untuk aksi ini');
    }
  }

  async approveByPm(cashOpId: string, actorId: string, notes?: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.PM_SENIOR);
    const updated = await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
      if (cashOp.status !== 'REALISASI_PENDING_PM') {
        throw realisasiStateError('approveByPm', cashOp.status, ['REALISASI_PENDING_PM']);
      }
      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          status: 'REALISASI_PENDING_OPS',
          realisasiStatus: 'PENDING_OPS_REVIEW',
          realisasiCurrentStepRole: Role.OPERATIONAL_MANAGER,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
        },
      });
    });
    this.notifications.createForRole(Role.OPERATIONAL_MANAGER, {
      title: 'Realisasi Cash Advance Menunggu Approval',
      message: `Realisasi CA ${updated.requestNumber} telah disetujui PM Senior dan menunggu review Ops Manager.${notes ? ` Catatan: ${notes}` : ''}`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    }).catch(() => {});
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi disetujui PM Senior',
      message: `Realisasi ${updated.requestNumber} telah disetujui PM Senior dan menunggu review Ops Manager.`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    }).catch(() => {});
    return toRealisasiActionResponse(updated);
  }

  async rejectByPm(cashOpId: string, actorId: string, reason: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.PM_SENIOR);
    if (!reason?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
    const updated = await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
      if (cashOp.status !== 'REALISASI_PENDING_PM') {
        throw realisasiStateError('rejectByPm', cashOp.status, ['REALISASI_PENDING_PM']);
      }
      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          status: 'REALISASI_REJECTED_BY_PM',
          realisasiStatus: 'REJECTED',
          realisasiRejectedAt: new Date(),
          realisasiRejectedById: actorId,
          realisasiRejectedReason: reason.trim(),
          realisasiRejectionReason: reason.trim(),
          realisasiCurrentStepRole: null,
        },
      });
    });
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Ditolak PM Senior',
      message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    }).catch(() => {});
    this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiRejected', {
      cashOpId: updated.id,
      requestNumber: updated.requestNumber,
      reason: reason.trim(),
    });
    return toRealisasiActionResponse(updated);
  }

  async approveByOps(realisasiId: string, actorId: string, notes?: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.OPERATIONAL_MANAGER);
    const updated = await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
      if (!OPS_PENDING_STATUSES.includes(cashOp.status)) {
        throw realisasiStateError('approveByOps', cashOp.status, OPS_PENDING_STATUSES);
      }
      const opsStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: realisasiId, approverRole: Role.OPERATIONAL_MANAGER, status: 'PENDING' },
      });
      if (opsStep) {
        await tx.cashOpRealisasiStep.update({
          where: { id: opsStep.id },
          data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: notes ?? null },
        });
      }
      return tx.cashOperationRequest.update({
        where: { id: realisasiId },
        data: {
          status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
          realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
          realisasiCurrentStepRole: Role.FINANCE,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
        },
      });
    });
    this.notifications.createForRole(Role.FINANCE, {
      title: 'Realisasi Cash Advance Siap Diperiksa',
      message: `Realisasi CA ${updated.requestNumber} telah disetujui Ops Manager dan menunggu review Finance.${notes ? ` Catatan: ${notes}` : ''}`,
      type: 'CASH_OP',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi disetujui Ops Manager',
      message: `Realisasi ${updated.requestNumber} telah disetujui Ops Manager dan menunggu review Finance.`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
    return toRealisasiActionResponse(updated);
  }

  async rejectByOps(realisasiId: string, actorId: string, reason: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.OPERATIONAL_MANAGER);
    if (!reason?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
    const updated = await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
      if (!OPS_PENDING_STATUSES.includes(cashOp.status)) {
        throw realisasiStateError('rejectByOps', cashOp.status, OPS_PENDING_STATUSES);
      }
      return tx.cashOperationRequest.update({
        where: { id: realisasiId },
        data: {
          status: 'REALISASI_REJECTED_BY_OPS',
          realisasiStatus: 'REJECTED',
          realisasiRejectedAt: new Date(),
          realisasiRejectedById: actorId,
          realisasiRejectedReason: reason.trim(),
          realisasiRejectionReason: reason.trim(),
          realisasiCurrentStepRole: null,
        },
      });
    });
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Ditolak Ops Manager',
      message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
    this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiRejected', {
      cashOpId: updated.id,
      requestNumber: updated.requestNumber,
      reason: reason.trim(),
    });
    return toRealisasiActionResponse(updated);
  }

  async approveByGm(
    cashOpId: string,
    actorId: string,
    dto: { gmSignatureUrl?: string; notes?: string },
  ): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.GENERAL_MANAGER);

    let nextStep: { approverRole: string } | null = null;
    let updated!: CashOperationRequest;

    await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
      if (cashOp.status !== ('REALISASI_PENDING_GM' as CashOpStatus)) {
        throw realisasiStateError('approveByGm', cashOp.status, ['REALISASI_PENDING_GM']);
      }
      const gmStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: cashOpId, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
      });
      if (gmStep) {
        await tx.cashOpRealisasiStep.update({
          where: { id: gmStep.id },
          data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: dto.notes ?? null },
        });
      }

      nextStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: cashOpId, status: 'PENDING' },
        orderBy: { stepOrder: 'asc' },
      });

      updated = await tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          ...(dto.gmSignatureUrl?.trim() ? { gmSignatureUrl: dto.gmSignatureUrl.trim() } : {}),
          gmApprovedAt: new Date(),
          gmApprovedById: actorId,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
          ...(nextStep
            ? {
                status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
                realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
                realisasiCurrentStepRole: nextStep.approverRole as Role,
              }
            : {
                status: 'REALISASI_DONE' as CashOpStatus,
                realisasiStatus: 'DONE' as RealisasiStatus,
                realisasiCurrentStepRole: null,
                realisasiCompletedAt: new Date(),
              }),
        },
      });
    });

    if (nextStep) {
      this.notifications.createForRole(nextStep.approverRole as Role, {
        title: 'Realisasi Cash Advance Siap Diperiksa',
        message: `Realisasi CA ${updated.requestNumber} telah disetujui GM dan menunggu review Anda.${dto.notes ? ` Catatan: ${dto.notes}` : ''}`,
        type: 'CASH_OP',
        link: `/cash-operation/${cashOpId}`,
        entityId: cashOpId,
      }).catch(() => {});
      this.notifications.createForUser(updated.requestedBy, {
        title: 'Realisasi disetujui General Manager',
        message: `Realisasi ${updated.requestNumber} telah disetujui GM dan menunggu tahap berikutnya.`,
        type: 'CASH_OP_REALISASI_PENDING',
        link: `/cash-operation/${cashOpId}`,
        entityId: cashOpId,
      }).catch(() => {});
    } else {
      this.notifications.createForUser(updated.requestedBy, {
        title: 'Realisasi Selesai Disetujui',
        message: `Realisasi ${updated.requestNumber} telah disetujui semua pihak.`,
        type: 'CASH_OP_REALISASI_COMPLETED',
        link: `/cash-operation/${cashOpId}`,
        entityId: cashOpId,
      }).catch(() => {});
      this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiCompleted', {
        cashOpId: updated.id,
        requestNumber: updated.requestNumber,
      });
    }
    return toRealisasiActionResponse(updated);
  }

  async rejectByGm(cashOpId: string, actorId: string, reason: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.GENERAL_MANAGER);
    if (!reason?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
    return this.reject(cashOpId, actorId, Role.GENERAL_MANAGER, reason.trim());
  }

  async editAndApproveByFinance(
    realisasiId: string,
    actorId: string,
    dto: {
      nomorRekeningFinance: string;
      financeSignatureUrl?: string;
      items?: Array<{ itemId: string; finalAmount: number }>;
      notes?: string;
    },
  ): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.FINANCE);
    if (!dto.nomorRekeningFinance?.trim()) {
      throw new BadRequestException('Nomor rekening wajib diisi sebelum melakukan approval.');
    }
    let nextStep: { approverRole: string } | null = null;
    let updated!: CashOperationRequest;
    await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
      if (cashOp.status !== 'REALISASI_PENDING_FINANCE') {
        throw realisasiStateError('editAndApproveByFinance', cashOp.status, ['REALISASI_PENDING_FINANCE']);
      }
      for (const item of dto.items ?? []) {
        await tx.cashOpRealisasiItem.update({
          where: { id: item.itemId },
          data: { finalAmount: new Prisma.Decimal(item.finalAmount) },
        });
      }

      // Mark Finance step as approved
      const financeStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: realisasiId, approverRole: Role.FINANCE, status: 'PENDING' },
      });
      if (financeStep) {
        await tx.cashOpRealisasiStep.update({
          where: { id: financeStep.id },
          data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: dto.notes ?? null },
        });
      }

      nextStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: realisasiId, status: 'PENDING' },
        orderBy: { stepOrder: 'asc' },
      });

      const finNextStatusMap: Record<string, CashOpStatus> = {
        [Role.GENERAL_MANAGER]: 'REALISASI_PENDING_GM' as CashOpStatus,
        [Role.MARKETING_HEAD]: 'REALISASI_PENDING_MARKETING_HEAD' as CashOpStatus,
        [Role.OPERATIONAL_MANAGER]: 'REALISASI_PENDING_OPS' as CashOpStatus,
      };
      const finNextRealisasiStatusMap: Record<string, RealisasiStatus> = {
        [Role.GENERAL_MANAGER]: 'PENDING_GM_REVIEW' as RealisasiStatus,
        [Role.MARKETING_HEAD]: 'PENDING_MARKETING_HEAD_REVIEW' as RealisasiStatus,
        [Role.OPERATIONAL_MANAGER]: 'PENDING_OPS_REVIEW' as RealisasiStatus,
      };

      updated = await tx.cashOperationRequest.update({
        where: { id: realisasiId },
        data: {
          realisasiNomorRekeningFinance: dto.nomorRekeningFinance.trim(),
          ...(dto.financeSignatureUrl?.trim() ? { financeSignatureUrl: dto.financeSignatureUrl.trim() } : {}),
          financeApprovedAt: new Date(),
          financeApprovedById: actorId,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
          ...(nextStep
            ? {
                status: finNextStatusMap[nextStep.approverRole] ?? ('REALISASI_PENDING_GM' as CashOpStatus),
                realisasiStatus: finNextRealisasiStatusMap[nextStep.approverRole] ?? ('PENDING_GM_REVIEW' as RealisasiStatus),
                realisasiCurrentStepRole: nextStep.approverRole as Role,
              }
            : {
                status: 'REALISASI_DONE' as CashOpStatus,
                realisasiStatus: 'DONE' as RealisasiStatus,
                realisasiCurrentStepRole: null,
                realisasiCompletedAt: new Date(),
              }),
        },
      });
    });
    if (nextStep) {
      this.notifications.createForRole(nextStep.approverRole as Role, {
        title: 'Realisasi Cash Advance Siap Diperiksa',
        message: `Realisasi CA ${updated.requestNumber} telah disetujui Finance dan menunggu review Anda.`,
        type: 'CASH_OP',
        link: `/cash-operation/${realisasiId}`,
        entityId: realisasiId,
      }).catch(() => {});
      this.notifications.createForUser(updated.requestedBy, {
        title: 'Realisasi disetujui Finance',
        message: `Realisasi ${updated.requestNumber} telah disetujui Finance dan menunggu tahap berikutnya.`,
        type: 'CASH_OP_REALISASI_PENDING',
        link: `/cash-operation/${updated.id}`,
        entityId: updated.id,
      }).catch(() => {});
    } else {
      this.notifications.createForUser(updated.requestedBy, {
        title: 'Realisasi Selesai',
        message: 'Realisasi Anda telah selesai disetujui semua pihak.',
        type: 'CASH_OP_REALISASI_COMPLETED',
        link: `/cash-operation/${updated.id}`,
        entityId: updated.id,
      }).catch(() => {});
      this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiCompleted', {
        cashOpId: updated.id,
        requestNumber: updated.requestNumber,
      });
    }
    return toRealisasiActionResponse(updated);
  }

  async rejectByFinance(realisasiId: string, actorId: string, reason: string): Promise<RealisasiActionResponse> {
    await this.assertActorRole(actorId, Role.FINANCE);
    if (!reason?.trim()) throw new BadRequestException('Alasan penolakan wajib diisi');
    const updated = await this.prisma.$transaction(async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
      if (cashOp.status !== 'REALISASI_PENDING_FINANCE') {
        throw realisasiStateError('rejectByFinance', cashOp.status, ['REALISASI_PENDING_FINANCE']);
      }
      return tx.cashOperationRequest.update({
        where: { id: realisasiId },
        data: {
          status: 'REALISASI_REJECTED_BY_FINANCE',
          realisasiStatus: 'REJECTED',
          realisasiRejectedAt: new Date(),
          realisasiRejectedById: actorId,
          realisasiRejectedReason: reason.trim(),
          realisasiRejectionReason: reason.trim(),
          realisasiCurrentStepRole: null,
        },
      });
    });
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Ditolak Finance',
      message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
    this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiRejected', {
      cashOpId: updated.id,
      requestNumber: updated.requestNumber,
      reason: reason.trim(),
    });
    return toRealisasiActionResponse(updated);
  }

  async resubmitRealisasi(realisasiId: string, actorId: string, dto: RealisasiDraftDtoType): Promise<RealisasiActionResponse> {
    const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
    if (!REJECTED_REALISASI_STATUSES.includes(cashOp.status)) {
      throw realisasiStateError('resubmitRealisasi', cashOp.status, REJECTED_REALISASI_STATUSES);
    }
    if (cashOp.requestedBy !== actorId) {
      throw new ForbiddenException('Bukan pembuat request');
    }

    // FIX: rebuild approval chain based on requester's role
    // (marketing → GM→Finance, non-marketing → PM→OPS→GM→Finance)
    const requester = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { role: true } });
    const chain = this.buildRealisasiApprovalChain(requester.role);
    const firstRole = chain[0];

    const chainStatusMap: Record<string, CashOpStatus> = {
      GENERAL_MANAGER: 'REALISASI_PENDING_GM',
      PM_SENIOR: 'REALISASI_PENDING_PM',
      OPERATIONAL_MANAGER: 'REALISASI_PENDING_OPS',
      FINANCE: 'REALISASI_PENDING_FINANCE',
      MARKETING_HEAD: 'REALISASI_PENDING_MARKETING_HEAD' as CashOpStatus,
    };
    const chainRealisasiStatusMap: Record<string, RealisasiStatus> = {
      GENERAL_MANAGER: 'PENDING_GM_REVIEW',
      PM_SENIOR: 'PENDING_PM_REVIEW',
      OPERATIONAL_MANAGER: 'PENDING_OPS_REVIEW',
      FINANCE: 'PENDING_FINANCE_REVIEW',
      MARKETING_HEAD: 'PENDING_MARKETING_HEAD_REVIEW',
    };

    const realisasiTotal = dto.items.reduce(
      (sum, item) => sum.plus(new Prisma.Decimal(item.amount)),
      new Prisma.Decimal(0),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.cashOpRealisasiItem.deleteMany({ where: { cashOpRequestId: realisasiId } });
      await tx.cashOpRealisasiItem.createMany({
        data: dto.items.map((item) => ({
          cashOpRequestId: realisasiId,
          itemNumber: item.itemNumber,
          description: item.description,
          paymentDate: new Date(item.paymentDate),
          amount: new Prisma.Decimal(item.amount),
          photoUrl: item.photoUrl ?? null,
        })),
      });

      // FIX: delete old approval steps and rebuild for correct chain
      await tx.cashOpRealisasiStep.deleteMany({ where: { cashOpRequestId: realisasiId } });
      await tx.cashOpRealisasiStep.createMany({
        data: chain.map((role, idx) => ({
          cashOpRequestId: realisasiId,
          stepOrder: idx + 1,
          approverRole: role,
          status: 'PENDING',
        })),
      });

      return tx.cashOperationRequest.update({
        where: { id: realisasiId },
        data: {
          status: chainStatusMap[firstRole] ?? 'REALISASI_PENDING_FINANCE',
          realisasiStatus: chainRealisasiStatusMap[firstRole] ?? 'PENDING_FINANCE_REVIEW',
          realisasiCurrentStepRole: firstRole as Role,
          realisasiTotal,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
          realisasiRejectionReason: null,
        },
      });
    });

    this.notifications.createForRole(firstRole as Role, {
      title: 'Realisasi Cash Advance Diajukan Ulang',
      message: `Realisasi ${updated.requestNumber} menunggu review Anda.`,
      type: 'CASH_OP',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
    return toRealisasiActionResponse(updated);
  }

  async saveDraft(
    cashOpId: string,
    userId: string,
    dto: RealisasiDraftDtoType,
  ): Promise<CashOperationRequest> {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });

      if (cashOp.requestedBy !== userId) {
        throw new ForbiddenException('Hanya pembuat request yang dapat melaporkan realisasi');
      }
      if (cashOp.type !== 'CASH_ADVANCE') {
        throw new BadRequestException('Realisasi hanya untuk Cash Advance');
      }
      if (cashOp.status !== 'APPROVED' && cashOp.status !== 'REALISASI_IN_PROGRESS') {
        throw new BadRequestException(
          'Cash Advance harus sudah disetujui untuk dapat melaporkan realisasi',
        );
      }
      if (
        cashOp.realisasiStatus &&
        cashOp.realisasiStatus !== 'DRAFT' &&
        cashOp.realisasiStatus !== 'REJECTED'
      ) {
        throw new BadRequestException('Realisasi sudah diajukan dan tidak dapat diedit');
      }

      if (!cashOp.realisasiStatus || cashOp.realisasiStatus === 'DRAFT') {
        if (!cashOp.approvedAt) {
          throw new BadRequestException('Laporan realisasi hanya dapat diisi setelah pengajuan disetujui');
        }
      }

      await tx.cashOpRealisasiItem.deleteMany({ where: { cashOpRequestId: cashOpId } });
      await tx.cashOpRealisasiItem.createMany({
        data: dto.items.map((item) => ({
          cashOpRequestId: cashOpId,
          itemNumber: item.itemNumber,
          description: item.description,
          paymentDate: new Date(item.paymentDate),
          amount: new Prisma.Decimal(item.amount),
          photoUrl: item.photoUrl ?? null,
        })),
      });

      const realisasiTotal = dto.items.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.amount)),
        new Prisma.Decimal(0),
      );

      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          realisasiStatus: 'DRAFT',
          realisasiTotal,
          status: cashOp.status === 'APPROVED' ? 'REALISASI_IN_PROGRESS' : cashOp.status,
        },
      });
    });
  }

  async submit(cashOpId: string, userId: string): Promise<CashOperationRequest> {
    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });

      if (cashOp.requestedBy !== userId) {
        throw new ForbiddenException('Bukan pembuat request');
      }
      if (cashOp.realisasiStatus !== 'DRAFT' && cashOp.realisasiStatus !== 'REJECTED') {
        throw new BadRequestException('Realisasi tidak dalam status DRAFT atau REJECTED');
      }

      const items = await tx.cashOpRealisasiItem.findMany({ where: { cashOpRequestId: cashOpId } });
      if (items.length === 0) {
        throw new BadRequestException('Realisasi harus memiliki minimal satu item');
      }

      const requester = await tx.user.findUniqueOrThrow({ where: { id: cashOp.requestedBy } });
      const chain = this.buildRealisasiApprovalChain(requester.role);

      await tx.cashOpRealisasiStep.deleteMany({ where: { cashOpRequestId: cashOpId } });
      await tx.cashOpRealisasiStep.createMany({
        data: chain.map((role, idx) => ({
          cashOpRequestId: cashOpId,
          stepOrder: idx + 1,
          approverRole: role,
          status: 'PENDING',
        })),
      });

      const firstRole = chain[0];
      const chainStatusMap: Record<string, string> = {
        'GENERAL_MANAGER': 'REALISASI_PENDING_GM',
        'PM_SENIOR': 'REALISASI_PENDING_PM',
        'OPERATIONAL_MANAGER': 'REALISASI_PENDING_OPS',
        'FINANCE': 'REALISASI_PENDING_FINANCE',
        'MARKETING_HEAD': 'REALISASI_PENDING_MARKETING_HEAD',
      };
      const chainRealisasiStatusMap: Record<string, string> = {
        'GENERAL_MANAGER': 'PENDING_GM_REVIEW',
        'PM_SENIOR': 'PENDING_PM_REVIEW',
        'OPERATIONAL_MANAGER': 'PENDING_OPS_REVIEW',
        'FINANCE': 'PENDING_FINANCE_REVIEW',
        'MARKETING_HEAD': 'PENDING_MARKETING_HEAD_REVIEW',
      };

      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          status: (chainStatusMap[firstRole] || 'REALISASI_PENDING_FINANCE') as CashOpStatus,
          realisasiStatus: (chainRealisasiStatusMap[firstRole] || 'PENDING_FINANCE_REVIEW') as RealisasiStatus,
          realisasiCurrentStepRole: firstRole as Role,
          realisasiSubmittedAt: new Date(),
          realisasiRejectionReason: null,
        },
      });
    });

    const requester = await this.prisma.user.findUnique({
      where: { id: updated.requestedBy },
      select: { name: true },
    });
    const requesterName = requester?.name ?? '—';

    const firstRole = updated.realisasiCurrentStepRole as Role;
    this.notifications.createForRole(firstRole, {
      title: 'Realisasi Cash Advance',
      message: `Realisasi ${updated.requestNumber} dari ${requesterName} menunggu review Anda`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});

    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi berhasil diajukan',
      message: `Realisasi ${updated.requestNumber} telah diajukan dan menunggu review.`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});

    this.notifications.emitRealtime(`role:${firstRole}`, 'cashOp:realisasiSubmitted', {
      cashOpId: updated.id,
      requestNumber: updated.requestNumber,
      requesterId: updated.requestedBy,
      requesterName,
    });

    return updated;
  }

  async approve(
    cashOpId: string,
    approverId: string,
    approverRole: Role,
    notes?: string,
    hasilCheckingFinance?: string,
  ): Promise<RealisasiActionResponse> {
    let refundAmount: Prisma.Decimal | null = null;

    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });

      const currentStatus = cashOp.status;
      // FIX: include ALL pending-approval statuses across the full chain (PM → OPS → GM → Finance)
      const approvableStatuses = new Set<CashOpStatus>([
        'REALISASI_IN_PROGRESS',       // backward-compat alias treated as PENDING_OPS
        'REALISASI_PENDING_PM',
        'REALISASI_PENDING_OPS',
        'REALISASI_PENDING_GM',
        'REALISASI_PENDING_FINANCE',
        'REALISASI_PENDING_MARKETING_HEAD' as CashOpStatus,
        'REALISASI_REJECTED_BY_OPS',   // re-approve after OPS rejection
        'REALISASI_REJECTED_BY_FINANCE',
      ]);
      if (!approvableStatuses.has(currentStatus)) {
        throw new BadRequestException({
          message: 'Invalid state transition',
          action: 'approve',
          currentStatus,
          expected: Array.from(approvableStatuses),
        });
      }

      if (!cashOp.realisasiCurrentStepRole || cashOp.realisasiCurrentStepRole !== approverRole) {
        throw new ForbiddenException('Bukan giliran role Anda untuk menyetujui realisasi');
      }

      const currentStep = await tx.cashOpRealisasiStep.findFirstOrThrow({
        where: { cashOpRequestId: cashOpId, approverRole, status: 'PENDING' },
      });

      await tx.cashOpRealisasiStep.update({
        where: { id: currentStep.id },
        data: {
          status: 'APPROVED',
          approverId,
          approvedAt: new Date(),
          notes: notes ?? null,
          hasilCheckingFinance: approverRole === Role.FINANCE ? (hasilCheckingFinance ?? null) : null,
        },
      });

      const nextStep = await tx.cashOpRealisasiStep.findFirst({
        where: { cashOpRequestId: cashOpId, status: 'PENDING' },
        orderBy: { stepOrder: 'asc' },
      });

      if (!nextStep) {
        // Finalized — all approvals done
        const completed = await tx.cashOperationRequest.update({
          where: { id: cashOpId },
          data: {
            // Issue D: Use REALISASI_DONE for new flow
            status: 'REALISASI_DONE',
            realisasiStatus: 'DONE',
            realisasiCompletedAt: new Date(),
            realisasiCurrentStepRole: null,
            realisasiRejectedAt: null,
            realisasiRejectedById: null,
            realisasiRejectedReason: null,
          },
        });

        const finalApproved = new Prisma.Decimal(cashOp.finalApprovedAmount || 0);
        const realisasi = new Prisma.Decimal(cashOp.realisasiTotal || 0);
        const selisih = finalApproved.minus(realisasi);

        if (selisih.gt(0)) {
          refundAmount = selisih;
          await this.budgetLedger.partialRefundForCashOp(
            cashOpId,
            selisih,
            `Selisih realisasi: approved Rp ${finalApproved.toFixed(0)}, realisasi Rp ${realisasi.toFixed(0)}`,
            approverId,
            CashOpPartialRefundType.REALISASI_VARIANCE,
            tx,
          );
        }
        return completed;
      }

      // FIX: Map ALL approver roles in the multi-step chain to correct status values
      const statusMap: Record<string, CashOpStatus> = {
        [Role.PM_SENIOR]: 'REALISASI_PENDING_PM',
        [Role.OPERATIONAL_MANAGER]: 'REALISASI_PENDING_OPS',
        [Role.GENERAL_MANAGER]: 'REALISASI_PENDING_GM',
        [Role.FINANCE]: 'REALISASI_PENDING_FINANCE',
        [Role.MARKETING_HEAD]: 'REALISASI_PENDING_MARKETING_HEAD' as CashOpStatus,
      };
      const realisasiStatusMap: Record<string, RealisasiStatus> = {
        [Role.PM_SENIOR]: 'PENDING_PM_REVIEW',
        [Role.OPERATIONAL_MANAGER]: 'PENDING_OPS_REVIEW',
        [Role.GENERAL_MANAGER]: 'PENDING_GM_REVIEW',
        [Role.FINANCE]: 'PENDING_FINANCE_REVIEW',
        [Role.MARKETING_HEAD]: 'PENDING_MARKETING_HEAD_REVIEW',
      };

      const nextStatus = statusMap[nextStep.approverRole] || 'REALISASI_PENDING_FINANCE';
      const nextRealisasiStatus = realisasiStatusMap[nextStep.approverRole] || 'PENDING_FINANCE_REVIEW';

      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          status: nextStatus,
          realisasiStatus: nextRealisasiStatus,
          realisasiCurrentStepRole: nextStep.approverRole,
          realisasiRejectedAt: null,
          realisasiRejectedById: null,
          realisasiRejectedReason: null,
        },
      });
    });

    if (updated.status === 'REALISASI_DONE') {
      const refundMessage = refundAmount && refundAmount.gt(0) ? ` Selisih Rp ${refundAmount.toFixed(0)} dikembalikan ke budget.` : '';
      this.notifications.createForUser(updated.requestedBy, {
        title: 'Realisasi selesai',
        message: `Realisasi ${updated.requestNumber} selesai.${refundMessage}`,
        type: 'CASH_OP_REALISASI_COMPLETED',
        link: `/cash-operation/${updated.id}`,
        entityId: updated.id,
      }).catch(() => {});
      this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiCompleted', { cashOpId: updated.id, requestNumber: updated.requestNumber });
    } else {
      const nextRole = updated.realisasiCurrentStepRole as Role;
      this.notifications.notifyUsersByRole(nextRole, {
        title: 'Realisasi Cash Advance',
        message: `Realisasi ${updated.requestNumber} menunggu review Anda`,
        type: 'CASH_OP_REALISASI_PENDING',
        link: `/cash-operation/${updated.id}`,
        entityId: updated.id,
      }).catch(() => {});
      const approverLabelMap: Record<string, string> = {
        [Role.MARKETING_HEAD]: 'Marketing Head',
        [Role.OPERATIONAL_MANAGER]: 'Ops Manager',
        [Role.FINANCE]: 'Finance',
        [Role.GENERAL_MANAGER]: 'General Manager',
        [Role.PM_SENIOR]: 'PM Senior',
      };
      const approverLabel = approverLabelMap[approverRole] ?? 'Approver';
      this.notifications.createForUser(updated.requestedBy, {
        title: `Realisasi disetujui ${approverLabel}`,
        message: `Realisasi ${updated.requestNumber} telah disetujui dan menunggu tahap berikutnya.`,
        type: 'CASH_OP_REALISASI_PENDING',
        link: `/cash-operation/${updated.id}`,
        entityId: updated.id,
      }).catch(() => {});
    }

    return toRealisasiActionResponse(updated);
  }

  async reject(cashOpId: string, approverId: string, approverRole: Role, reason: string): Promise<RealisasiActionResponse> {
    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const cashOp = await tx.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });

      const currentStatus = cashOp.status;
      // FIX: include ALL pending statuses across the full chain (PM → OPS → GM → Finance)
      const rejectableStatuses = new Set<CashOpStatus>([
        'REALISASI_IN_PROGRESS',   // backward-compat alias treated as PENDING_OPS
        'REALISASI_PENDING_PM',
        'REALISASI_PENDING_OPS',
        'REALISASI_PENDING_GM',
        'REALISASI_PENDING_FINANCE',
        'REALISASI_PENDING_MARKETING_HEAD' as CashOpStatus,
      ]);
      if (!rejectableStatuses.has(currentStatus)) {
        throw new BadRequestException({
          message: 'Invalid state transition',
          action: 'reject',
          currentStatus,
          expected: Array.from(rejectableStatuses),
        });
      }

      if (!cashOp.realisasiCurrentStepRole || cashOp.realisasiCurrentStepRole !== approverRole) {
        throw new ForbiddenException('Bukan giliran role Anda untuk menolak realisasi');
      }

      await tx.cashOpRealisasiStep.updateMany({
        where: { cashOpRequestId: cashOpId, approverRole, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          approverId,
          approvedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // FIX: map ALL approver roles to their correct rejection status (was missing PM and GM)
      const rejectionStatusMap: Record<string, CashOpStatus> = {
        [Role.PM_SENIOR]: 'REALISASI_REJECTED_BY_PM',
        [Role.OPERATIONAL_MANAGER]: 'REALISASI_REJECTED_BY_OPS',
        [Role.GENERAL_MANAGER]: 'REALISASI_REJECTED_BY_GM',
        [Role.FINANCE]: 'REALISASI_REJECTED_BY_FINANCE',
        [Role.MARKETING_HEAD]: 'REALISASI_REJECTED_BY_MARKETING_HEAD' as CashOpStatus,
      };
      const rejectionStatus = (rejectionStatusMap[approverRole] ?? 'REALISASI_REJECTED_BY_FINANCE') as CashOpStatus;

      return tx.cashOperationRequest.update({
        where: { id: cashOpId },
        data: {
          status: rejectionStatus,
          realisasiStatus: 'REJECTED',
          realisasiRejectionReason: reason,
          realisasiCurrentStepRole: null,
          // FIX: track rejection details for all approver roles (not just Finance)
          realisasiRejectedAt: new Date(),
          realisasiRejectedById: approverId,
          realisasiRejectedReason: reason,
        },
      });
    });

    const roleLabelMap: Record<string, string> = {
      [Role.PM_SENIOR]: 'PM Senior',
      [Role.OPERATIONAL_MANAGER]: 'Ops Manager',
      [Role.GENERAL_MANAGER]: 'General Manager',
      [Role.FINANCE]: 'Finance',
      [Role.MARKETING_HEAD]: 'Marketing Head',
    };
    const roleLabel = roleLabelMap[approverRole] ?? 'Approver';
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Perlu Revisi',
      message: `Realisasi ${updated.requestNumber} ditolak ${roleLabel}: ${reason}`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});

    this.notifications.emitRealtime(`user:${updated.requestedBy}`, 'cashOp:realisasiRejected', {
      cashOpId: updated.id,
      requestNumber: updated.requestNumber,
      reason,
    });

    return toRealisasiActionResponse(updated);
  }

  async getBundle(cashOpId: string, userId: string, userRole: Role): Promise<RealisasiBundle> {
    const cashOp = await this.prisma.cashOperationRequest.findUnique({
      where: { id: cashOpId },
      include: {
        realisasiItems: { orderBy: { itemNumber: 'asc' } },
        realisasiSteps: {
          orderBy: { stepOrder: 'asc' },
          include: { approver: { select: { id: true, name: true } } },
        },
      },
    });

    if (!cashOp) {
      throw new NotFoundException('Request tidak ditemukan');
    }

    const canView = cashOp.requestedBy === userId || VIEW_ROLES.has(userRole);
    if (!canView) {
      throw new ForbiddenException('Anda tidak memiliki akses ke realisasi ini');
    }

    const windowOpenAt = cashOp.approvedAt ? new Date(cashOp.approvedAt) : null;
    const isWindowOpen = windowOpenAt ? new Date() >= windowOpenAt : false;

    const { realisasiItems, realisasiSteps, ...rest } = cashOp;

    return {
      cashOp: rest as any,
      items: realisasiItems,
      steps: realisasiSteps as RealisasiBundleStep[],
      windowOpenAt,
      isWindowOpen,
    };
  }
}
