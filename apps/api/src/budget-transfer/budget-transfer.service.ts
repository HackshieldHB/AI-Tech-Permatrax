import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BudgetLedgerCategory,
  BudgetLedgerEntryType,
  BudgetLedgerSourceType,
  BudgetTransfer,
  BudgetTransferStatus,
  FinanceProject,
  FinanceProjectStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { runSerializableTransaction } from '../budget-ledger/transaction-retry.util';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import type { SubmitBudgetTransferInput, BudgetTransferFilterInput } from './budget-transfer.dto';

export type BudgetTransferListItem = BudgetTransfer & {
  sourceProject: { id: string; code: string; name: string };
  targetProject: { id: string; code: string; name: string };
  submittedBy: { id: string; name: string | null };
  decidedBy: { id: string; name: string | null } | null;
};

export type BudgetTransferDetail = BudgetTransferListItem;

@Injectable()
export class BudgetTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BudgetLedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(dto: SubmitBudgetTransferInput, actorId: string): Promise<BudgetTransfer> {
    const amount = new Prisma.Decimal(dto.amount);
    const [src, tgt] = await Promise.all([
      this.prisma.financeProject.findUnique({ where: { id: dto.sourceFinanceProjectId } }),
      this.prisma.financeProject.findUnique({ where: { id: dto.targetFinanceProjectId } }),
    ]);
    if (!src) throw new NotFoundException('Proyek sumber tidak ditemukan');
    if (!tgt) throw new NotFoundException('Proyek target tidak ditemukan');
    if (src.status === FinanceProjectStatus.ARCHIVED || tgt.status === FinanceProjectStatus.ARCHIVED) {
      throw new BadRequestException('Transfer tidak dapat melibatkan proyek yang sudah diarsipkan');
    }
    const remaining = this.ledger.getRemainingByCategory(src, dto.sourceCategory);
    if (remaining.lt(amount)) {
      throw new BadRequestException(
        `Sisa budget ${dto.sourceCategory === 'MATERIAL' ? 'material' : 'jasa'} di proyek sumber tidak cukup`,
      );
    }

    const created = await this.prisma.budgetTransfer.create({
      data: {
        sourceFinanceProjectId: dto.sourceFinanceProjectId,
        targetFinanceProjectId: dto.targetFinanceProjectId,
        sourceCategory: dto.sourceCategory as BudgetLedgerCategory,
        targetCategory: dto.targetCategory as BudgetLedgerCategory,
        amount,
        reason: dto.reason.trim(),
        submittedById: actorId,
        status: BudgetTransferStatus.PENDING_GM_APPROVAL,
      },
    });

    await this.notifications.notifyUsersByRole(Role.GENERAL_MANAGER, {
      title: 'Transfer budget menunggu persetujuan',
      message: `Transfer ${amount.toFixed(0)} IDR dari ${src.code} ke ${tgt.code} diajukan. Silakan tinjau.`,
      link: `/budget-transfers/${created.id}`,
      type: 'FINANCE_BUDGET_TRANSFER',
      entityId: created.id,
    });

    return created;
  }

  async approveByGm(transferId: string, actorId: string, notes?: string): Promise<BudgetTransfer> {
    const row = await this.prisma.budgetTransfer.findUnique({ where: { id: transferId } });
    if (!row) throw new NotFoundException('Transfer tidak ditemukan');

    const srcBefore = await this.prisma.financeProject.findUnique({
      where: { id: row.sourceFinanceProjectId },
    });
    const tgtBefore = await this.prisma.financeProject.findUnique({
      where: { id: row.targetFinanceProjectId },
    });
    if (!srcBefore || !tgtBefore) throw new NotFoundException('Proyek finance tidak ditemukan');

    const prevUtilSource = this.ledger.utilizationFromProject(srcBefore);
    const prevUtilTarget = this.ledger.utilizationFromProject(tgtBefore);
    const submitterId = row.submittedById;

    const updated = await runSerializableTransaction(this.prisma, async (tx) => {
      const transfer = await tx.budgetTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new NotFoundException('Transfer tidak ditemukan');
      if (transfer.status !== BudgetTransferStatus.PENDING_GM_APPROVAL) {
        throw new ConflictException('Transfer tidak lagi menunggu persetujuan GM');
      }

      const lockIds = [transfer.sourceFinanceProjectId, transfer.targetFinanceProjectId].sort();
      for (const pid of lockIds) {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "FinanceProject" WHERE id = ${pid} FOR UPDATE`);
      }

      const source = await tx.financeProject.findUniqueOrThrow({
        where: { id: transfer.sourceFinanceProjectId },
      });
      const target = await tx.financeProject.findUniqueOrThrow({
        where: { id: transfer.targetFinanceProjectId },
      });

      if (source.status === FinanceProjectStatus.ARCHIVED || target.status === FinanceProjectStatus.ARCHIVED) {
        throw new BadRequestException(
          'Transfer tidak dapat disetujui karena salah satu proyek sudah diarsipkan',
        );
      }

      const amt = new Prisma.Decimal(transfer.amount);
      const rem = this.ledger.getRemainingByCategory(source, transfer.sourceCategory);
      if (rem.lt(amt)) {
        throw new BadRequestException(
          `Sisa budget ${transfer.sourceCategory === 'MATERIAL' ? 'material' : 'jasa'} di proyek sumber tidak cukup`,
        );
      }

      const sourceData = this.computeSourceAfterOut(source, transfer.sourceCategory, amt);
      const targetData = this.computeTargetAfterIn(target, transfer.targetCategory, amt);

      await tx.financeProject.update({
        where: { id: source.id },
        data: {
          totalBudget: sourceData.totalBudget,
          materialBudget: sourceData.materialBudget,
          jasaBudget: sourceData.jasaBudget,
          updatedById: actorId,
        },
      });
      await tx.financeProject.update({
        where: { id: target.id },
        data: {
          totalBudget: targetData.totalBudget,
          materialBudget: targetData.materialBudget,
          jasaBudget: targetData.jasaBudget,
          updatedById: actorId,
        },
      });

      await tx.budgetLedger.createMany({
        data: [
          {
            financeProjectId: source.id,
            entryType: BudgetLedgerEntryType.TRANSFER_OUT,
            category: transfer.sourceCategory,
            amount: amt,
            sourceType: BudgetLedgerSourceType.TRANSFER,
            sourceId: transfer.id,
            budgetTransferId: transfer.id,
            notes: notes?.trim() ?? null,
            createdById: actorId,
          },
          {
            financeProjectId: target.id,
            entryType: BudgetLedgerEntryType.TRANSFER_IN,
            category: transfer.targetCategory,
            amount: amt,
            sourceType: BudgetLedgerSourceType.TRANSFER,
            sourceId: transfer.id,
            budgetTransferId: transfer.id,
            notes: notes?.trim() ?? null,
            createdById: actorId,
          },
        ],
      });

      await this.ledger.syncOverbudgetInTx(tx, source.id);
      await this.ledger.syncOverbudgetInTx(tx, target.id);

      return tx.budgetTransfer.update({
        where: { id: transfer.id },
        data: {
          status: BudgetTransferStatus.APPROVED,
          decidedById: actorId,
          decidedAt: new Date(),
        },
      });
    });

    await this.ledger.checkAndNotifyThresholds(
      row.sourceFinanceProjectId,
      prevUtilSource,
      [submitterId],
      null,
    );
    await this.ledger.checkAndNotifyThresholds(
      row.targetFinanceProjectId,
      prevUtilTarget,
      [submitterId],
      null,
    );

    await this.notifications.createForUser(submitterId, {
      title: 'Transfer budget disetujui',
      message: `Persetujuan GM untuk transfer antar proyek telah diberikan.`,
      link: `/budget-transfers/${transferId}`,
      type: 'FINANCE_BUDGET_TRANSFER',
      entityId: transferId,
    });

    return updated;
  }

  async rejectByGm(transferId: string, actorId: string, reason: string): Promise<BudgetTransfer> {
    const row = await this.prisma.budgetTransfer.findUnique({ where: { id: transferId } });
    if (!row) throw new NotFoundException('Transfer tidak ditemukan');
    if (row.status !== BudgetTransferStatus.PENDING_GM_APPROVAL) {
      throw new ConflictException('Transfer tidak lagi menunggu persetujuan GM');
    }

    const updated = await this.prisma.budgetTransfer.update({
      where: { id: transferId },
      data: {
        status: BudgetTransferStatus.REJECTED,
        decidedById: actorId,
        decidedAt: new Date(),
        rejectionReason: reason.trim(),
      },
    });

    await this.notifications.createForUser(row.submittedById, {
      title: 'Transfer budget ditolak',
      message: `GM menolak transfer: ${reason.trim()}`,
      link: `/budget-transfers/${transferId}`,
      type: 'FINANCE_BUDGET_TRANSFER',
      entityId: transferId,
    });

    return updated;
  }

  async cancelBySubmitter(transferId: string, actorId: string): Promise<BudgetTransfer> {
    const row = await this.prisma.budgetTransfer.findUnique({ where: { id: transferId } });
    if (!row) throw new NotFoundException('Transfer tidak ditemukan');
    if (row.submittedById !== actorId) {
      throw new ForbiddenException('Hanya pengaju yang dapat membatalkan transfer ini');
    }
    if (row.status !== BudgetTransferStatus.PENDING_GM_APPROVAL) {
      throw new BadRequestException('Hanya transfer menunggu GM yang dapat dibatalkan');
    }
    return this.prisma.budgetTransfer.update({
      where: { id: transferId },
      data: { status: BudgetTransferStatus.CANCELLED },
    });
  }

  async findAll(filter: BudgetTransferFilterInput): Promise<PaginatedResponse<BudgetTransferListItem>> {
    const where: Prisma.BudgetTransferWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sourceFinanceProjectId
        ? { sourceFinanceProjectId: filter.sourceFinanceProjectId }
        : {}),
      ...(filter.targetFinanceProjectId
        ? { targetFinanceProjectId: filter.targetFinanceProjectId }
        : {}),
      ...(filter.submittedById ? { submittedById: filter.submittedById } : {}),
    };

    const orderBy: Prisma.BudgetTransferOrderByWithRelationInput =
      filter.sortBy === 'updatedAt'
        ? { updatedAt: filter.sortOrder }
        : { createdAt: filter.sortOrder };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.budgetTransfer.count({ where }),
      this.prisma.budgetTransfer.findMany({
        where,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy,
        include: {
          sourceProject: { select: { id: true, code: true, name: true } },
          targetProject: { select: { id: true, code: true, name: true } },
          submittedBy: { select: { id: true, name: true } },
          decidedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return paginate(rows as BudgetTransferListItem[], total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<BudgetTransferDetail> {
    const row = await this.prisma.budgetTransfer.findUnique({
      where: { id },
      include: {
        sourceProject: { select: { id: true, code: true, name: true } },
        targetProject: { select: { id: true, code: true, name: true } },
        submittedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('Transfer tidak ditemukan');
    return row as BudgetTransferDetail;
  }

  private computeSourceAfterOut(
    p: FinanceProject,
    cat: BudgetLedgerCategory,
    amount: Prisma.Decimal,
  ): { totalBudget: Prisma.Decimal; materialBudget: Prisma.Decimal | null; jasaBudget: Prisma.Decimal | null } {
    const oldTb = new Prisma.Decimal(p.totalBudget);
    const newTb = oldTb.minus(amount);
    if (newTb.lt(0)) {
      throw new BadRequestException('Total budget proyek sumber tidak cukup untuk transfer');
    }

    if (cat === BudgetLedgerCategory.MATERIAL) {
      const implicit = this.ledger.getMaterialCap(p);
      const curLine = p.materialBudget != null ? new Prisma.Decimal(p.materialBudget) : implicit;
      const newMb = curLine.minus(amount);
      if (newMb.lt(0)) {
        throw new BadRequestException('Alokasi material sumber tidak cukup');
      }
      if (p.jasaBudget != null) {
        const jb = new Prisma.Decimal(p.jasaBudget);
        if (newMb.plus(jb).gt(newTb)) {
          throw new BadRequestException('Alokasi material+jasa sumber melebihi total setelah transfer');
        }
      }
      return { totalBudget: newTb, materialBudget: newMb, jasaBudget: p.jasaBudget };
    }

    const implicitJ = this.ledger.getJasaCap(p);
    const curLineJ = p.jasaBudget != null ? new Prisma.Decimal(p.jasaBudget) : implicitJ;
    const newJb = curLineJ.minus(amount);
    if (newJb.lt(0)) {
      throw new BadRequestException('Alokasi jasa sumber tidak cukup');
    }
    if (p.materialBudget != null) {
      const mb = new Prisma.Decimal(p.materialBudget);
      if (mb.plus(newJb).gt(newTb)) {
        throw new BadRequestException('Alokasi material+jasa sumber melebihi total setelah transfer');
      }
    }
    return { totalBudget: newTb, materialBudget: p.materialBudget, jasaBudget: newJb };
  }

  private computeTargetAfterIn(
    p: FinanceProject,
    cat: BudgetLedgerCategory,
    amount: Prisma.Decimal,
  ): { totalBudget: Prisma.Decimal; materialBudget: Prisma.Decimal | null; jasaBudget: Prisma.Decimal | null } {
    const oldTb = new Prisma.Decimal(p.totalBudget);
    const newTb = oldTb.plus(amount);

    if (cat === BudgetLedgerCategory.MATERIAL) {
      const implicit = this.ledger.getMaterialCap(p);
      const curLine = p.materialBudget != null ? new Prisma.Decimal(p.materialBudget) : implicit;
      const newMb = curLine.plus(amount);
      if (p.jasaBudget != null) {
        const jb = new Prisma.Decimal(p.jasaBudget);
        if (newMb.plus(jb).gt(newTb)) {
          throw new BadRequestException('Alokasi material+jasa target melebihi total setelah transfer');
        }
      }
      return { totalBudget: newTb, materialBudget: newMb, jasaBudget: p.jasaBudget };
    }

    const implicitJ = this.ledger.getJasaCap(p);
    const curLineJ = p.jasaBudget != null ? new Prisma.Decimal(p.jasaBudget) : implicitJ;
    const newJb = curLineJ.plus(amount);
    if (p.materialBudget != null) {
      const mb = new Prisma.Decimal(p.materialBudget);
      if (mb.plus(newJb).gt(newTb)) {
        throw new BadRequestException('Alokasi material+jasa target melebihi total setelah transfer');
      }
    }
    return { totalBudget: newTb, materialBudget: p.materialBudget, jasaBudget: newJb };
  }
}
