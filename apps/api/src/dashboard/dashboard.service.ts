import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  FiberType,
  FtttHierarchyLevel,
  OrderStatus,
  PermitPhase,
  Prisma,
  PurchaseRequestStatus,
} from '@prisma/client'; // FIX: FiberType for PM/designer-scoped queries

// NEW: Integra V1 — GM dashboard project-kind filter
export type ProjectKind = 'ALL' | 'FTTH' | 'FTTT';

// NEW: threshold shared by overdue / attention checks below (kept consistent with SLA_DAYS elsewhere)
const STALE_DAYS = 14;
const NO_ACTIVITY_DAYS = 7;
const BUDGET_ATTENTION_UTIL = 0.9;

const PHASES: PermitPhase[] = [
  'CLUSTER_INTAKE',
  'VISIT_REQUEST',
  'BA_OPEN',
  'SITE_VISIT',
  'SURVEY_INPUT',
  'ROUTE_SURVEY',
  'BA_SURVEY',
  'SIP_REQUEST',
  'HLD_SUBMISSION',
  'LLD_SUBMISSION',
  'PR_BR_ISSUANCE',
  'CONTRACT_MANAGEMENT',
  'SKOM_BUDGET',
  'MANAGEMENT_APPROVAL',
  'FUND_DISBURSEMENT',
  'BAK_GENERATION',
  'BAKP_COMPILATION',
  'CLAIM_SUBMISSION',
  'INVOICE_PACKAGE',
  'PERMIT_DONE',
];

// FIX Fix 2A: human-readable phase labels — no more underscored enum values in the UI
const PHASE_LABELS: Record<string, string> = {
  CLUSTER_INTAKE:      'Intake Cluster',
  VISIT_REQUEST:       'Visit Request',
  BA_OPEN:             'BA Open',
  SITE_VISIT:          'Kunjungan Lapangan',
  SURVEY_INPUT:        'Input Data Survey',
  ROUTE_SURVEY:        'Route Survey',
  BA_SURVEY:           'BA Survey',
  SIP_REQUEST:         'Pengajuan SIP',
  HLD_SUBMISSION:      'Upload HLD',
  LLD_SUBMISSION:      'Upload LLD',
  PR_BR_ISSUANCE:      'PR/BR dari ISP',
  CONTRACT_MANAGEMENT: 'Manajemen Kontrak',
  SKOM_BUDGET:         'Budget SKOM',
  MANAGEMENT_APPROVAL: 'Approval Management',
  FUND_DISBURSEMENT:   'Pencairan Dana',
  BAK_GENERATION:      'Pembuatan BAK',
  BAKP_COMPILATION:    'Kompilasi BAKP',
  CLAIM_SUBMISSION:    'Pengajuan Klaim',
  INVOICE_PACKAGE:     'Invoice ke Finance',
  PERMIT_DONE:         'Permit Selesai',
};

// FIX Fix 2A: human-readable role labels for "oleh Pak Budi (Surveyor FTTH)"-style descriptions
const ROLE_LABELS: Record<string, string> = {
  GENERAL_MANAGER:    'General Manager',
  PM_SENIOR:          'Senior PM',
  PM_FTTH:            'PM FTTH',
  PM_FTTB:            'PM FTTB',
  PM_FTTT:            'PM FTTT',
  SURVEYOR_FTTH:      'Surveyor FTTH',
  SURVEYOR_FTTB:      'Surveyor FTTB',
  SURVEYOR_FTTT:      'Surveyor FTTT',
  DESIGNER:           'Design Team',
  ADMIN:              'Admin',
  ADMIN_STOCK:        'Admin Stok',
  FINANCE:            'Finance',
  MARKETING:          'Marketing',
  MARKETING_HEAD:     'Kepala Marketing',
  OPERATIONAL_MANAGER:'Operational Manager',
};

// NEW: GM / PM Senior aggregated dashboard
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getGmDashboard() {
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      usersTotal,
      usersActive,
      usersInactive,
      usersByRole,
      permitTotal,
      permitByPhase,
      permitFiberPhase,
      completedThisMonth,
      completedPrevMonth,
      permitOnHold,
      permitReady,
      cleanStats,
      vrTotal,
      vrPending,
      vrApproved,
      vrRejected,
      vrThisMonth,
      stockItems,
      orderTotal,
      orderPending,
      orderFulfilled,
      orderThisMonth,
      prTotal,
      prPendingFinance,
      prApprovedThisMonth,
      recentActivity,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: false } }),
      this.prisma.user.groupBy({ by: ['role'], _count: { id: true } }),
      this.prisma.permitCluster.count(),
      this.prisma.permitCluster.groupBy({ by: ['currentPhase'], _count: { id: true } }),
      this.prisma.permitCluster.groupBy({
        by: ['fiberType', 'currentPhase'],
        _count: { id: true },
      }),
      this.prisma.permitCluster.count({
        where: { status: 'COMPLETED', readyForConstructionAt: { gte: startMonth } },
      }),
      this.prisma.permitCluster.count({
        where: {
          status: 'COMPLETED',
          readyForConstructionAt: { gte: startPrevMonth, lte: endPrevMonth },
        },
      }),
      this.prisma.permitCluster.count({ where: { status: 'ON_HOLD' } }),
      this.prisma.permitCluster.count({
        where: { currentPhase: 'PERMIT_DONE', status: 'COMPLETED' },
      }),
      this.prisma.cleanList.groupBy({ by: ['status'], _count: { id: true } }),
      this.prisma.visitRequest.count(),
      this.prisma.visitRequest.count({
        where: {
          status: {
            in: [
              'PM_REVIEW_VISIT',
              'APPROVED_PENDING_DATA',
              'PM_REVIEW_SURVEY',
              'PM_SENIOR_REVIEW',
              'ADMIN_REVIEW',
            ],
          },
        },
      }),
      this.prisma.visitRequest.count({ where: { status: 'APPROVED' } }),
      this.prisma.visitRequest.count({ where: { status: 'REJECTED' } }),
      this.prisma.visitRequest.count({ where: { createdAt: { gte: startMonth } } }),
      this.prisma.stockItem.count({ where: { isActive: true } }),
      this.prisma.order.count(),
      this.prisma.order.count({
        where: { status: { in: ['DRAFT', 'SUBMITTED', 'STOCK_AVAILABLE', 'PARTIAL_STOCK', 'NO_STOCK'] } },
      }),
      this.prisma.order.count({ where: { status: 'FULFILLED' } }),
      this.prisma.order.count({ where: { createdAt: { gte: startMonth } } }),
      this.prisma.purchaseRequest.count(),
      this.prisma.purchaseRequest.count({
        where: { status: { in: [PurchaseRequestStatus.PENDING, PurchaseRequestStatus.IN_REVIEW] } },
      }),
      this.prisma.purchaseRequest.count({
        where: { status: PurchaseRequestStatus.APPROVED, approvedAt: { gte: startMonth } },
      }),
      this.auditLog.findRecent(15),
    ]);

    const [slaRows, lowStockAgg] = await Promise.all([
      this.prisma.$queryRaw<{ avg_days: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("readyForConstructionAt" - "createdAt")) / 86400.0)::float AS avg_days
        FROM "PermitCluster"
        WHERE status = 'COMPLETED'
          AND "readyForConstructionAt" IS NOT NULL
          AND "createdAt" >= NOW() - INTERVAL '12 months'
      `,
      this.prisma.$queryRaw<{ low_n: bigint; out_n: bigint }[]>`
        SELECT
          COUNT(*) FILTER (WHERE "currentQty" <= "minStockQty")::bigint AS low_n,
          COUNT(*) FILTER (WHERE "currentQty" = 0)::bigint AS out_n
        FROM "StockItem"
        WHERE "isActive" = true
      `,
    ]);

    let avgDaysToComplete = 0;
    const rawAvg = slaRows[0]?.avg_days;
    if (rawAvg != null && !Number.isNaN(Number(rawAvg))) {
      avgDaysToComplete = Math.round(Number(rawAvg) * 10) / 10;
    }

    const lowN = Number(lowStockAgg[0]?.low_n ?? 0);
    const outN = Number(lowStockAgg[0]?.out_n ?? 0);

    const cleanMap = Object.fromEntries(cleanStats.map((c) => [c.status, c._count.id]));

    const phaseMap = Object.fromEntries(permitByPhase.map((p) => [p.currentPhase, p._count.id]));

    const stacksByFiber: Record<string, { phase: PermitPhase; count: number }[]> = {
      FTTH: [],
      FTTB: [],
      FTTT: [],
    };
    for (const row of permitFiberPhase) {
      const ft = row.fiberType as string;
      if (!stacksByFiber[ft]) stacksByFiber[ft] = [];
      stacksByFiber[ft].push({ phase: row.currentPhase, count: row._count.id });
    }

    const trend = (cur: number, prev: number) => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 1000) / 10;
    };

    return {
      users: {
        total: usersTotal,
        active: usersActive,
        inactive: usersInactive,
        byRole: usersByRole.map((r) => ({ role: r.role, count: r._count.id })),
      },
      permitPipeline: {
        total: permitTotal,
        byPhase: PHASES.map((phase) => ({ phase, count: phaseMap[phase] ?? 0 })),
        completedThisMonth,
        completedPrevMonth,
        trendCompletedPct: trend(completedThisMonth, completedPrevMonth),
        avgDaysToComplete,
        onHold: permitOnHold,
        constructionReady: permitReady,
        stacksByFiber,
      },
      cleanList: {
        total: cleanStats.reduce((a, c) => a + c._count.id, 0),
        available: cleanMap['AVAILABLE'] ?? 0,
        inProgress: cleanMap['IN_PROGRESS'] ?? 0,
        hasExistingFiber: cleanMap['HAS_EXISTING_FIBER'] ?? 0,
        completed: cleanMap['COMPLETED'] ?? 0,
      },
      visitRequests: {
        total: vrTotal,
        pending: vrPending,
        approved: vrApproved,
        rejected: vrRejected,
        thisMonth: vrThisMonth,
      },
      stock: {
        totalItems: stockItems,
        lowStockCount: lowN,
        outOfStockCount: outN,
      },
      orders: {
        total: orderTotal,
        pending: orderPending,
        fulfilled: orderFulfilled,
        thisMonth: orderThisMonth,
      },
      purchaseRequests: {
        total: prTotal,
        pendingFinance: prPendingFinance,
        approvedThisMonth: prApprovedThisMonth,
      },
      recentActivity,
    };
  }

  // FIX Fix 2A: new dedicated GM stats endpoint — returns clean, human-readable numbers for the refreshed dashboard
  // NEW: Integra V1 — accepts projectKind filter (ALL | FTTH | FTTT) for the project/budget widgets below
  async getGmStats(projectKind: ProjectKind = 'ALL') {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); // FIX Fix 2A: month boundary for "selesai bulan ini"
    const startOfYear  = new Date(now.getFullYear(), 0, 1); // FIX Fix 2A: year boundary for YTD progress tile

    const [
      totalClusters,
      activeClusters,
      completedThisMonth,
      completedThisYear,
      byPhase,
      byFiberType,
      totalUsers,
      activeUsers,
      pendingVR,
      recentClusters,
      cashOpPending,
      slaBreached,
    ] = await Promise.all([
      this.prisma.permitCluster.count(), // FIX Fix 2A: total permit clusters ever created
      this.prisma.permitCluster.count({ where: { status: { not: 'COMPLETED' } } }), // FIX Fix 2A: in-flight clusters
      this.prisma.permitCluster.count({ // FIX Fix 2A: completed this month (by readyForConstructionAt)
        where: { status: 'COMPLETED', readyForConstructionAt: { gte: startOfMonth } },
      }),
      this.prisma.permitCluster.count({ // FIX Fix 2A: completed this year
        where: { status: 'COMPLETED', readyForConstructionAt: { gte: startOfYear } },
      }),
      this.prisma.permitCluster.groupBy({ // FIX Fix 2A: phase distribution for active clusters only
        by: ['currentPhase'],
        _count: { id: true },
        where: { status: { not: 'COMPLETED' } },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.permitCluster.groupBy({ // FIX Fix 2A: fiber type distribution across the whole pipeline
        by: ['fiberType'],
        _count: { id: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.visitRequest.count({ // FIX Fix 2A: pending visit-request count (PM/Admin queue)
        where: {
          status: {
            in: [
              'PM_REVIEW_VISIT',
              'PM_REVIEW_SURVEY',
              'PM_SENIOR_REVIEW',
              'ADMIN_REVIEW',
            ],
          },
        },
      }),
      this.prisma.permitCluster.findMany({ // FIX Fix 2A: recent activity sourced from cluster updates (cluster-centric, not audit log)
        take: 10,
        orderBy: { updatedAt: 'desc' },
        include: {
          visitRequest: {
            include: {
              requester: { select: { name: true, role: true } },
              cleanList: { select: { siteName: true, rwCode: true, fiberType: true } },
            },
          },
        },
      }),
      this.prisma.cashOperationRequest.count({ // FIX Fix 2A: pending cash operations (schema uses CashOperationRequest + CashOpStatus)
        where: { status: { in: ['SUBMITTED', 'IN_REVIEW'] } },
      }),
      this.prisma.hld.count({ // FIX Fix 2A: HLDs past SLA deadline (excluding approved and drafts)
        where: {
          slaDeadline: { lt: now },
          status: { notIn: ['ISP_APPROVED', 'DRAFT'] },
        },
      }),
    ]);

    // FIX Fix 2A: add label to each phase row so the frontend never needs to humanize enums itself
    const byPhaseFormatted = byPhase.map((p) => ({
      phase: p.currentPhase as string,
      label: PHASE_LABELS[p.currentPhase] || String(p.currentPhase).replace(/_/g, ' '),
      count: p._count.id,
    }));

    // FIX Fix 2A: format each recent activity row as a clean, cluster-centric human-readable entry
    const recentActivityFormatted = recentClusters.map((cluster) => {
      const surveyor  = cluster.visitRequest?.requester;
      const cleanList = cluster.visitRequest?.cleanList;
      const surveyorName = surveyor?.name || 'Surveyor';
      const surveyorRole = ROLE_LABELS[surveyor?.role || ''] || surveyor?.role || '';
      const clusterName = cleanList?.siteName || cleanList?.rwCode || cluster.clusterCode;
      const phase       = PHASE_LABELS[cluster.currentPhase] || String(cluster.currentPhase).replace(/_/g, ' ');
      const fiberType   = cleanList?.fiberType || cluster.fiberType || '';

      return {
        id:                cluster.id,
        clusterCode:       cluster.clusterCode,
        clusterName,
        fiberType,
        currentPhase:      cluster.currentPhase,
        currentPhaseLabel: phase,
        status:            cluster.status,
        surveyorName,
        surveyorRole,
        updatedAt:         cluster.updatedAt,
        description:       `${clusterName} (${fiberType}) — fase ${phase}`, // FIX Fix 2A: UI can show this directly, no enum fallback needed
        actor:             surveyorName ? `oleh ${surveyorName}` : '',
      };
    });

    // NEW: Integra V1 — project/budget widgets, filterable by projectKind
    // NEW: Integra Enhancement V3 — financial extras (over-budget/profit/loss/sites/segments),
    // FTTH vs FTTT distribution, and Daily Activity feed for the Executive Dashboard
    const [
      projectSummary,
      budgetSummary,
      onProgressProjects,
      attentionProjects,
      statusDistribution,
      financialExtras,
      ftthVsFttt,
      dailyActivityExtras,
      pendingPoApprovals,
    ] =
      await Promise.all([
        this.buildProjectSummary(projectKind),
        this.buildBudgetSummary(projectKind),
        this.buildOnProgressProjects(projectKind),
        this.buildAttentionProjects(projectKind),
        this.buildStatusDistribution(projectKind),
        this.buildFinancialExtras(projectKind),
        this.buildFtthVsFttt(),
        this.buildDailyActivityRecent(),
        this.prisma.financePoChangeRequest.count({ where: { status: 'PENDING' } }),
      ]);

    // NEW: Integra Enhancement V3 — GM-facing quick insights, computed server-side from the stats above
    const noActivityCount = attentionProjects.filter((p) => p.reasons.includes('no_recent_activity')).length;
    const quickInsights: string[] = [];
    if (slaBreached > 0) {
      quickInsights.push(`${slaBreached} cluster melewati SLA HLD — perlu tindakan segera.`);
    }
    if (financialExtras.overBudgetCount > 0) {
      quickInsights.push(`${financialExtras.overBudgetCount} proyek melebihi budget yang direncanakan.`);
    }
    if (financialExtras.lossCount > 0) {
      quickInsights.push(`${financialExtras.lossCount} proyek berpotensi rugi (actual cost > PO Customer).`);
    }
    if (noActivityCount > 0) {
      quickInsights.push(`${noActivityCount} proyek FTTT tidak ada aktivitas dalam ${NO_ACTIVITY_DAYS} hari terakhir.`);
    }
    if (dailyActivityExtras.overdueCount > 0) {
      quickInsights.push(`${dailyActivityExtras.overdueCount} daily activity melewati target selesai.`);
    }
    if (cashOpPending > 0) {
      quickInsights.push(`${cashOpPending} pengajuan cash operation menunggu approval.`);
    }
    if (pendingPoApprovals > 0) {
      quickInsights.push(`${pendingPoApprovals} pengajuan PO Customer menunggu approval GM.`);
    }
    if (quickInsights.length === 0) {
      quickInsights.push('Semua indikator utama dalam kondisi baik — tidak ada isu mendesak saat ini.');
    }

    return {
      summary: {
        totalClusters,
        activeClusters,
        completedThisMonth,
        completedThisYear,
        totalUsers,
        activeUsers,
        pendingVisitRequests:  pendingVR,
        pendingCashOperations: cashOpPending,
        slaBreached,
        // NEW: Integra Enhancement V3 — additional executive KPI fields
        onHold: projectSummary.pending, // FIX: buildProjectSummary's "pending" bucket == ON_HOLD status
        cancelled: projectSummary.cancelled,
        pendingApprovals: pendingVR + pendingPoApprovals,
      },
      pipeline: {
        byPhase: byPhaseFormatted,
        byFiberType: byFiberType.map((f) => ({
          fiberType: f.fiberType as string,
          count:     f._count.id,
        })),
      },
      recentActivity: recentActivityFormatted,
      projectKind,
      projectSummary,
      budgetSummary,
      onProgressProjects,
      attentionProjects,
      statusDistribution,
      // NEW: Integra Enhancement V3 — Executive Dashboard additions
      totalSites: financialExtras.totalSites,
      totalSegments: financialExtras.totalSegments,
      overBudgetCount: financialExtras.overBudgetCount,
      profitCount: financialExtras.profitCount,
      lossCount: financialExtras.lossCount,
      ftthVsFttt,
      dailyActivityRecent: dailyActivityExtras.items,
      dailyActivityOverdueCount: dailyActivityExtras.overdueCount,
      quickInsights,
    };
  }

  /** NEW: resolve which FtttProject hierarchy level represents "one project" for KPI counting —
   * prefer BULKY (parent) rows; fall back to SITE when no Bulky rows exist yet. */
  private async resolveFtttHierarchyLevel(): Promise<FtttHierarchyLevel> {
    const bulkyCount = await this.prisma.ftttProject.count({ where: { hierarchyLevel: 'BULKY' } });
    return bulkyCount > 0 ? FtttHierarchyLevel.BULKY : FtttHierarchyLevel.SITE;
  }

  /** NEW: projectSummary — { total, onGoing, completed, pending, overdue, cancelled } per projectKind */
  private async buildProjectSummary(kind: ProjectKind) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

    const empty = { total: 0, onGoing: 0, completed: 0, pending: 0, overdue: 0, cancelled: 0 };
    let ftth = { ...empty };
    let fttt = { ...empty };

    if (kind !== 'FTTT') {
      const [total, onGoing, completed, pending, overdue, cancelled] = await Promise.all([
        this.prisma.permitCluster.count({ where: { fiberType: FiberType.FTTH } }),
        this.prisma.permitCluster.count({ where: { fiberType: FiberType.FTTH, status: 'IN_PROGRESS' } }),
        this.prisma.permitCluster.count({ where: { fiberType: FiberType.FTTH, status: 'COMPLETED' } }),
        this.prisma.permitCluster.count({ where: { fiberType: FiberType.FTTH, status: 'ON_HOLD' } }),
        this.prisma.permitCluster.count({
          where: {
            fiberType: FiberType.FTTH,
            status: { in: ['IN_PROGRESS', 'ON_HOLD'] },
            updatedAt: { lt: staleBefore },
          },
        }),
        this.prisma.permitCluster.count({ where: { fiberType: FiberType.FTTH, status: 'CANCELLED' } }), // NEW: Integra V3
      ]);
      ftth = { total, onGoing, completed, pending, overdue, cancelled };
    }

    if (kind !== 'FTTH') {
      const hierarchyLevel = await this.resolveFtttHierarchyLevel();
      const [total, onGoing, completed, pending, overdue, cancelled] = await Promise.all([
        this.prisma.ftttProject.count({ where: { hierarchyLevel } }),
        this.prisma.ftttProject.count({ where: { hierarchyLevel, status: 'ACTIVE' } }),
        this.prisma.ftttProject.count({ where: { hierarchyLevel, status: 'COMPLETED' } }),
        this.prisma.ftttProject.count({ where: { hierarchyLevel, status: 'ON_HOLD' } }),
        this.prisma.ftttProject.count({
          where: { hierarchyLevel, status: 'ACTIVE', updatedAt: { lt: staleBefore } },
        }),
        this.prisma.ftttProject.count({ where: { hierarchyLevel, status: 'CANCELLED' } }), // NEW: Integra V3
      ]);
      fttt = { total, onGoing, completed, pending, overdue, cancelled };
    }

    if (kind === 'FTTH') return ftth;
    if (kind === 'FTTT') return fttt;
    return {
      total: ftth.total + fttt.total,
      onGoing: ftth.onGoing + fttt.onGoing,
      completed: ftth.completed + fttt.completed,
      pending: ftth.pending + fttt.pending,
      overdue: ftth.overdue + fttt.overdue,
      cancelled: ftth.cancelled + fttt.cancelled,
    };
  }

  /** NEW: Integra Enhancement V3 — over-budget / profit / loss project counts + site/segment counts,
   * derived from FinanceProject rows (SEGMENT rollup rows excluded from over-budget/profit/loss to avoid
   * double-counting against their SITE children). */
  private async buildFinancialExtras(kind: ProjectKind) {
    const where: Prisma.FinanceProjectWhereInput = {
      status: 'ACTIVE',
      isDefaultUncategorized: false,
      ...(kind !== 'ALL' ? { projectType: kind } : {}),
    };

    const projects = await this.prisma.financeProject.findMany({
      where,
      select: {
        id: true,
        hierarchyLevel: true,
        totalBudget: true,
        materialSpent: true,
        jasaSpent: true,
        poCustomer: true,
      },
    });

    let disbursedByProject: Record<string, number> = {};
    if (kind !== 'FTTH' && projects.length > 0) {
      const disbursedRows = await this.prisma.ftttTransaction.groupBy({
        by: ['financeProjectId'],
        where: {
          financeProjectId: { in: projects.map((p) => p.id) },
          disbursedAt: { not: null },
        },
        _sum: { total: true },
      });
      disbursedByProject = Object.fromEntries(
        disbursedRows
          .filter((r) => r.financeProjectId)
          .map((r) => [r.financeProjectId as string, Number(r._sum.total ?? 0)]),
      );
    }

    let overBudgetCount = 0;
    let profitCount = 0;
    let lossCount = 0;
    let totalSites = 0;
    let totalSegments = 0;

    for (const p of projects) {
      if (p.hierarchyLevel === 'SITE') totalSites += 1;
      if (p.hierarchyLevel === 'SEGMENT') totalSegments += 1;
      if (p.hierarchyLevel === 'SEGMENT') continue; // FIX: rollup-only row — skip to avoid double-counting vs. SITE children

      const spent = Number(p.materialSpent) + Number(p.jasaSpent) + (disbursedByProject[p.id] ?? 0);
      const totalBudget = Number(p.totalBudget);
      if (totalBudget > 0 && spent > totalBudget) overBudgetCount += 1;

      if (p.poCustomer != null) {
        const profit = Number(p.poCustomer) - spent;
        if (profit > 0) profitCount += 1;
        else if (profit < 0) lossCount += 1;
      }
    }

    return { overBudgetCount, profitCount, lossCount, totalSites, totalSegments };
  }

  /** NEW: Integra Enhancement V3 — total FTTH clusters vs. FTTT (top-level) projects, unfiltered by projectKind
   * so the GM can always compare the two portfolios side by side. */
  private async buildFtthVsFttt() {
    const hierarchyLevel = await this.resolveFtttHierarchyLevel();
    const [ftth, fttt] = await Promise.all([
      this.prisma.permitCluster.count(),
      this.prisma.ftttProject.count({ where: { hierarchyLevel } }),
    ]);
    return { ftth, fttt };
  }

  /** NEW: Integra Enhancement V3 — most recent Daily Activity entries (all projects) + count of entries
   * past their target completion date, for the Executive Dashboard's Recent Activity / Pipeline widgets. */
  private async buildDailyActivityRecent() {
    const now = new Date();
    const [recent, overdueCount] = await Promise.all([
      this.prisma.dailyActivity.findMany({
        take: 8,
        orderBy: { timestamp: 'desc' },
        include: {
          actor: { select: { name: true } },
          ftttProject: { select: { projectName: true } },
          financeProject: { select: { name: true } },
        },
      }),
      this.prisma.dailyActivity.count({
        where: { workStatus: { not: 'DONE' }, targetDoneAt: { lt: now } },
      }),
    ]);

    const items = recent.map((a) => ({
      id: a.id,
      siteName: a.siteName || a.ftttProject?.projectName || a.financeProject?.name || '—',
      scopeOfWork: a.scopeOfWork,
      workStatus: a.workStatus as string,
      actorName: a.actor?.name || '',
      timestamp: a.timestamp,
      targetDoneAt: a.targetDoneAt,
      overdue: a.workStatus !== 'DONE' && !!a.targetDoneAt && a.targetDoneAt < now,
    }));

    return { items, overdueCount };
  }

  /** NEW: budgetSummary — FinanceProject (ACTIVE, not default-uncategorized) scoped by projectKind */
  private async buildBudgetSummary(kind: ProjectKind) {
    const where: Prisma.FinanceProjectWhereInput = {
      status: 'ACTIVE',
      isDefaultUncategorized: false,
      ...(kind !== 'ALL' ? { projectType: kind } : {}),
    };

    const [agg, scopedProjects] = await Promise.all([
      this.prisma.financeProject.aggregate({
        where,
        _sum: { totalBudget: true, materialSpent: true, jasaSpent: true },
      }),
      this.prisma.financeProject.findMany({ where, select: { id: true } }),
    ]);

    const totalBudget = Number(agg._sum.totalBudget ?? 0);
    let spent = Number(agg._sum.materialSpent ?? 0) + Number(agg._sum.jasaSpent ?? 0);

    // NEW: fold in disbursed FTTT implementation transactions for the scoped finance projects
    if (kind !== 'FTTH' && scopedProjects.length > 0) {
      const disbursedAgg = await this.prisma.ftttTransaction.aggregate({
        where: {
          financeProjectId: { in: scopedProjects.map((p) => p.id) },
          disbursedAt: { not: null },
        },
        _sum: { total: true },
      });
      spent += Number(disbursedAgg._sum.total ?? 0);
    }

    const remaining = totalBudget - spent;
    const utilizationPct = totalBudget > 0 ? Math.round((spent / totalBudget) * 1000) / 10 : 0;

    return { totalBudget, spent, remaining, utilizationPct };
  }

  /** NEW: onProgressProjects — top 20 active projects across FTTH/FTTT, most recently updated first */
  private async buildOnProgressProjects(kind: ProjectKind) {
    type Row = {
      id: string;
      name: string;
      kind: 'FTTH' | 'FTTT';
      status: string;
      progressPct: number;
      budgetRemaining: number | null;
      _updatedAt: Date;
    };
    const rows: Row[] = [];

    if (kind !== 'FTTT') {
      const clusters = await this.prisma.permitCluster.findMany({
        where: { fiberType: FiberType.FTTH, status: 'IN_PROGRESS' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: { visitRequest: { include: { cleanList: { select: { siteName: true, rwCode: true } } } } },
      });
      const phaseIdx = Object.fromEntries(PHASES.map((p, i) => [p, i]));
      for (const c of clusters) {
        const pct = Math.round(((phaseIdx[c.currentPhase] ?? 0) / (PHASES.length - 1)) * 1000) / 10;
        rows.push({
          id: c.id,
          name: c.visitRequest?.cleanList?.siteName || c.visitRequest?.cleanList?.rwCode || c.clusterCode,
          kind: 'FTTH',
          status: c.status,
          progressPct: pct,
          budgetRemaining: null, // FTTH clusters aren't linked 1:1 to a FinanceProject in the current schema
          _updatedAt: c.updatedAt,
        });
      }
    }

    if (kind !== 'FTTH') {
      const hierarchyLevel = await this.resolveFtttHierarchyLevel();
      const projects = await this.prisma.ftttProject.findMany({
        where: { hierarchyLevel, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: {
          phaseProgresses: true,
          financeProject: { select: { totalBudget: true, materialSpent: true, jasaSpent: true } },
        },
      });
      for (const p of projects) {
        const relevant = p.phaseProgresses.filter((pp) => pp.status !== 'SKIPPED');
        const done = relevant.filter((pp) => pp.status === 'COMPLETED').length;
        const pct = relevant.length > 0 ? Math.round((done / relevant.length) * 1000) / 10 : 0;
        const budgetRemaining = p.financeProject
          ? Number(p.financeProject.totalBudget) - Number(p.financeProject.materialSpent) - Number(p.financeProject.jasaSpent)
          : null;
        rows.push({
          id: p.id,
          name: p.projectName || p.id,
          kind: 'FTTT',
          status: p.status,
          progressPct: pct,
          budgetRemaining,
          _updatedAt: p.updatedAt,
        });
      }
    }

    return rows
      .sort((a, b) => b._updatedAt.getTime() - a._updatedAt.getTime())
      .slice(0, 20)
      .map(({ _updatedAt, ...row }) => row);
  }

  /** NEW: attentionProjects — budget util > 90% OR overdue (SLA-stale) OR no recent activity logged */
  private async buildAttentionProjects(kind: ProjectKind) {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const noActivityBefore = new Date(now.getTime() - NO_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    type Row = { id: string; name: string; kind: 'FTTH' | 'FTTT'; status: string; reasons: string[] };
    const rows: Row[] = [];

    if (kind !== 'FTTT') {
      const clusters = await this.prisma.permitCluster.findMany({
        where: {
          fiberType: FiberType.FTTH,
          status: { in: ['IN_PROGRESS', 'ON_HOLD'] },
          updatedAt: { lt: staleBefore },
        },
        orderBy: { updatedAt: 'asc' },
        take: 20,
        include: { visitRequest: { include: { cleanList: { select: { siteName: true, rwCode: true } } } } },
      });
      for (const c of clusters) {
        rows.push({
          id: c.id,
          name: c.visitRequest?.cleanList?.siteName || c.visitRequest?.cleanList?.rwCode || c.clusterCode,
          kind: 'FTTH',
          status: c.status,
          reasons: ['overdue'],
        });
      }
    }

    if (kind !== 'FTTH') {
      const hierarchyLevel = await this.resolveFtttHierarchyLevel();
      const projects = await this.prisma.ftttProject.findMany({
        where: { hierarchyLevel, status: 'ACTIVE' },
        include: {
          financeProject: { select: { totalBudget: true, materialSpent: true, jasaSpent: true } },
        },
      });

      for (const p of projects) {
        const reasons: string[] = [];

        if (p.updatedAt < staleBefore) reasons.push('overdue');

        if (p.financeProject) {
          const totalBudget = Number(p.financeProject.totalBudget);
          const spent = Number(p.financeProject.materialSpent) + Number(p.financeProject.jasaSpent);
          if (totalBudget > 0 && spent / totalBudget > BUDGET_ATTENTION_UTIL) reasons.push('budget_util_high');
        }

        const recentActivity = await this.prisma.dailyActivity.count({
          where: { ftttProjectId: p.id, timestamp: { gte: noActivityBefore } },
        });
        if (recentActivity === 0) reasons.push('no_recent_activity');

        if (reasons.length > 0) {
          rows.push({
            id: p.id,
            name: p.projectName || p.id,
            kind: 'FTTT',
            status: p.status,
            reasons,
          });
        }
      }
    }

    return rows.sort((a, b) => b.reasons.length - a.reasons.length).slice(0, 20);
  }

  /** NEW: statusDistribution — unified IN_PROGRESS / ON_HOLD / COMPLETED / CANCELLED counts across kinds */
  private async buildStatusDistribution(kind: ProjectKind) {
    const buckets: Record<string, number> = {
      IN_PROGRESS: 0,
      ON_HOLD: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };

    if (kind !== 'FTTT') {
      const grouped = await this.prisma.permitCluster.groupBy({
        by: ['status'],
        where: { fiberType: FiberType.FTTH },
        _count: { id: true },
      });
      for (const g of grouped) buckets[g.status] = (buckets[g.status] ?? 0) + g._count.id;
    }

    if (kind !== 'FTTH') {
      const hierarchyLevel = await this.resolveFtttHierarchyLevel();
      const grouped = await this.prisma.ftttProject.groupBy({
        by: ['status'],
        where: { hierarchyLevel },
        _count: { id: true },
      });
      // FtttProjectStatus uses ACTIVE where PermitClusterStatus uses IN_PROGRESS — unify labels
      const statusMap: Record<string, string> = { ACTIVE: 'IN_PROGRESS' };
      for (const g of grouped) {
        const label = statusMap[g.status] ?? g.status;
        buckets[label] = (buckets[label] ?? 0) + g._count.id;
      }
    }

    return Object.entries(buckets).map(([status, count]) => ({ status, count }));
  }

  async getSlaReport() {
    const rows = await this.prisma.permitCluster.findMany({
      select: { id: true, currentPhase: true, clusterCode: true, createdAt: true, updatedAt: true },
    });
    const now = Date.now();
    const SLA_DAYS = 14;
    const perPhase: Record<string, { total: number; within: number; sumDays: number }> = {};
    PHASES.forEach((p) => {
      perPhase[p] = { total: 0, within: 0, sumDays: 0 };
    });

    let longest: { clusterCode: string; days: number } | null = null;

    for (const r of rows) {
      const phase = r.currentPhase;
      if (!perPhase[phase]) continue;
      const days = (now - r.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      perPhase[phase].total += 1;
      perPhase[phase].sumDays += days;
      if (days <= SLA_DAYS) perPhase[phase].within += 1;
      if (!longest || days > longest.days) longest = { clusterCode: r.clusterCode, days: Math.round(days * 10) / 10 };
    }

    return {
      slaDaysTarget: SLA_DAYS,
      phases: PHASES.map((phase) => {
        const p = perPhase[phase];
        const avgDays = p.total ? Math.round((p.sumDays / p.total) * 10) / 10 : 0;
        const pct = p.total ? Math.round((p.within / p.total) * 1000) / 10 : 100;
        return { phase, clusterCount: p.total, avgDaysInPhase: avgDays, pctWithinSla: pct };
      }),
      longestStuck: longest,
    };
  }

  async getIspDashboard(ispCustomer: string) {
    const permitWhere = { ispCustomer: { equals: ispCustomer, mode: 'insensitive' as const } };
    const [total, byPhase, ready] = await Promise.all([
      this.prisma.permitCluster.count({ where: permitWhere }),
      this.prisma.permitCluster.groupBy({ by: ['currentPhase'], where: permitWhere, _count: { id: true } }),
      this.prisma.permitCluster.count({
        where: { ...permitWhere, status: 'COMPLETED' },
      }),
    ]);
    const bp = Object.fromEntries(byPhase.map((x) => [x.currentPhase, x._count.id]));
    return {
      ispCustomer,
      permitClusters: { total, ready, byPhase: PHASES.map((ph) => ({ phase: ph, count: bp[ph] ?? 0 })) },
      documentsHint: [] as { title: string; detail: string }[],
    };
  }

  async getPipelinePreview() {
    return this.prisma.permitCluster.findMany({
      take: 10,
      orderBy: { updatedAt: 'desc' },
      include: {
        assignedPm: { select: { id: true, name: true } },
      },
    });
  }

  async getPmDashboard(userId: string, userRole: string) {
    // FIX: scope by fiber type so KPIs match pipeline when assignedPmId is empty; PM_SENIOR sees all clusters
    const fiberKey: FiberType | null =
      userRole === 'PM_FTTH'
        ? FiberType.FTTH
        : userRole === 'PM_FTTB'
          ? FiberType.FTTB
          : userRole === 'PM_FTTT'
            ? FiberType.FTTT
            : null;
    const clusterFilter =
      userRole === 'PM_SENIOR' ? {} : fiberKey ? { fiberType: fiberKey } : { assignedPmId: userId }; // FIX: fiber-first
    const visitRequestFiberWhere =
      userRole === 'PM_SENIOR' ? {} : fiberKey ? { cleanList: { fiberType: fiberKey } } : {}; // FIX: VR scope

    const [
      totalClusters,
      myClusters,
      clustersByPhase,
      myOrders,
      pendingOrders,
      recentClusters,
      pendingVisitRequests,
      pendingDocPackages,
    ] = await Promise.all([
      this.prisma.permitCluster.count({ where: clusterFilter }), // FIX
      this.prisma.permitCluster.count({
        where: { ...clusterFilter, status: { not: 'COMPLETED' } },
      }), // FIX: active workload
      this.prisma.permitCluster.groupBy({
        by: ['currentPhase'],
        where: { ...clusterFilter, status: { not: 'COMPLETED' } },
        _count: { _all: true },
      }), // FIX: in-flight phases only
      this.prisma.order.count({ where: { createdBy: userId } }),
      this.prisma.order.count({
        where: { createdBy: userId, status: { in: ['SUBMITTED', 'NO_STOCK', 'PARTIAL_STOCK'] } },
      }),
      this.prisma.permitCluster.findMany({
        where: clusterFilter,
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: {
          visitRequest: {
            include: {
              cleanList: { select: { siteName: true, kotaKabupaten: true, rwCode: true } },
              requester: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.visitRequest.count({
        where: {
          status: { in: ['PM_REVIEW_VISIT', 'PM_REVIEW_SURVEY'] },
          ...visitRequestFiberWhere,
        },
      }), // FIX
      this.prisma.surveyorDocPackage.count({
        where: {
          status: 'PM_REVIEWING',
          permitCluster: clusterFilter as object,
        },
      }), // FIX
    ]);
    const pendingActions: Array<{ type: string; clusterId: string; clusterCode: string; daysWaiting: number; label: string; href: string }> = [];
    const apdPending = await this.prisma.apd.findMany({
      where: { status: 'DRAFT', permitCluster: { ...(clusterFilter as object) } }, // FIX: same cluster scope
      include: { permitCluster: { select: { id: true, clusterCode: true } } },
      take: 10,
    });
    apdPending.forEach((apd) => pendingActions.push({
      type: 'APD_DRAFT',
      clusterId: apd.permitCluster.id,
      clusterCode: apd.permitCluster.clusterCode,
      daysWaiting: Math.floor((Date.now() - apd.createdAt.getTime()) / 86400000),
      label: 'APD belum disubmit',
      href: `/permit-clusters/${apd.permitCluster.id}`,
    }));
    const abdPending = await this.prisma.abd.findMany({
      where: { status: 'DRAFT', apd: { permitCluster: { ...(clusterFilter as object) } } }, // FIX: same cluster scope
      include: { apd: { include: { permitCluster: { select: { id: true, clusterCode: true } } } } },
      take: 10,
    });
    abdPending.forEach((abd) => pendingActions.push({
      type: 'ABD_SUBMIT',
      clusterId: abd.apd.permitCluster.id,
      clusterCode: abd.apd.permitCluster.clusterCode,
      daysWaiting: Math.floor((Date.now() - abd.createdAt.getTime()) / 86400000),
      label: 'ABD belum dikirim ke ISP',
      href: `/permit-clusters/${abd.apd.permitCluster.id}`,
    }));
    const completedThisMonth = await this.prisma.permitCluster.count({
      where: {
        ...clusterFilter,
        status: 'COMPLETED',
        readyForConstructionAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    });
    return {
      stats: {
        activeClusters: myClusters, // FIX: not-completed clusters in fiber scope
        totalClusters, // FIX: extra KPI for PM dashboard
        pendingActions: pendingActions.length,
        pendingOrders,
        completedThisMonth,
        pendingVisitRequests, // FIX: visit-request queue depth
        pendingDocPackages, // FIX: surveyor doc package PM queue
      },
      clustersByPhase: clustersByPhase.map((c) => ({ phase: c.currentPhase, count: c._count._all })),
      pendingActions: pendingActions.slice(0, 10),
      recentClusters,
      myOrders,
    };
  }

  /** FIX: designer queue — clusters in HLD/LLD submission even when HLD/LLD row not created yet */
  async getDesignerStats() {
    const now = new Date();
    const [
      hldClusters,
      lldClusters,
      hldInReview,
      lldInReview,
      hldDone,
      lldDone,
    ] = await Promise.all([
      this.prisma.permitCluster.findMany({
        where: {
          currentPhase: 'HLD_SUBMISSION',
          OR: [{ hld: null }, { hld: { status: { in: ['DRAFT', 'ISP_REVISION'] } } }], // FIX: include “no HLD yet” + revise/draft
        },
        include: {
          hld: true,
          visitRequest: { include: { cleanList: { select: { siteName: true, fiberType: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.permitCluster.findMany({
        where: {
          currentPhase: 'LLD_SUBMISSION',
          OR: [{ lld: null }, { lld: { status: { in: ['DRAFT', 'ISP_REVISION'] } } }], // FIX: same for LLD
        },
        include: {
          lld: true,
          visitRequest: { include: { cleanList: { select: { siteName: true, fiberType: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.hld.count({ where: { status: { in: ['SUBMITTED_FOR_REVIEW', 'PM_APPROVED'] } } }), // FIX: with PM/Admin
      this.prisma.lld.count({ where: { status: { in: ['SUBMITTED_FOR_REVIEW', 'PM_APPROVED'] } } }),
      this.prisma.hld.count({ where: { status: 'ISP_APPROVED' } }),
      this.prisma.lld.count({ where: { status: 'ISP_APPROVED' } }),
    ]);

    const hldWithSla = hldClusters.map((cluster) => {
      const slaDeadline = cluster.hld?.slaDeadline ?? null;
      const daysLeft = slaDeadline
        ? Math.ceil((new Date(slaDeadline).getTime() - now.getTime()) / 86400000)
        : null; // FIX: SLA in days
      return {
        id: cluster.id,
        clusterCode: cluster.clusterCode,
        fiberType: cluster.fiberType,
        siteName: cluster.visitRequest?.cleanList?.siteName || cluster.clusterCode,
        phase: 'HLD' as const,
        hldStatus: cluster.hld?.status ?? 'BELUM_UPLOAD', // FIX: synthetic status when row missing
        slaDeadline,
        daysLeft,
        slaBreached: daysLeft !== null && daysLeft < 0,
        ispFeedback: cluster.hld?.ispFeedback ?? null,
      };
    });

    const lldWithSla = lldClusters.map((cluster) => ({
      id: cluster.id,
      clusterCode: cluster.clusterCode,
      fiberType: cluster.fiberType,
      siteName: cluster.visitRequest?.cleanList?.siteName || cluster.clusterCode,
      phase: 'LLD' as const,
      lldStatus: cluster.lld?.status ?? 'BELUM_UPLOAD',
      ispFeedback: cluster.lld?.ispFeedback ?? null,
    }));

    return {
      queue: {
        hld: hldWithSla,
        lld: lldWithSla,
        totalPending: hldClusters.length + lldClusters.length,
      },
      inReview: { hld: hldInReview, lld: lldInReview },
      completed: { hld: hldDone, lld: lldDone },
    };
  }

  async getSurveyorDashboard(userId: string, fiberType: string) {
    const ft = fiberType as FiberType;
    const [
      myRequests,
      requestsByStatus,
      recentRequests,
      availableCleanList,
      approvedThisMonth,
      activeVR,
      activeClusters,
      pendingTasks,
      unreadNotifications,
    ] = await Promise.all([
      this.prisma.visitRequest.count({ where: { requestedBy: userId } }),
      this.prisma.visitRequest.groupBy({ by: ['status'], where: { requestedBy: userId }, _count: { _all: true } }),
      this.prisma.visitRequest.findMany({
        where: { requestedBy: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { cleanList: { select: { siteName: true, rwCode: true, ispCustomer: true, kotaKabupaten: true } } },
      }),
      this.prisma.cleanList.count({ where: { status: 'AVAILABLE', fiberType: ft as any } }),
      this.prisma.visitRequest.count({
        where: {
          requestedBy: userId,
          status: 'APPROVED',
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      this.prisma.visitRequest.count({
        where: {
          requestedBy: userId,
          status: {
            in: [
              'PM_REVIEW_VISIT',
              'APPROVED_PENDING_DATA',
              'PM_REVIEW_SURVEY',
              'PM_SENIOR_REVIEW',
              'ADMIN_REVIEW',
            ],
          },
        },
      }), // FIX: VR masih berjalan
      this.prisma.permitCluster.count({ where: { status: { not: 'COMPLETED' }, fiberType: ft } }), // FIX: cluster aktif per fiber
      this.prisma.surveyorDocPackage.count({
        where: {
          submittedBy: userId,
          status: { in: ['ASSEMBLING', 'SUBMITTED', 'PM_REJECTED', 'ADMIN_REJECTED'] },
        },
      }), // FIX: tugas dokumen surveyor
      this.prisma.notification.count({ where: { userId, isRead: false } }), // FIX: inbox belum dibaca
    ]);
    const statusMap = Object.fromEntries(requestsByStatus.map((r) => [r.status, r._count._all]));
    return {
      stats: {
        total: myRequests,
        draft: statusMap['DRAFT'] || 0,
        submitted:
          (statusMap['PM_REVIEW_VISIT'] || 0) +
          (statusMap['APPROVED_PENDING_DATA'] || 0) +
          (statusMap['PM_REVIEW_SURVEY'] || 0) +
          (statusMap['PM_SENIOR_REVIEW'] || 0) +
          (statusMap['ADMIN_REVIEW'] || 0),
        underReview:
          (statusMap['PM_REVIEW_VISIT'] || 0) +
          (statusMap['PM_REVIEW_SURVEY'] || 0) +
          (statusMap['PM_SENIOR_REVIEW'] || 0) +
          (statusMap['ADMIN_REVIEW'] || 0),
        approved: statusMap['APPROVED'] || 0,
        rejected: statusMap['REJECTED'] || 0,
        approvedThisMonth,
        activeVR, // FIX
        activeClusters, // FIX
        pendingTasks, // FIX
        unreadNotifications, // FIX
      },
      recentRequests,
      availableCleanList,
    };
  }

  async getAdminDashboard() {
    const [pendingVisitRequests, pendingBakpValidations, recentApprovals, constructionReadyThisMonth, documentsReadyForIsp] =
      await Promise.all([
      this.prisma.visitRequest.count({ where: { status: 'ADMIN_REVIEW' } }),
      this.prisma.bakp.count({ where: { status: { in: ['SUBMITTED_TO_PM', 'SUBMITTED_TO_ADMIN', 'SUBMITTED_TO_ISP'] } } }),
      this.prisma.visitApprovalLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { actor: { select: { name: true, role: true } } },
      }),
      this.prisma.permitCluster.count({
        where: {
          status: 'COMPLETED',
          readyForConstructionAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      this.prisma.permitCluster.count({
        where: { bakp: { status: 'DONE', ispDecision: 'ACCEPTED' } },
      }),
    ]);
    return {
      pendingValidations: {
        visitRequests: pendingVisitRequests,
        bakpValidations: pendingBakpValidations,
        total: pendingVisitRequests + pendingBakpValidations,
      },
      recentApprovals,
      constructionReadyThisMonth,
      documentsReadyForIsp, // FIX: sama filter dengan /document-list (BAKP approved → kirim ISP)
    };
  }

  async getFinanceDashboard() {
    const startMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // FIX: month boundary
    const [pendingInvoices, pendingCashOps, approvedThisMonth, disbursedAgg, pendingStockFinance] =
      await Promise.all([
      this.prisma.invoicePackage.count({
        where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, // FIX: finance invoice inbox
      }),
      this.prisma.cashOperationRequest.count({
        where: {
          currentApproverRole: 'FINANCE',
          status: { in: ['SUBMITTED', 'IN_REVIEW'] },
        },
      }), // FIX: cash op waiting on Finance
      this.prisma.cashOperationRequest.count({
        where: { status: 'APPROVED', updatedAt: { gte: startMonth } },
      }), // FIX: approved this month
      this.prisma.cashOperationRequest.aggregate({
        _sum: { disbursedAmount: true },
        where: { status: 'DISBURSED' },
      }), // FIX: real disbursed totals
      this.prisma.order.count({ where: { status: 'PENDING_PAYMENT_RECEIPT' } }), // Phase 3: payment after GM (legacy: StockRequest OPS_APPROVED)
    ]);
    const totalDisbursed = Number(disbursedAgg._sum.disbursedAmount?.toString() ?? '0') || 0; // FIX: Decimal → number
    return {
      pendingInvoices,
      pendingCashOps,
      approvedThisMonth,
      totalDisbursed,
      pendingStockFinance, // FIX: antrian pembayaran stock request
    };
  }

  /** FIX: operational manager KPIs */
  async getOpsStats() {
    const [pendingSkoms, pendingPOs, pendingStockPOs, pendingCashOps, activeClusters] = await Promise.all([
      this.prisma.skomBudget.count({ where: { status: 'PENDING_OPS_APPROVAL' } }),
      this.prisma.prBrWorkflow.count({ where: { status: 'PO_CREATED' } }), // FIX: PR/BR PO
      this.prisma.order.count({ where: { status: 'PENDING_OPS_APPROVAL' } }), // Phase 3: Ops PO gate (legacy: StockRequest PO_CREATED)
      this.prisma.cashOperationRequest.count({
        where: {
          currentApproverRole: 'OPERATIONAL_MANAGER',
          status: { in: ['SUBMITTED', 'IN_REVIEW'] },
        },
      }),
      this.prisma.permitCluster.count({ where: { status: { not: 'COMPLETED' } } }),
    ]);
    return { pendingSkoms, pendingPOs, pendingStockPOs, pendingCashOps, activeClusters }; // FIX
  }

  /** FIX: marketing / marketing head — light operational visibility */
  async getMarketingStats() {
    const [pendingReimburse, pendingCashOps, approvedCashOps, totalClusters] = await Promise.all([
      this.prisma.cashOperationRequest.count({
        where: { type: 'REIMBURSEMENT', status: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW'] } },
      }), // FIX: reimburse antrian
      this.prisma.cashOperationRequest.count({
        where: { type: 'CASH_ADVANCE', status: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW'] } },
      }), // FIX: cash advance antrian
      this.prisma.cashOperationRequest.count({ where: { status: 'APPROVED' } }),
      this.prisma.permitCluster.count(),
    ]);
    return { pendingReimburse, pendingCashOps, approvedCashOps, totalClusters }; // FIX
  }

  /** Purchasing — order harga, PO email, tagihan supplier */
  async getPurchasingDashboard() {
    const purchasingStatuses: OrderStatus[] = [
      OrderStatus.PENDING_PURCHASING_INPUT,
      OrderStatus.PENDING_OPS_APPROVAL,
      OrderStatus.PENDING_GM_APPROVAL,
      OrderStatus.PENDING_PAYMENT_RECEIPT,
    ];

    const [
      pendingPriceInput,
      pendingPoSendEmail,
      invoicesAwaitingAck,
      totalSuppliers,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where: { status: OrderStatus.PENDING_PURCHASING_INPUT } }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.PENDING_PAYMENT_RECEIPT,
          poEmailSentAt: null,
        },
      }),
      this.prisma.supplierInvoice.count({ where: { status: 'SENT_TO_SUPPLIER' } }),
      this.prisma.supplier.count({ where: { isActive: true } }),
      this.prisma.order.findMany({
        where: { status: { in: purchasingStatuses } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          orderTrigger: true,
          createdAt: true,
          totalAmount: true,
        },
      }),
    ]);

    return {
      pendingPriceInput,
      pendingPoSendEmail,
      invoicesAwaitingAck,
      totalSuppliers,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        orderTrigger: o.orderTrigger,
        createdAt: o.createdAt.toISOString(),
        totalAmount: o.totalAmount != null ? o.totalAmount.toString() : '0',
      })),
    };
  }

  /** FIX: admin stock — inventory-centric counts */
  async getAdminStockStats() {
    const lowAgg = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n
      FROM "StockItem"
      WHERE "isActive" = true
        AND ("currentQty" <= "minStockQty" OR "currentQty" <= 10)
    `;
    const lowStockItems = Number(lowAgg[0]?.n ?? 0);

    const [totalItems, pendingOrderVerification, activeOrders, recentLogs] = await Promise.all([
      this.prisma.stockItem.count({ where: { isActive: true } }),
      this.prisma.order.count({ where: { status: 'PENDING_VERIFICATION' } }), // Admin Stock — verifikasi penerimaan
      this.prisma.order.count({
        where: { status: { in: ['DRAFT', 'SUBMITTED', 'STOCK_AVAILABLE', 'PARTIAL_STOCK', 'NO_STOCK'] } },
      }), // FIX: order aktif (bukan FULFILLED)
      this.prisma.stockLog.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { stockItem: { select: { name: true, code: true } } },
      }),
    ]);
    return { totalItems, lowStockItems, pendingOrderVerification, activeOrders, recentLogs };
  }
}
