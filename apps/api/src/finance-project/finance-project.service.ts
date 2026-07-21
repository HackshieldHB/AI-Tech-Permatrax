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
  CreateFinanceSiteInput,
  FinanceProjectFilterInput,
  LedgerFilterInput,
  UpdateBudgetInput,
  UpdateFinanceProjectInput,
  UpdatePlanningInput,
  SetTimelineDto,
  SetTimelineInput,
} from './finance-project.dto';


export type FinanceProjectListItem = FinanceProject & {
  materialRemaining: number;
  jasaRemaining: number;
  // JLM: realisasi terpadu — untuk project FTTT dihitung dari Transaction Log
  // (sumber data yang sama dengan halaman Detail) agar Dashboard selalu sinkron
  totalSpent: number;
  totalRemaining: number;
  perizinanSpent: number;
  lainLainSpent: number;
  childCount?: number;
  /** When Segment aggregates include Sites, totalBudget may be a number sum */
  aggregatedTotalBudget?: number;
};

// Realisasi per kategori dari FtttTransaction, keyed by financeProjectId
type FtttSpentMap = Map<string, { perizinan: number; material: number; jasa: number; lainLain: number }>;

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
    const projectType = dto.projectType ?? 'FTTH';
    let hierarchyLevel = dto.hierarchyLevel;
    if (!hierarchyLevel) {
      if (dto.parentId) hierarchyLevel = 'SITE';
      else if (projectType === 'FTTT') hierarchyLevel = 'SEGMENT';
      else hierarchyLevel = 'STANDALONE';
    }

    let parentId: string | null = dto.parentId ?? null;
    if (hierarchyLevel === 'SITE') {
      if (!parentId) throw new BadRequestException('Site wajib memiliki parentId Segment');
      const parent = await this.prisma.financeProject.findUnique({ where: { id: parentId } });
      if (!parent || parent.hierarchyLevel !== 'SEGMENT') {
        throw new BadRequestException('parentId harus merujuk ke Finance Segment');
      }
      if (parent.projectType !== 'FTTT') {
        throw new BadRequestException('Site hanya dapat dibuat di bawah Segment FTTT');
      }
    } else {
      parentId = null;
    }

    // Segment: Lain-Lain only; Site: Perizinan+Material+Jasa; STANDALONE/FTTH: existing
    let tb: Prisma.Decimal;
    let mb: Prisma.Decimal | undefined;
    let jb: Prisma.Decimal | undefined;
    let perizinan: Prisma.Decimal | null = null;
    let lainLain: Prisma.Decimal | null = null;

    if (hierarchyLevel === 'SEGMENT') {
      lainLain = new Prisma.Decimal(dto.budgetLainLain ?? dto.totalBudget ?? 0);
      tb = lainLain;
      mb = undefined;
      jb = undefined;
      perizinan = null;
    } else if (hierarchyLevel === 'SITE') {
      perizinan = new Prisma.Decimal(dto.budgetPerizinan ?? 0);
      mb = new Prisma.Decimal(dto.materialBudget ?? 0);
      jb = new Prisma.Decimal(dto.jasaBudget ?? 0);
      tb = perizinan.plus(mb).plus(jb);
      lainLain = new Prisma.Decimal(0);
    } else {
      tb = new Prisma.Decimal(dto.totalBudget);
      mb = dto.materialBudget != null ? new Prisma.Decimal(dto.materialBudget) : undefined;
      jb = dto.jasaBudget != null ? new Prisma.Decimal(dto.jasaBudget) : undefined;
      perizinan = dto.budgetPerizinan != null ? new Prisma.Decimal(dto.budgetPerizinan) : null;
      lainLain = dto.budgetLainLain != null ? new Prisma.Decimal(dto.budgetLainLain) : null;
    }

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
            const prefix = hierarchyLevel === 'SEGMENT' ? 'SEG' : hierarchyLevel === 'SITE' ? 'SITE' : 'FIN';
            code = await this.nextAutoCode(tx, y, prefix);
          }

          const project = await tx.financeProject.create({
            data: {
              code,
              name: dto.name.trim(),
              description: dto.description?.trim() ?? null,
              projectType: hierarchyLevel === 'STANDALONE' ? projectType : 'FTTT',
              hierarchyLevel,
              parentId,
              totalBudget: tb,
              materialBudget: mb ?? null,
              jasaBudget: jb ?? null,
              budgetPerizinan: perizinan,
              budgetLainLain: lainLain,
              endDate,
              createdById: actorId,
              updatedById: actorId,
            },
          });

          const metadata: Prisma.InputJsonValue = {
            totalBudget: tb.toString(),
            materialBudget: mb?.toString() ?? null,
            jasaBudget: jb?.toString() ?? null,
            hierarchyLevel,
            budgetPerizinan: perizinan?.toString() ?? null,
            budgetLainLain: lainLain?.toString() ?? null,
          };

          await tx.budgetLedger.create({
            data: {
              financeProjectId: project.id,
              entryType: BudgetLedgerEntryType.BUDGET_INIT,
              amount: tb,
              sourceType: 'MANUAL_ADJUSTMENT',
              sourceId: project.id,
              notes: hierarchyLevel === 'SEGMENT'
                ? 'Inisialisasi budget Segment (Lain-Lain)'
                : hierarchyLevel === 'SITE'
                  ? 'Inisialisasi budget Site'
                  : 'Inisialisasi budget',
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

  /** Integra V1: create Site under an existing Segment */
  async createSite(segmentId: string, dto: CreateFinanceSiteInput, actorId: string): Promise<FinanceProject> {
    const total =
      (dto.budgetPerizinan ?? 0) + (dto.materialBudget ?? 0) + (dto.jasaBudget ?? 0);
    return this.create(
      {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        projectType: 'FTTT',
        hierarchyLevel: 'SITE',
        parentId: segmentId,
        totalBudget: total,
        budgetPerizinan: dto.budgetPerizinan ?? 0,
        materialBudget: dto.materialBudget ?? 0,
        jasaBudget: dto.jasaBudget ?? 0,
        budgetLainLain: 0,
        endDate: dto.endDate,
      },
      actorId,
    );
  }

  async listSites(segmentId: string): Promise<FinanceProjectListItem[]> {
    const parent = await this.prisma.financeProject.findUnique({ where: { id: segmentId } });
    if (!parent) throw new NotFoundException('Finance project tidak ditemukan');
    if (parent.hierarchyLevel !== 'SEGMENT') {
      throw new BadRequestException('Hanya Segment yang memiliki daftar Site');
    }
    const rows = await this.prisma.financeProject.findMany({
      where: { parentId: segmentId },
      orderBy: { createdAt: 'asc' },
    });
    const ftttSpent = await this.getFtttSpentMap(rows.map((r) => r.id));
    return rows.map((p) => this.hydrateListItem(p, ftttSpent));
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
    const rootsOnly = filter.rootsOnly !== false && !filter.parentId && !filter.hierarchyLevel;
    const where: Prisma.FinanceProjectWhereInput = {
      ...(filter.includeArchived ? {} : { status: { not: FinanceProjectStatus.ARCHIVED } }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.parentId ? { parentId: filter.parentId } : {}),
      ...(filter.hierarchyLevel ? { hierarchyLevel: filter.hierarchyLevel } : {}),
      ...(rootsOnly
        ? { hierarchyLevel: { in: ['SEGMENT', 'STANDALONE'] }, parentId: null }
        : {}),
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
        include: {
          children: { select: { id: true }, take: 200 },
          _count: { select: { children: true } },
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const childIds = rows.flatMap((r) =>
      'children' in r ? ((r.children as { id: string }[]) ?? []).map((c) => c.id) : [],
    );
    const ftttSpent = await this.getFtttSpentMap([...ids, ...childIds]);

    const childBudgetRows =
      childIds.length > 0
        ? await this.prisma.financeProject.findMany({
            where: { id: { in: childIds } },
            select: {
              id: true, parentId: true, totalBudget: true,
              budgetPerizinan: true, materialBudget: true, jasaBudget: true,
            },
          })
        : [];
    const childBudgetByParent = new Map<string, number>();
    // Integra V2: Segment cards show BUDGET summaries (not spent) per category,
    // aggregated from their Sites
    const childPerizinanByParent = new Map<string, number>();
    const childMaterialByParent = new Map<string, number>();
    const childJasaByParent = new Map<string, number>();
    for (const c of childBudgetRows) {
      if (!c.parentId) continue;
      childBudgetByParent.set(c.parentId, (childBudgetByParent.get(c.parentId) ?? 0) + Number(c.totalBudget));
      childPerizinanByParent.set(c.parentId, (childPerizinanByParent.get(c.parentId) ?? 0) + Number(c.budgetPerizinan ?? 0));
      childMaterialByParent.set(c.parentId, (childMaterialByParent.get(c.parentId) ?? 0) + Number(c.materialBudget ?? 0));
      childJasaByParent.set(c.parentId, (childJasaByParent.get(c.parentId) ?? 0) + Number(c.jasaBudget ?? 0));
    }

    const data: FinanceProjectListItem[] = rows.map((p) => {
      const item = this.hydrateListItem(p, ftttSpent);
      const childCount = (p as { _count?: { children: number } })._count?.children ?? 0;
      if (p.hierarchyLevel !== 'SEGMENT') {
        return { ...item, childCount };
      }
      const children = (p as { children?: { id: string }[] }).children ?? [];
      let childSpent = 0;
      for (const c of children) {
        const s = ftttSpent.get(c.id);
        if (s) childSpent += s.perizinan + s.material + s.jasa;
      }
      const lain = ftttSpent.get(p.id)?.lainLain ?? item.lainLainSpent ?? 0;
      const totalSpent = lain + childSpent;
      const sitesBudget = childBudgetByParent.get(p.id) ?? 0;
      const totalBudgetNum = Number(p.totalBudget) + sitesBudget;
      return {
        ...item,
        childCount,
        totalBudget: new Prisma.Decimal(totalBudgetNum),
        totalSpent,
        totalRemaining: totalBudgetNum - totalSpent,
        lainLainSpent: lain,
        aggregatedTotalBudget: totalBudgetNum,
        // Segment budget category summary — sum of Sites' budgets (Lain-lain stays the Segment's own)
        budgetPerizinan: new Prisma.Decimal(childPerizinanByParent.get(p.id) ?? 0),
        materialBudget: new Prisma.Decimal(childMaterialByParent.get(p.id) ?? 0),
        jasaBudget: new Prisma.Decimal(childJasaByParent.get(p.id) ?? 0),
      };
    });

    return paginate(data, total, filter.page, filter.limit);
  }

  async findOne(id: string): Promise<FinanceProjectDetail & { sites?: FinanceProjectListItem[]; parent?: { id: string; code: string; name: string } | null; childCount?: number }> {
    const p = await this.prisma.financeProject.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, code: true, name: true, hierarchyLevel: true } },
        _count: { select: { children: true } },
      },
    });
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

    const ftttSpent = await this.getFtttSpentMap(p.projectType === 'FTTT' ? [p.id] : []);
    const base = {
      ...this.hydrateListItem(p, ftttSpent),
      pendingTransferCount,
      recentLedgerEntries,
      activityStats,
      parent: p.parent ?? null,
      childCount: p._count.children,
    };

    if (p.hierarchyLevel === 'SEGMENT') {
      const sites = await this.listSites(id);
      const sitesBudget = sites.reduce((s, x) => s + Number(x.totalBudget), 0);
      const sitesSpent = sites.reduce((s, x) => s + (x.totalSpent ?? 0), 0);
      const lain = base.lainLainSpent ?? 0;
      const totalBudgetNum = Number(p.totalBudget) + sitesBudget;
      const totalSpent = lain + sitesSpent;
      return {
        ...base,
        totalBudget: new Prisma.Decimal(totalBudgetNum),
        totalSpent,
        totalRemaining: totalBudgetNum - totalSpent,
        aggregatedTotalBudget: totalBudgetNum,
        sites,
      };
    }

    return base;
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

  // JLM: FTTT S-Curve baseline milestones (Finance-owned + PM FTTT may revise)
  async getTimeline(id: string) {
    await this.ensureProjectExists(id);
    const baseline = await this.prisma.ftttMilestone.findMany({
      where: { financeProjectId: id, kind: 'BASELINE' },
      orderBy: { targetDate: 'asc' },
    });
    const current = await this.prisma.ftttMilestone.findMany({
      where: { financeProjectId: id, kind: 'CURRENT' },
      orderBy: { targetDate: 'asc' },
    });
    const hasBaseline = baseline.length > 0;
    const same = (a: typeof baseline, b: typeof current) =>
      a.length === b.length &&
      a.every((x, i) =>
        x.targetDate.getTime() === b[i].targetDate.getTime() &&
        Number(x.plannedBudget) === Number(b[i].plannedBudget) &&
        Number(x.plannedProgressPct) === Number(b[i].plannedProgressPct),
      );
    // v2 dual-write left identical CURRENT; treat as no revision until Edit Planning changes it
    const hasRevision = hasBaseline && current.length > 0 && !same(baseline, current);
    const milestones = hasRevision ? current : baseline;
    return { milestones, hasBaseline, hasRevision };
  }

  async setTimeline(id: string, dto: SetTimelineInput) {
    await this.ensureProjectExists(id);
    const rows = dto.milestones
      .filter((m) => m.targetDate)
      .map((m) => ({
        financeProjectId: id,
        targetDate: new Date(m.targetDate),
        plannedBudget: new Prisma.Decimal(m.plannedBudget),
        plannedProgressPct: new Prisma.Decimal(m.plannedProgressPct),
      }));

    const existingBaseline = await this.prisma.ftttMilestone.count({
      where: { financeProjectId: id, kind: 'BASELINE' },
    });

    await this.prisma.$transaction(async (tx) => {
      if (existingBaseline === 0) {
        // Set Plan Awal — immutable baseline only (no Perubahan Planning yet)
        await tx.ftttMilestone.deleteMany({ where: { financeProjectId: id } });
        if (rows.length) {
          await tx.ftttMilestone.createMany({
            data: rows.map((r) => ({ ...r, kind: 'BASELINE' })),
          });
        }
      } else {
        // Edit Planning — replace CURRENT only; BASELINE stays
        await tx.ftttMilestone.deleteMany({ where: { financeProjectId: id, kind: 'CURRENT' } });
        if (rows.length) {
          await tx.ftttMilestone.createMany({
            data: rows.map((r) => ({ ...r, kind: 'CURRENT' })),
          });
        }
      }
      // Keep project endDate at least as far as the latest planning milestone (Kurva S horizon)
      if (rows.length) {
        const lastMilestone = rows.reduce((a, b) => (a.targetDate > b.targetDate ? a : b));
        const fp = await tx.financeProject.findUnique({ where: { id }, select: { endDate: true } });
        if (!fp?.endDate || lastMilestone.targetDate > fp.endDate) {
          await tx.financeProject.update({
            where: { id },
            data: { endDate: lastMilestone.targetDate },
          });
        }
      }
    });
    return this.getTimeline(id);
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

  // JLM: agregasi realisasi Transaction Log FTTT per project & kategori,
  // sumber data yang sama dengan endpoint monitoring pada halaman Detail
  private async getFtttSpentMap(financeProjectIds: string[]): Promise<FtttSpentMap> {
    const map: FtttSpentMap = new Map();
    if (financeProjectIds.length === 0) return map;
    const rows = await this.prisma.ftttTransaction.groupBy({
      by: ['financeProjectId', 'category'],
      where: {
        financeProjectId: { in: financeProjectIds },
        disbursedAt: { not: null },
      },
      _sum: { total: true },
    });
    for (const r of rows) {
      if (!r.financeProjectId) continue;
      const entry = map.get(r.financeProjectId) ?? { perizinan: 0, material: 0, jasa: 0, lainLain: 0 };
      const val = Number(r._sum.total ?? 0);
      if (r.category === 'PERIZINAN') entry.perizinan += val;
      else if (r.category === 'MATERIAL') entry.material += val;
      else if (r.category === 'JASA') entry.jasa += val;
      else entry.lainLain += val;
      map.set(r.financeProjectId, entry);
    }
    return map;
  }

  private hydrateListItem(p: FinanceProject, ftttSpent?: FtttSpentMap): FinanceProjectListItem {
    const materialRemaining = this.ledgerService.getMaterialRemaining(p).toNumber();
    const jasaRemaining = this.ledgerService.getJasaRemaining(p).toNumber();

    if ((p as { projectType?: string }).projectType === 'FTTT' && ftttSpent) {
      const s = ftttSpent.get(p.id) ?? { perizinan: 0, material: 0, jasa: 0, lainLain: 0 };
      const totalSpent = s.perizinan + s.material + s.jasa + s.lainLain;
      const totalBudget = Number(p.totalBudget);
      return {
        ...p,
        // realisasi per kategori mengikuti Transaction Log (bukan field FTTH materialSpent/jasaSpent)
        materialSpent: new Prisma.Decimal(s.material),
        jasaSpent: new Prisma.Decimal(s.jasa),
        perizinanSpent: s.perizinan,
        lainLainSpent: s.lainLain,
        totalSpent,
        totalRemaining: totalBudget - totalSpent,
        materialRemaining: Number(p.materialBudget ?? 0) - s.material,
        jasaRemaining: Number(p.jasaBudget ?? 0) - s.jasa,
      };
    }

    const totalSpent = Number(p.materialSpent) + Number(p.jasaSpent);
    return {
      ...p,
      materialRemaining,
      jasaRemaining,
      totalSpent,
      totalRemaining: materialRemaining + jasaRemaining,
      perizinanSpent: 0,
      lainLainSpent: 0,
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
    return this.nextAutoCode(tx, year, 'FIN');
  }

  private async nextAutoCode(tx: Prisma.TransactionClient, year: number, prefixKind: string): Promise<string> {
    const prefix = `${prefixKind}-${year}-`;
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

  /** Integra V1: Excel template for Set Plan Awal */
  async buildPlanTemplateBuffer(): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs') as typeof import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Set Plan Awal');
    ws.columns = [
      { header: 'Target Tanggal', key: 'targetDate', width: 18 },
      { header: 'Planned Budget', key: 'plannedBudget', width: 18 },
      { header: 'Progress (%)', key: 'progress', width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow({ targetDate: 'dd/mm/yyyy', plannedBudget: '50000000', progress: 10 });
    ws.addRow({ targetDate: 'dd/mm/yyyy', plannedBudget: '100000000', progress: 25 });
    ws.addRow({ targetDate: 'dd/mm/yyyy', plannedBudget: '150000000', progress: 45 });
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async importPlanFromExcel(id: string, file: Express.Multer.File): Promise<{ milestones: unknown; hasBaseline: boolean; hasRevision: boolean }> {
    await this.ensureProjectExists(id);
    if (!file?.buffer?.length) {
      throw new BadRequestException('File Excel wajib diunggah');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs') as typeof import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) {
      throw new BadRequestException(
        'Upload gagal. Format file tidak sesuai dengan template Set Plan Awal. Silakan gunakan template yang telah disediakan.',
      );
    }
    const header = (ws.getRow(1).values as unknown[])
      .slice(1)
      .map((v) => String(v ?? '').trim().toLowerCase());
    const expected = ['target tanggal', 'planned budget', 'progress (%)'];
    if (header.length < 3 || expected.some((h, i) => header[i] !== h)) {
      throw new BadRequestException(
        'Upload gagal. Format file tidak sesuai dengan template Set Plan Awal. Silakan gunakan template yang telah disediakan.',
      );
    }

    const milestones: Array<{ targetDate: string; plannedBudget: number; plannedProgressPct: number }> = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dateRaw = row.getCell(1).value;
      const budgetRaw = row.getCell(2).value;
      const progressRaw = row.getCell(3).value;
      if (dateRaw == null && budgetRaw == null && progressRaw == null) return;
      const dateStr = this.parseExcelDate(dateRaw);
      if (!dateStr) {
        throw new BadRequestException(
          'Upload gagal. Format file tidak sesuai dengan template Set Plan Awal. Silakan gunakan template yang telah disediakan.',
        );
      }
      const budget = Number(String(budgetRaw ?? '').toString().replace(/\./g, '').replace(/,/g, ''));
      const progress = Number(progressRaw);
      if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(progress) || progress < 0 || progress > 100) {
        throw new BadRequestException(
          'Upload gagal. Format file tidak sesuai dengan template Set Plan Awal. Silakan gunakan template yang telah disediakan.',
        );
      }
      // skip placeholder example rows
      if (String(dateRaw).toLowerCase().includes('dd/mm')) return;
      milestones.push({ targetDate: dateStr, plannedBudget: budget, plannedProgressPct: progress });
    });

    if (milestones.length === 0) {
      throw new BadRequestException(
        'Upload gagal. Format file tidak sesuai dengan template Set Plan Awal. Silakan gunakan template yang telah disediakan.',
      );
    }

    return this.setTimeline(id, { milestones });
  }

  private parseExcelDate(raw: unknown): string | null {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return raw.toISOString();
    }
    if (typeof raw === 'number') {
      // Excel serial date
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + raw * 86400000);
      return d.toISOString();
    }
    const s = String(raw ?? '').trim();
    if (!s || s.toLowerCase().includes('dd/mm')) return null;
    // dd/mm/yyyy
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d2 = new Date(s);
    return Number.isNaN(d2.getTime()) ? null : d2.toISOString();
  }
}
