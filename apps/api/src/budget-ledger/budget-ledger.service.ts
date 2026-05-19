import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BudgetLedgerEntryType,
  BudgetLedgerSourceType,
  FinanceProject,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { runSerializableTransaction } from './transaction-retry.util';

export type UtilizationPair = { material: number; jasa: number };

/** Metadata.discriminator for MVP single partial refund per cash op per variance type. */
export const CashOpPartialRefundType = {
  REALISASI_VARIANCE: 'REALISASI_VARIANCE',
  REIMBURSEMENT_VARIANCE: 'REIMBURSEMENT_VARIANCE',
} as const;

export type CashOpPartialRefundTypeName =
  (typeof CashOpPartialRefundType)[keyof typeof CashOpPartialRefundType];

function isTaggedPartialRefundMetadata(
  metadata: Prisma.JsonValue | null | undefined,
  partialType: CashOpPartialRefundTypeName,
): boolean {
  if (metadata === null || metadata === undefined) return false;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const rec = metadata as Record<string, unknown>;
  return rec.partialRefundType === partialType;
}

/** REFUND_JASA row counts as a blocking “full refund already posted” only if it is not a tagged partial (Strategy A / OP1). */
export function isFullCashOpRefundRow(metadata: Prisma.JsonValue | null | undefined): boolean {
  if (metadata === null || metadata === undefined) return true;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return true;
  return !('partialRefundType' in metadata);
}

type ProjectRow = {
  totalBudget: Prisma.Decimal;
  materialBudget: Prisma.Decimal | null;
  jasaBudget: Prisma.Decimal | null;
  materialSpent: Prisma.Decimal;
  jasaSpent: Prisma.Decimal;
};

@Injectable()
export class BudgetLedgerService {
  private readonly logger = new Logger(BudgetLedgerService.name);
  private cachedGeneralProjectId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Resolve project: null → GENERAL (system default); validate id otherwise. */
  async resolveProjectId(financeProjectId: string | null, tx?: Prisma.TransactionClient): Promise<string> {
    if (!financeProjectId) {
      return this.getDefaultGeneralProjectId(tx);
    }
    const client = tx ?? this.prisma;
    const row = await client.financeProject.findUnique({ where: { id: financeProjectId } });
    if (!row) {
      throw new NotFoundException('Finance project tidak ditemukan');
    }
    return financeProjectId;
  }

  private async getDefaultGeneralProjectId(tx?: Prisma.TransactionClient): Promise<string> {
    if (this.cachedGeneralProjectId && !tx) {
      return this.cachedGeneralProjectId;
    }
    const client = tx ?? this.prisma;
    const row = await client.financeProject.findFirst({
      where: { isDefaultUncategorized: true },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException(
        'Finance project GENERAL belum di-seed — jalankan migrasi finance dashboard',
      );
    }
    if (!tx) this.cachedGeneralProjectId = row.id;
    return row.id;
  }

  clearGeneralProjectIdCache(): void {
    this.cachedGeneralProjectId = null;
  }

  getMaterialRemaining(project: ProjectRow): Prisma.Decimal {
    const tb = new Prisma.Decimal(project.totalBudget);
    const ms = new Prisma.Decimal(project.materialSpent);
    const js = new Prisma.Decimal(project.jasaSpent);
    if (project.materialBudget != null) {
      return new Prisma.Decimal(project.materialBudget).minus(ms);
    }
    if (project.jasaBudget != null) {
      return tb.minus(new Prisma.Decimal(project.jasaBudget)).minus(ms);
    }
    return tb.minus(ms).minus(js);
  }

  getJasaRemaining(project: ProjectRow): Prisma.Decimal {
    const tb = new Prisma.Decimal(project.totalBudget);
    const ms = new Prisma.Decimal(project.materialSpent);
    const js = new Prisma.Decimal(project.jasaSpent);
    if (project.jasaBudget != null) {
      return new Prisma.Decimal(project.jasaBudget).minus(js);
    }
    if (project.materialBudget != null) {
      return tb.minus(new Prisma.Decimal(project.materialBudget)).minus(js);
    }
    return tb.minus(ms).minus(js);
  }

  /** Denominator for material utilization (0 = uncapped / “belum dialokasi” bucket). */
  getMaterialCap(project: ProjectRow): Prisma.Decimal {
    if (project.materialBudget != null) {
      return new Prisma.Decimal(project.materialBudget);
    }
    if (project.jasaBudget != null) {
      return new Prisma.Decimal(project.totalBudget).minus(new Prisma.Decimal(project.jasaBudget));
    }
    return new Prisma.Decimal(project.totalBudget);
  }

  getJasaCap(project: ProjectRow): Prisma.Decimal {
    if (project.jasaBudget != null) {
      return new Prisma.Decimal(project.jasaBudget);
    }
    if (project.materialBudget != null) {
      return new Prisma.Decimal(project.totalBudget).minus(new Prisma.Decimal(project.materialBudget));
    }
    return new Prisma.Decimal(project.totalBudget);
  }

  /** Sisa budget per kategori (validasi transfer, dll.). */
  getRemainingByCategory(project: ProjectRow, category: 'MATERIAL' | 'JASA'): Prisma.Decimal {
    return category === 'MATERIAL'
      ? this.getMaterialRemaining(project)
      : this.getJasaRemaining(project);
  }

  /** Actor transaksi + pembuat Order/CashOp — dedup untuk notifikasi ambang. */
  private thresholdNotifyUserIds(actorId: string, creatorId: string | null): string[] {
    return Array.from(
      new Set([...(actorId ? [actorId] : []), ...(creatorId ? [creatorId] : [])]),
    );
  }

  utilizationFromProject(project: ProjectRow): UtilizationPair {
    return {
      material: this.ratioUtil(new Prisma.Decimal(project.materialSpent), this.getMaterialCap(project)),
      jasa: this.ratioUtil(new Prisma.Decimal(project.jasaSpent), this.getJasaCap(project)),
    };
  }

  /** Ratio spent/cap; cap 0 and spent>0 → 2 (force overbudget); cap 0 spent 0 → 0. */
  private ratioUtil(spent: Prisma.Decimal, cap: Prisma.Decimal): number {
    if (cap.eq(0)) {
      return spent.gt(0) ? 2 : 0;
    }
    return spent.div(cap).toNumber();
  }

  /** P2002 on idempotency unique indexes: log and skip duplicate side-effects. */
  private async warnLedgerUniqueConflict(
    client: Prisma.TransactionClient,
    operation: string,
    where: Prisma.BudgetLedgerWhereInput,
  ): Promise<void> {
    const existing = await client.budgetLedger.findFirst({
      where,
      select: { id: true },
    });
    this.logger.warn(
      `BudgetLedger ${operation}: idempotent skip after unique conflict (existing id=${existing?.id ?? 'unknown'})`,
    );
  }

  async deductForOrder(
    orderId: string,
    projectId: string,
    amountMaterial: Prisma.Decimal,
    actorId: string,
    creatorId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prevUtil = tx
      ? await (async () => {
          const project = await tx.financeProject.findUnique({ where: { id: projectId } });
          if (!project) throw new NotFoundException('Finance project tidak ditemukan');
          return this.utilizationFromProject(project);
        })()
      : await this.loadUtilization(projectId);

    const body = async (client: Prisma.TransactionClient) => {
      await this.lockProjectRow(client, projectId);
      const existing = await client.budgetLedger.findFirst({
        where: {
          sourceType: BudgetLedgerSourceType.ORDER,
          sourceId: orderId,
          entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
        },
      });
      if (existing) return;

      try {
        await client.budgetLedger.create({
          data: {
            financeProjectId: projectId,
            entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
            category: 'MATERIAL',
            amount: amountMaterial,
            sourceType: BudgetLedgerSourceType.ORDER,
            sourceId: orderId,
            createdById: actorId,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          await this.warnLedgerUniqueConflict(client, 'deductForOrder', {
            sourceType: BudgetLedgerSourceType.ORDER,
            sourceId: orderId,
            entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
          });
          return;
        }
        throw e;
      }

      await client.financeProject.update({
        where: { id: projectId },
        data: { materialSpent: { increment: amountMaterial } },
      });
      await this.syncOverbudgetFlag(client, projectId);
    };

    if (tx) {
      await body(tx);
      return;
    }
    await runSerializableTransaction(this.prisma, body);
    const recipients = this.thresholdNotifyUserIds(actorId, creatorId);
    const p = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!p) return;
    if (p.isDefaultUncategorized && amountMaterial.gt(0)) {
      await this.notifyUncategorizedOverbudget(p, 'Material', recipients);
    } else {
      await this.checkAndNotifyThresholds(projectId, prevUtil, recipients, null);
    }
  }

  async deductForCashOp(
    cashOpId: string,
    projectId: string,
    amountJasa: Prisma.Decimal,
    actorId: string,
    creatorId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prevUtil = tx
      ? await (async () => {
          const project = await tx.financeProject.findUnique({ where: { id: projectId } });
          if (!project) throw new NotFoundException('Finance project tidak ditemukan');
          return this.utilizationFromProject(project);
        })()
      : await this.loadUtilization(projectId);

    const body = async (client: Prisma.TransactionClient) => {
      await this.lockProjectRow(client, projectId);
      const existing = await client.budgetLedger.findFirst({
        where: {
          sourceType: BudgetLedgerSourceType.CASH_OP,
          sourceId: cashOpId,
          entryType: BudgetLedgerEntryType.DEDUCT_JASA,
        },
      });
      if (existing) return;

      try {
        await client.budgetLedger.create({
          data: {
            financeProjectId: projectId,
            entryType: BudgetLedgerEntryType.DEDUCT_JASA,
            category: 'JASA',
            amount: amountJasa,
            sourceType: BudgetLedgerSourceType.CASH_OP,
            sourceId: cashOpId,
            createdById: actorId,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          await this.warnLedgerUniqueConflict(client, 'deductForCashOp', {
            sourceType: BudgetLedgerSourceType.CASH_OP,
            sourceId: cashOpId,
            entryType: BudgetLedgerEntryType.DEDUCT_JASA,
          });
          return;
        }
        throw e;
      }

      await client.financeProject.update({
        where: { id: projectId },
        data: { jasaSpent: { increment: amountJasa } },
      });
      await this.syncOverbudgetFlag(client, projectId);
    };

    if (tx) {
      await body(tx);
      return;
    }
    await runSerializableTransaction(this.prisma, body);
    const recipients = this.thresholdNotifyUserIds(actorId, creatorId);
    const p = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!p) return;
    if (p.isDefaultUncategorized && amountJasa.gt(0)) {
      await this.notifyUncategorizedOverbudget(p, 'Jasa', recipients);
    } else {
      await this.checkAndNotifyThresholds(projectId, prevUtil, recipients, null);
    }
  }

  /**
   * After an outer Serializable tx commits: threshold / uncategorized notifications for material deduct.
   */
  async afterDeductNotifyOrder(
    projectId: string,
    prevUtil: UtilizationPair,
    actorId: string,
    creatorId: string | null,
    amountMaterial: Prisma.Decimal,
  ): Promise<void> {
    if (!amountMaterial.gt(0)) return;
    const recipients = this.thresholdNotifyUserIds(actorId, creatorId);
    const p = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!p) return;
    if (p.isDefaultUncategorized) {
      await this.notifyUncategorizedOverbudget(p, 'Material', recipients);
    } else {
      await this.checkAndNotifyThresholds(projectId, prevUtil, recipients, null);
    }
  }

  /**
   * After an outer Serializable tx commits: threshold / uncategorized notifications for jasa deduct.
   */
  async afterDeductNotifyCashOp(
    projectId: string,
    prevUtil: UtilizationPair,
    actorId: string,
    creatorId: string | null,
    amountJasa: Prisma.Decimal,
  ): Promise<void> {
    if (!amountJasa.gt(0)) return;
    const recipients = this.thresholdNotifyUserIds(actorId, creatorId);
    const p = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!p) return;
    if (p.isDefaultUncategorized) {
      await this.notifyUncategorizedOverbudget(p, 'Jasa', recipients);
    } else {
      await this.checkAndNotifyThresholds(projectId, prevUtil, recipients, null);
    }
  }

  async refundForOrder(orderId: string, actorId: string, reason: string, tx: Prisma.TransactionClient): Promise<void> {
    const deduct = await tx.budgetLedger.findFirst({
      where: {
        sourceType: BudgetLedgerSourceType.ORDER,
        sourceId: orderId,
        entryType: BudgetLedgerEntryType.DEDUCT_MATERIAL,
      },
    });
    if (!deduct) return;

    const refundExists = await tx.budgetLedger.findFirst({
      where: {
        sourceType: BudgetLedgerSourceType.ORDER,
        sourceId: orderId,
        entryType: BudgetLedgerEntryType.REFUND_MATERIAL,
      },
    });
    if (refundExists) return;

    const pid = deduct.financeProjectId;
    await this.lockProjectRow(tx, pid);
    const amount = new Prisma.Decimal(deduct.amount);

    try {
      await tx.budgetLedger.create({
        data: {
          financeProjectId: pid,
          entryType: BudgetLedgerEntryType.REFUND_MATERIAL,
          category: 'MATERIAL',
          amount,
          sourceType: BudgetLedgerSourceType.ORDER,
          sourceId: orderId,
          notes: `Auto-refund: ${reason}`,
          createdById: actorId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.warnLedgerUniqueConflict(tx, 'refundForOrder', {
          sourceType: BudgetLedgerSourceType.ORDER,
          sourceId: orderId,
          entryType: BudgetLedgerEntryType.REFUND_MATERIAL,
        });
        return;
      }
      throw e;
    }

    const project = await tx.financeProject.findUniqueOrThrow({ where: { id: pid } });
    const decMat = new Prisma.Decimal(project.materialSpent).minus(amount);
    if (decMat.lt(0)) {
      this.logger.warn(`refundForOrder: materialSpent would go negative for project ${pid}; clamped to 0`);
    }
    const newSpent = decMat.lt(0) ? new Prisma.Decimal(0) : decMat;
    await tx.financeProject.update({
      where: { id: pid },
      data: { materialSpent: newSpent },
    });
    await this.syncOverbudgetFlag(tx, pid);
  }

  /**
   * Full refund for CashOp (reverse entire DEDUCT_JASA amount).
   *
   * INVARIANT: A CashOp should not have BOTH a full refund and partial refunds in normal flows.
   * Semantics: full refund = reject/cancel after deduct → reverse all; partial = realisasi or reimbursement variance.
   * If both exist for the same cashOpId, that indicates a logic bug. This method ignores tagged partial
   * REFUND_JASA rows when checking idempotency (Strategy A / OP1) but the system should not rely on that.
   */
  async refundForCashOp(
    cashOpId: string,
    actorId: string,
    reason: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const deduct = await tx.budgetLedger.findFirst({
      where: {
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: cashOpId,
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
      },
    });
    if (!deduct) return;

    const refundRows = await tx.budgetLedger.findMany({
      where: {
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: cashOpId,
        entryType: BudgetLedgerEntryType.REFUND_JASA,
      },
    });
    const fullRefundDone = refundRows.some((r) => isFullCashOpRefundRow(r.metadata));
    if (fullRefundDone) return;

    const pid = deduct.financeProjectId;
    await this.lockProjectRow(tx, pid);
    const amount = new Prisma.Decimal(deduct.amount);

    try {
      await tx.budgetLedger.create({
        data: {
          financeProjectId: pid,
          entryType: BudgetLedgerEntryType.REFUND_JASA,
          category: 'JASA',
          amount,
          sourceType: BudgetLedgerSourceType.CASH_OP,
          sourceId: cashOpId,
          notes: `Auto-refund: ${reason}`,
          createdById: actorId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.warnLedgerUniqueConflict(tx, 'refundForCashOp', {
          sourceType: BudgetLedgerSourceType.CASH_OP,
          sourceId: cashOpId,
          entryType: BudgetLedgerEntryType.REFUND_JASA,
        });
        return;
      }
      throw e;
    }

    const project = await tx.financeProject.findUniqueOrThrow({ where: { id: pid } });
    const decJas = new Prisma.Decimal(project.jasaSpent).minus(amount);
    if (decJas.lt(0)) {
      this.logger.warn(`refundForCashOp: jasaSpent would go negative for project ${pid}; clamped to 0`);
    }
    const newSpent = decJas.lt(0) ? new Prisma.Decimal(0) : decJas;
    await tx.financeProject.update({
      where: { id: pid },
      data: { jasaSpent: newSpent },
    });
    await this.syncOverbudgetFlag(tx, pid);
  }

  /**
   * Partial jasa refund for a CashOp (realisasi variance, reimbursement variance, etc.).
   *
   * INVARIANT: A CashOp should not combine a full {@link refundForCashOp} with partial refunds in
   * normal flows. Full refund reverses the whole DEDUCT_JASA; partials adjust spend for variances.
   * If both exist for the same cashOpId, that indicates a logic bug; {@link refundForCashOp}
   * ignores tagged partial rows for idempotency (Strategy A / OP1) but the system should not rely on that.
   *
   * Tagged via `metadata.partialRefundType` — ignored by {@link refundForCashOp} idempotency (OP1).
   * Does not notify thresholds on utilization drop (mirror refundForCashOp).
   */
  async partialRefundForCashOp(
    cashOpId: string,
    amountJasa: Prisma.Decimal,
    reason: string,
    actorId: string,
    partialRefundType: CashOpPartialRefundTypeName,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (!amountJasa.gt(0)) {
      throw new BadRequestException('Jumlah pengembalian parsial harus lebih dari 0');
    }

    const deduct = await tx.budgetLedger.findFirst({
      where: {
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: cashOpId,
        entryType: BudgetLedgerEntryType.DEDUCT_JASA,
      },
    });
    if (!deduct) {
      throw new NotFoundException('Tidak ada pemotongan cash operation untuk dikembalikan');
    }

    const existingRefunds = await tx.budgetLedger.findMany({
      where: {
        sourceType: BudgetLedgerSourceType.CASH_OP,
        sourceId: cashOpId,
        entryType: BudgetLedgerEntryType.REFUND_JASA,
      },
    });
    const already = existingRefunds.some((row) =>
      isTaggedPartialRefundMetadata(row.metadata, partialRefundType),
    );
    if (already) {
      return;
    }

    const pid = deduct.financeProjectId;
    await this.lockProjectRow(tx, pid);

    const metadata: Prisma.InputJsonValue = {
      partialRefundType,
      refundedAt: new Date().toISOString(),
    };

    try {
      await tx.budgetLedger.create({
        data: {
          financeProjectId: pid,
          entryType: BudgetLedgerEntryType.REFUND_JASA,
          category: 'JASA',
          amount: amountJasa,
          sourceType: BudgetLedgerSourceType.CASH_OP,
          sourceId: cashOpId,
          notes: reason,
          metadata,
          createdById: actorId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.warnLedgerUniqueConflict(tx, 'partialRefundForCashOp', {
          sourceType: BudgetLedgerSourceType.CASH_OP,
          sourceId: cashOpId,
          entryType: BudgetLedgerEntryType.REFUND_JASA,
          metadata: { path: ['partialRefundType'], equals: partialRefundType },
        });
        return;
      }
      throw e;
    }

    const project = await tx.financeProject.findUniqueOrThrow({ where: { id: pid } });
    const decJas = new Prisma.Decimal(project.jasaSpent).minus(amountJasa);
    if (decJas.lt(0)) {
      this.logger.warn(
        `partialRefundForCashOp: jasaSpent would go negative for project ${pid}; clamped to 0`,
      );
    }
    const newSpent = decJas.lt(0) ? new Prisma.Decimal(0) : decJas;
    await tx.financeProject.update({
      where: { id: pid },
      data: { jasaSpent: newSpent },
    });
    await this.syncOverbudgetFlag(tx, pid);
  }

  private async lockProjectRow(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "FinanceProject" WHERE id = ${projectId} FOR UPDATE`,
    );
  }

  private async loadUtilization(projectId: string): Promise<UtilizationPair> {
    const project = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Finance project tidak ditemukan');
    }
    return this.utilizationFromProject(project);
  }

  /** Sinkron flag overbudget setelah mutasi alokasi/realisasi (dipakai modul transfer). */
  async syncOverbudgetInTx(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    await this.syncOverbudgetFlag(tx, projectId);
  }

  private async syncOverbudgetFlag(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    const project = await tx.financeProject.findUniqueOrThrow({ where: { id: projectId } });
    const u = this.utilizationFromProject(project);
    const over = u.material >= 1 || u.jasa >= 1;
    await tx.financeProject.update({
      where: { id: projectId },
      data: { isOverbudget: over },
    });
  }

  /**
   * Post-commit threshold notifications (reads committed utilization).
   * `notifyUserIds`: sudah dedup (actor + creator); FINANCE + GM ditambahkan di NotificationsService.
   */
  async checkAndNotifyThresholds(
    projectId: string,
    prevUtil: UtilizationPair,
    notifyUserIds: string[],
    _tx: Prisma.TransactionClient | null,
  ): Promise<void> {
    const nextUtil = await this.loadUtilization(projectId);
    const p = await this.prisma.financeProject.findUnique({ where: { id: projectId } });
    if (!p) return;
    await this.emitCategoryThreshold('Material', prevUtil.material, nextUtil.material, p, notifyUserIds);
    await this.emitCategoryThreshold('Jasa', prevUtil.jasa, nextUtil.jasa, p, notifyUserIds);
  }

  private async notifyUncategorizedOverbudget(
    p: FinanceProject,
    categoryLabel: 'Material' | 'Jasa',
    notifyUserIds: string[],
  ): Promise<void> {
    await this.notifications.notifyBudgetThresholdAlerts({
      projectId: p.id,
      projectName: p.name,
      projectCode: p.code,
      kind: 'OVERBUDGET',
      categoryLabel,
      notifyUserIds,
    });
  }

  private async emitCategoryThreshold(
    categoryLabel: string,
    prevU: number,
    nextU: number,
    p: FinanceProject,
    notifyUserIds: string[],
  ): Promise<void> {
    if (nextU <= prevU) return;

    const jumpOver = prevU < 0.8 && nextU >= 1;
    const warn80 = prevU < 0.8 && nextU >= 0.8 && nextU < 1;
    const overFrom80 = prevU >= 0.8 && nextU >= 1;

    if (jumpOver) {
      await this.notifications.notifyBudgetThresholdAlerts({
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        kind: 'OVERBUDGET',
        categoryLabel,
        notifyUserIds,
      });
    } else if (warn80) {
      await this.notifications.notifyBudgetThresholdAlerts({
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        kind: 'WARN_80',
        categoryLabel,
        notifyUserIds,
      });
    } else if (overFrom80) {
      await this.notifications.notifyBudgetThresholdAlerts({
        projectId: p.id,
        projectName: p.name,
        projectCode: p.code,
        kind: 'OVERBUDGET',
        categoryLabel,
        notifyUserIds,
      });
    }
  }
}
