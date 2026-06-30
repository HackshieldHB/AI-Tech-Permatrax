import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BudgetLedger,
  BudgetLedgerEntryType,
  BudgetTransferStatus,
  FinanceProject,
  FinanceProjectStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetLedgerService } from '../budget-ledger/budget-ledger.service';
import { paginate, PaginatedResponse } from '../common/dto/pagination.dto';
import {
  CreateFinanceProjectInput,
  FinanceProjectFilterInput,
  LedgerFilterInput,
  UpdateBudgetInput,
  UpdateFinanceProjectInput,
  UpdatePlanningInput,
} from './finance-project.dto';


export type FinanceProjectListItem = FinanceProject & {
  materialRemaining: number;
  jasaRemaining: number;
};

export type ProjectActivityStats = {
  totalTransactions: number;
  deductCount: number;
  refundCount: number;
  transferCount: number;
  lastActivityAt: Date | null;
  lastActivityType: BudgetLedgerEntryType | null;
};

export type FinanceProjectDetail = FinanceProjectListItem & {
  pendingTransferCount: number;
  recentLedgerEntries: BudgetLedger[];
  activityStats: ProjectActivityStats;
};

@Injectable()
export class FinanceProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: BudgetLedgerService,
  ) {}

  async create(dto: CreateFinanceProjectInput, actorId: string): Promise<FinanceProject> {
    const tb = new Prisma.Decimal(dto.totalBudget);
    const mb =
      dto.materialBudget != null ? new Prisma.Decimal(dto.materialBudget) : undefined;
    const jb = dto.jasaBudget != null ? new Prisma.Decimal(dto.jasaBudget) : undefined;
    const endDate = dto.endDate != null ? new Date(dto.endDate) : null;

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          let code: string;
          if (dto.code != null && dto.code.trim().length > 0) {
            code = dto.code.trim().toUpperCase();
            this.assertManualProjectCode(code);
          } else {
            const y = new Date().getFullYear();
            code = await this.nextAutoFinCode(tx, y);
          }

          const project = await tx.financeProject.create({
            data: {
              code,
              name: dto.name.trim(),
              description: dto.description?.trim() ?? null,
              projectType: dto.projectType ?? 'FTTH',
              totalBudget: tb,
              materialBudget: mb ?? null,
              jasaBudget: jb ?? null,
              budgetPerizinan: dto.budgetPerizinan != null ? new Prisma.Decimal(dto.budgetPerizinan) : null,
              budgetLainLain: dto.budgetLainLain != null ? new Prisma.Decimal(dto.budgetLainLain) : null,
              endDate,
              createdById: actorId,
              updatedById: actorId,
            },
          });

          const metadata: Prisma.InputJsonValue = {
            totalBudget: tb.toString(),
            materialBudget: mb?.toString() ?? null,
            jasaBudget: jb?.toString() ?? null,
          };

          await tx.budgetLedger.create({
            data: {
              financeProjectId: project.id,
              entryType: BudgetLedgerEntryType.BUDGET_INIT,
              amount: tb,
              sourceType: 'MANUAL_ADJUSTMENT',
              sourceId: project.id,
              notes: 'Inisialisasi budget',
              metadata,
              createdById: actorId,
            },
          });

          return project;
        });
      } catch (e) {
        lastError = e;
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          (dto.code == null || dto.code.trim().length === 0)
        ) {
          continue;
        }
        throw e;
      }
    }
    if (lastError instanceof Error) {
      throw new ConflictException(
        `Gagal membuat proyek dengan kode otomatis setelah beberapa percobaan: ${lastError.message}`,
      );
    }
    throw new ConflictException('Gagal membuat proyek dengan kode otomatis setelah beberapa percobaan');
  }

  async update(id: string, dto: UpdateFinanceProjectInput, actorId: string): Promise<FinanceProject> {
    const cur = await this.prisma.financeProject.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Finance project tidak ditemukan');

    if (cur.isDefaultUncategorized) {
      if (
        dto.status === FinanceProjectStatus.CLOSED ||
        dto.status === FinanceProjectStatus.ARCHIVED
      ) {
        throw new BadRequestException('Proyek GENERAL tidak boleh ditutup atau diarsipkan');
      }
      if (dto.name != null || dto.description !== undefined) {
        throw new BadRequestException(
          'Project GENERAL/UNCATEGORIZED dikelola sistem dan tidak dapat diubah namanya atau deskripsinya',
        );
      }
      if (dto.endDate !== undefined) {
        throw new BadRequestException('Tanggal akhir proyek GENERAL tidak dapat diubah');
      }
    }

    if (dto.status != null) {
      this.assertStatusTransition(cur.status, dto.status);
    }

    if (dto.status === FinanceProjectStatus.ARCHIVED) {
      const pendingTx = await this.prisma.budgetTransfer.count({
        where: {
          status: BudgetTransferStatus.PENDING_GM_APPROVAL,
          OR: [{ sourceFinanceProjectId: id }, { targetFinanceProjectId: id }],
        },
      });
      if (pendingTx > 0) {
        throw new BadRequestException(
          'Tidak dapat mengarsipkan proyek: masih ada transfer antar budget yang menunggu persetujuan GM',
        );
      }
    }

    return this.prisma.financeProject.update({
      where: { id },
      data: {
        ...(dto.name != null ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.endDate !== undefined
          ? { endDate: dto.endDate ? new Date(dto.endDate) : null }
          : {}),
        ...(dto.status != null ? { status: dto.status } : {}),
        updatedById: actorId,
      },
    });
  }

  async updateBudget(id: string, dto: UpdateBudgetInput, actorId: string): Promise<FinanceProject> {
    const cur = await this.prisma.financeProject.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Finance project tidak ditemukan');
    if (cur.isDefaultUncategorized) {
      throw new BadRequestException('Budget proyek GENERAL tidak dapat disesuaikan melalui endpoint ini');
    }

    const newTotal = new Prisma.Decimal(dto.totalBudget);
    const spentSum = new Prisma.Decimal(cur.materialSpent).plus(cur.jasaSpent);
    if (newTotal.lt(spentSum)) {
      throw new BadRequestException(
        'Total budget baru tidak boleh kurang dari total realisasi (material + jasa)',
      );
    }

    const newMaterial =
      dto.materialBudget === undefined
        ? cur.materialBudget
        : dto.materialBudget == null
          ? null
          : new Prisma.Decimal(dto.materialBudget);
    const newJasa =
      dto.jasaBudget === undefined
        ? cur.jasaBudget
        : dto.jasaBudget == null
          ? null
          : new Prisma.Decimal(dto.jasaBudget);

    if (newMaterial != null && newJasa != null && newMaterial.plus(newJasa).gt(newTotal)) {
      throw new BadRequestException('Material + Jasa budget tidak boleh melebihi Total Budget');
    }

    const metadata: Prisma.InputJsonValue = {
      previous: {
        totalBudget: cur.totalBudget.toString(),
        materialBudget: cur.materialBudget?.toString() ?? null,
        jasaBudget: cur.jasaBudget?.toString() ?? null,
        materialSpent: cur.materialSpent.toString(),
        jasaSpent: cur.jasaSpent.toString(),
      },
      next: {
        totalBudget: newTotal.toString(),
        materialBudget: newMaterial?.toString() ?? null,
        jasaBudget: newJasa?.toString() ?? null,
      },
      reason: dto.reason ?? null,
    };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.financeProject.update({
        where: { id },
        data: {
          totalBudget: newTotal,
          materialBudget: newMaterial,
          jasaBudget: newJasa,
          updatedById: actorId,
        },
      });

      await tx.budgetLedger.create({
        data: {
          financeProjectId: id,
          entryType: BudgetLedgerEntryType.BUDGET_ADJUSTMENT,
          amount: newTotal,
          sourceType: 'MANUAL_ADJUSTMENT',
          sourceId: id,
          notes: dto.reason ?? null,
          metadata,
          createdById: actorId,
        },
      });

      const u = this.ledgerService.utilizationFromProject(updated);
      return tx.financeProject.update({
        where: { id },
        data: { isOverbudget: u.material >= 1 || u.jasa >= 1 },
      });
    });
  }

  async findAll(filter: FinanceProjectFilterInput): Promise<PaginatedResponse<FinanceProjectListItem>> {
    const where: Prisma.FinanceProjectWhereInput = {
      ...(filter.includeArchived ? {} : { status: { not: FinanceProjectStatus.ARCHIVED } }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { code: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const sortField = filter.sortBy ?? 'createdAt';
    const orderBy: Prisma.FinanceProjectOrderByWithRelationInput = {
      [sortField]: filter.sortOrder,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.financeProject.count({ where }),
      this.prisma.financeProject.findMany({
        where,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy,
      }),
    ]);

    const data = rows.map((p) => this.hydrateListItem(p));
    return paginate(data, total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<FinanceProjectDetail> {
    const p = await this.prisma.financeProject.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Finance project tidak ditemukan');

    const [pendingTransferCount, recentLedgerEntries, groupRows, lastActivity] = await Promise.all([
      this.prisma.budgetTransfer.count({
        where: {
          status: BudgetTransferStatus.PENDING_GM_APPROVAL,
          OR: [{ sourceFinanceProjectId: id }, { targetFinanceProjectId: id }],
        },
      }),
      this.prisma.budgetLedger.findMany({
        where: { financeProjectId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.budgetLedger.groupBy({
        by: ['entryType'],
        where: { financeProjectId: id },
        _count: { _all: true },
      }),
      this.prisma.budgetLedger.findFirst({
        where: { financeProjectId: id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, entryType: true },
      }),
    ]);

    const entryTypeStr = (t: BudgetLedgerEntryType) => t as string;
    const activityStats: ProjectActivityStats = {
      totalTransactions: groupRows.reduce((s, r) => s + r._count._all, 0),
      deductCount: groupRows
        .filter((r) => entryTypeStr(r.entryType).startsWith('DEDUCT_'))
        .reduce((s, r) => s + r._count._all, 0),
      refundCount: groupRows
        .filter((r) => entryTypeStr(r.entryType).startsWith('REFUND_'))
        .reduce((s, r) => s + r._count._all, 0),
      transferCount: groupRows
        .filter((r) => entryTypeStr(r.entryType).startsWith('TRANSFER_'))
        .reduce((s, r) => s + r._count._all, 0),
      lastActivityAt: lastActivity?.createdAt ?? null,
      lastActivityType: lastActivity?.entryType ?? null,
    };

    return {
      ...this.hydrateListItem(p),
      pendingTransferCount,
      recentLedgerEntries,
      activityStats,
    };
  }

  async getLedgerEntries(
    id: string,
    filter: LedgerFilterInput,
  ): Promise<PaginatedResponse<BudgetLedger>> {
    await this.ensureProjectExists(id);
    const createdFilter: Prisma.DateTimeFilter = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
    const where: Prisma.BudgetLedgerWhereInput = {
      financeProjectId: id,
      ...(filter.entryType ? { entryType: filter.entryType } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(Object.keys(createdFilter).length > 0 ? { createdAt: createdFilter } : {}),
    };

    const sortField = filter.sortBy ?? 'createdAt';
    const orderBy: Prisma.BudgetLedgerOrderByWithRelationInput = {
      [sortField]: filter.sortOrder,
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.budgetLedger.count({ where }),
      this.prisma.budgetLedger.findMany({
        where,
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
        orderBy,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return paginate(rows, total, filter.page, filter.limit);
  }

  async getAdjustments(id: string): Promise<BudgetLedger[]> {
    await this.ensureProjectExists(id);
    return this.prisma.budgetLedger.findMany({
      where: {
        financeProjectId: id,
        entryType: {
          in: [BudgetLedgerEntryType.BUDGET_INIT, BudgetLedgerEntryType.BUDGET_ADJUSTMENT],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updatePlanning(id: string, dto: UpdatePlanningInput): Promise<{ success: true }> {
    await this.ensureProjectExists(id);
    await this.prisma.$transaction([
      this.prisma.financeProjectPlanning.deleteMany({ where: { financeProjectId: id } }),
      this.prisma.financeProjectPlanning.createMany({
        data: dto.plannings.map((p) => ({
          financeProjectId: id,
          month: p.month,
          year: p.year,
          plannedAmount: new Prisma.Decimal(p.plannedAmount),
        })),
      }),
    ]);
    return { success: true };
  }

  async getActualByMonth(id: string): Promise<Array<{ month: number; year: number; actualAmount: number }>> {
    const rows = await this.prisma.budgetLedger.findMany({
      where: {
        financeProjectId: id,
        entryType: {
          in: [
            BudgetLedgerEntryType.DEDUCT_MATERIAL,
            BudgetLedgerEntryType.DEDUCT_JASA,
            BudgetLedgerEntryType.REFUND_MATERIAL,
            BudgetLedgerEntryType.REFUND_JASA,
          ],
        },
      },
      select: { createdAt: true, amount: true, entryType: true },
    });

    const groups = new Map<string, number>();
    for (const r of rows) {
      const m = r.createdAt.getMonth() + 1;
      const y = r.createdAt.getFullYear();
      const key = `${y}-${m}`;
      const isRefund = r.entryType.startsWith('REFUND_');
      const val = Number(r.amount);
      groups.set(key, (groups.get(key) || 0) + (isRefund ? -val : val));
    }

    return Array.from(groups.entries())
      .map(([key, actualAmount]) => {
        const [year, month] = key.split('-').map(Number);
        return { month, year, actualAmount };
      })
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
  }

  async getPlanning(id: string) {
    return this.prisma.financeProjectPlanning.findMany({
      where: { financeProjectId: id },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });
  }

  private hydrateListItem(p: FinanceProject): FinanceProjectListItem {
    return {
      ...p,
      materialRemaining: this.ledgerService.getMaterialRemaining(p).toNumber(),
      jasaRemaining: this.ledgerService.getJasaRemaining(p).toNumber(),
    };
  }

  private async ensureProjectExists(id: string): Promise<void> {
    const n = await this.prisma.financeProject.count({ where: { id } });
    if (!n) throw new NotFoundException('Finance project tidak ditemukan');
  }

  private assertManualProjectCode(code: string): void {
    if (!/^[A-Z0-9-]+$/.test(code) || code.length < 3 || code.length > 20) {
      throw new BadRequestException(
        'Kode proyek harus 3–20 karakter, hanya huruf kapital, angka, dan tanda hubung',
      );
    }
  }

  private assertStatusTransition(from: FinanceProjectStatus, to: FinanceProjectStatus): void {
    if (from === to) return;
    if (from === FinanceProjectStatus.ACTIVE && to === FinanceProjectStatus.CLOSED) return;
    if (from === FinanceProjectStatus.CLOSED && to === FinanceProjectStatus.ARCHIVED) return;
    throw new BadRequestException(`Transisi status tidak diizinkan: ${from} → ${to}`);
  }

  private async nextAutoFinCode(tx: Prisma.TransactionClient, year: number): Promise<string> {
    const prefix = `FIN-${year}-`;
    const rows = await tx.financeProject.findMany({
      where: { code: { startsWith: prefix } },
      select: { code: true },
      orderBy: { code: 'desc' },
      take: 1,
    });
    let seq = 1;
    if (rows[0]) {
      const suffix = rows[0].code.slice(prefix.length);
      const n = parseInt(suffix, 10);
      if (!Number.isNaN(n)) seq = n + 1;
    }
    if (seq > 999) {
      throw new BadRequestException('Urutan kode otomatis untuk tahun ini sudah mencapai batas 999');
    }
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
