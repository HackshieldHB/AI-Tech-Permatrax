import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  FiberType,
  OrderStatus,
  PermitPhase,
  PurchaseRequestStatus,
} from '@prisma/client'; // FIX: FiberType for PM/designer-scoped queries

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
  async getGmStats() {
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
      },
      pipeline: {
        byPhase: byPhaseFormatted,
        byFiberType: byFiberType.map((f) => ({
          fiberType: f.fiberType as string,
          count:     f._count.id,
        })),
      },
      recentActivity: recentActivityFormatted,
    };
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
