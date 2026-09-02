import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/types/auth-user.types';
import {
  detectFinanceMetric,
  detectFinanceMetrics,
  detectFinanceMode,
  detectRankingMetric,
  detectRankingDirection,
  detectExplicitTopN,
  hasExplicitRankingMetric,
  extractHierarchyConstraint,
  extractOwnerName,
  extractProjectNeedle,
  extractSearchNeedle,
  fmtDateId,
  fmtIdr,
  isFinanceBudgetQuery,
  isFinanceFilterOnlyQuery,
  isProjectCountQuery,
  meaningfulTokens,
  normalizeId,
  type FinanceMetric,
  type FinanceRankingMetric,
} from './ai-nlu';

import {
  buildClusterWhyTemplate,
  buildFinanceWhyTemplate,
  detectWhyFocus,
  type FinanceExplainPack,
} from './ai-explain';

export type ToolTrace = {
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

@Injectable()
export class AiToolsService {
  constructor(private readonly prisma: PrismaService) {}

  detectToolIntent(message: string): string[] {
    const m = normalizeId(message);
    const tools: string[] = [];

    if (
      /(berapa|jumlah|count|total|status).*(cluster|permit)/.test(m) ||
      /(cluster|permit).*(berapa|jumlah|open|aktif|progress)/.test(m)
    ) {
      tools.push('count_permit_clusters');
    }

    if (isFinanceBudgetQuery(message) || isFinanceFilterOnlyQuery(message)) {
      tools.push('finance_analytics');
    }

    if (
      /(kapan|terakhir|last).*(dana|cair|keluar|disburse|pencairan)/.test(m) ||
      /(dana|cair|pencairan|disburse).*(terakhir|last|keluar|kapan)/.test(m) ||
      /(dana\s*keluar|terakhir\s*cair)/.test(m)
    ) {
      tools.push('last_fund_disbursement');
    }

    if (
      /(approval\s*dana|dana.*pending|pending.*approval|belum.*(cair|approve|disetujui))/.test(
        m,
      )
    ) {
      tools.push('pending_fund_approvals');
    }

    if (
      /(cash\s*op|cash operation|pengajuan dana)/.test(m) &&
      /(berapa|jumlah|open|status|saya|milik|total)/.test(m) &&
      !tools.includes('last_fund_disbursement') &&
      !tools.includes('pending_fund_approvals')
    ) {
      tools.push('my_cash_operations');
    }

    if (
      /(visit request|kunjungan)/.test(m) &&
      /(berapa|jumlah|status|open|saya)/.test(m)
    ) {
      tools.push('my_visit_requests');
    }

    if (
      /(purchase request|\bpr\b|pembelian)/.test(m) &&
      /(berapa|jumlah|pending|status|saya)/.test(m)
    ) {
      tools.push('my_purchase_requests');
    }

    if (
      (/(stok|stock|barang)/.test(m) &&
        /(berapa|cari|cek|qty|jumlah|total|paling|terendah|terkecil|terbesar|sedikit|banyak)/.test(
          m,
        )) ||
      /(barang|stok|stock).*(paling sedikit|paling kecil|paling banyak|terendah)/.test(
        m,
      ) ||
      /^(barang yang paling|stok yang paling|stock yang paling)/.test(m)
    ) {
      tools.push('search_stock');
    }

    if (/(supplier).*(berapa|jumlah|total|banyak)/.test(m)) {
      tools.push('count_suppliers');
    }

    if (/(fttt).*(berapa|jumlah|open|aktif|proyek)/.test(m)) {
      tools.push('count_fttt_projects');
    }

    if (
      /(buat|create|generate).*(ringkasan|summary|laporan).*(hari ini|today)/.test(
        m,
      ) ||
      /ringkas.*(hari ini|kondisi|dashboard)/.test(m)
    ) {
      tools.push('daily_summary');
    }

    if (
      /(siapa|who).*(pic|pm|project manager|penanggung jawab|owner)/.test(m) ||
      (/\bpic\b/.test(m) && /(project|proyek|cluster|siapa)/.test(m))
    ) {
      tools.push('lookup_project_pic');
    }

    if (
      /(requestor|requester|pemohon).*(siapa|who|nama|visit)/.test(m) ||
      /(siapa).*(requestor|requester|pemohon)/.test(m) ||
      (/(visit).*(requestor|pemohon)/.test(m) && /(siapa|who)/.test(m))
    ) {
      tools.push('lookup_visit_requestor');
    }

    if (
      /(purchase request|\bpr\b).*(requestor|pemohon|siapa)/.test(m) ||
      /(requestor|pemohon).*(purchase|pr\b)/.test(m)
    ) {
      tools.push('lookup_pr_requestor');
    }

    return [...new Set(tools)];
  }

  async runTools(
    toolNames: string[],
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace[]> {
    const traces: ToolTrace[] = [];
    for (const name of toolNames) {
      try {
        const result = await this.execute(name, user, message);
        traces.push(result);
      } catch (err) {
        traces.push({
          name,
          ok: false,
          summary: err instanceof Error ? err.message : 'Tool failed',
        });
      }
    }
    return traces;
  }

  private async execute(
    name: string,
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    switch (name) {
      case 'count_permit_clusters':
        return this.countPermitClusters(user);
      case 'finance_analytics':
        return this.financeAnalytics(user, message);
      // legacy alias
      case 'finance_project_totals':
        return this.financeAnalytics(user, message);
      case 'explain_finance_project':
        return this.explainFinanceProject(user, message);
      case 'explain_permit_cluster':
        return this.explainPermitCluster(user, message);
      case 'last_fund_disbursement':
        return this.lastFundDisbursement(user);
      case 'pending_fund_approvals':
        return this.pendingFundApprovals(user);
      case 'my_cash_operations':
        return this.myCashOperations(user);
      case 'my_visit_requests':
        return this.myVisitRequests(user);
      case 'my_purchase_requests':
        return this.myPurchaseRequests(user);
      case 'search_stock':
        return this.searchStock(user, message);
      case 'count_suppliers':
        return this.countSuppliers(user);
      case 'count_fttt_projects':
        return this.countFttt(user);
      case 'daily_summary':
        return this.dailySummary(user);
      case 'lookup_project_pic':
        return this.lookupProjectPic(user, message);
      case 'lookup_visit_requestor':
        return this.lookupVisitRequestor(user, message);
      case 'lookup_pr_requestor':
        return this.lookupPrRequestor(user, message);
      default:
        return { name, ok: false, summary: 'Unknown tool' };
    }
  }

  private canAccessFinance(role: string): boolean {
    return (
      [
        'GENERAL_MANAGER',
        'FINANCE',
        'OPERATIONAL_MANAGER',
        'PM_SENIOR',
        'PURCHASING',
        'ADMIN',
        'MARKETING_HEAD',
      ].includes(role) || role.startsWith('PM_')
    );
  }

  private canSeeAllFinance(role: string): boolean {
    return [
      'GENERAL_MANAGER',
      'FINANCE',
      'OPERATIONAL_MANAGER',
      'PM_SENIOR',
      'ADMIN',
      'MARKETING_HEAD',
    ].includes(role);
  }

  /** Broader retrieval strategy after user correction (PAI-BHV-001). */
  private async financeBroaderRetry(
    user: AuthUser,
    scopeWhere: Prisma.FinanceProjectWhereInput,
  ): Promise<ToolTrace> {
    const whereAll: Prisma.FinanceProjectWhereInput = {
      ...scopeWhere,
      status: { not: 'ARCHIVED' },
    };
    if (!this.canSeeAllFinance(user.role)) {
      whereAll.createdById = user.userId;
    }

    const [active, closed, archived, nonArchived, samples, agg] =
      await Promise.all([
        this.prisma.financeProject.count({
          where: { ...whereAll, status: 'ACTIVE' },
        }),
        this.prisma.financeProject.count({
          where: { ...whereAll, status: 'CLOSED' },
        }),
        this.prisma.financeProject.count({
          where: {
            ...(whereAll.createdById
              ? { createdById: whereAll.createdById }
              : {}),
            status: 'ARCHIVED',
          },
        }),
        this.prisma.financeProject.count({ where: whereAll }),
        this.prisma.financeProject.findMany({
          where: whereAll,
          select: { code: true, name: true, status: true, totalBudget: true },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        this.prisma.financeProject.aggregate({
          where: whereAll,
          _sum: { totalBudget: true },
        }),
      ]);

    if (nonArchived === 0 && active === 0) {
      return {
        name: 'finance_analytics',
        ok: true,
        summary: [
          'Pencarian ulang (strategi lebih luas: non-ARCHIVED + rincian status)',
          '• Hasil: tidak ada project pada scope akses kamu.',
          `• ACTIVE: ${active} | CLOSED: ${closed} | ARCHIVED (info): ${archived}`,
        ].join('\n'),
        data: { active, closed, archived, nonArchived },
      };
    }

    const sampleLines = samples.map(
      (r, i) =>
        `${i + 1}. ${r.code} — ${r.name} [${r.status}] ${fmtIdr(Number(r.totalBudget))}`,
    );

    return {
      name: 'finance_analytics',
      ok: true,
      summary: [
        'Pencarian ulang (strategi lebih luas — bukan filter pencarian nama sempit)',
        `• ACTIVE : ${active}`,
        `• CLOSED : ${closed}`,
        `• ARCHIVED (di luar agregat default) : ${archived}`,
        `• Non-ARCHIVED total : ${nonArchived}`,
        `• Total Budget (non-ARCHIVED) : ${fmtIdr(Number(agg._sum.totalBudget ?? 0))}`,
        samples.length ? '• Contoh project terbaru:' : null,
        ...sampleLines,
        `Data per ${fmtDateId()}.`,
      ]
        .filter(Boolean)
        .join('\n'),
      data: { active, closed, archived, nonArchived, samples },
    };
  }

  private async financeAnalytics(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    if (!this.canAccessFinance(user.role)) {
      return {
        name: 'finance_analytics',
        ok: true,
        summary:
          'Role kamu belum punya akses ringkasan Finance Project. Coba buka menu Finance Projects kalau tersedia di sidebar.',
      };
    }

    // Strip constraint/recovery tags for NLU so session tags don't hijack mode
    const bareMessage = message
      .replace(/\s*\[(SCOPE_|HIERARCHY_|BROADER_|USER_|METRIC|LIMIT_|DIR_).*?\]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let mode = detectFinanceMode(bareMessage);
    if (
      (mode === 'metric_aggregate' || mode === 'summary') &&
      (/\[METRIC_/i.test(message) || /\[LIMIT_/i.test(message) || /\[DIR_/i.test(message)) &&
      !isProjectCountQuery(bareMessage)
    ) {
      mode = /\[DIR_ASC\]/i.test(message) ? 'smallest' : 'top_budget';
    }
    // PAI-FNC-002: hard-prefer project_count over inherited Summary prose
    if (
      isProjectCountQuery(bareMessage) &&
      !extractProjectNeedle(bareMessage) &&
      mode !== 'search' &&
      mode !== 'top_budget' &&
      mode !== 'smallest' &&
      mode !== 'status_count' &&
      mode !== 'metric_aggregate' &&
      mode !== 'filtered_list'
    ) {
      mode = 'project_count';
    }
    const metrics = detectFinanceMetrics(bareMessage);
    const metric = metrics[0] ?? detectFinanceMetric(bareMessage);
    // Prefer this-turn wording (incl. METRIC tags); bareMessage alone can
    // inherit "realisasi" from a prior ranking line (PAI-FNC-004).
    const rankingMetric = detectRankingMetric(
      hasExplicitRankingMetric(bareMessage) ? bareMessage : message,
    );
    const explicitN = detectExplicitTopN(bareMessage);
    const taggedLimit = message.match(/\[LIMIT_(\d{1,2})\]/i);
    const topN =
      explicitN ??
      (taggedLimit ? Math.min(50, Math.max(1, Number(taggedLimit[1]))) : 10);
    const taggedDir: 'asc' | 'desc' | null = /\[DIR_ASC\]/i.test(message)
      ? 'asc'
      : /\[DIR_DESC\]/i.test(message)
        ? 'desc'
        : null;
    const rankDir = detectRankingDirection(bareMessage) ?? taggedDir;
    const broaderScope =
      /\[broader_retry\]|\[scope_non_archived\]|\[scope_all\]/i.test(message) ||
      /non.?arsip|non.?archived|termasuk closed|active\s*\+\s*closed/i.test(
        message,
      );
    const forceClosed =
      /\[scope_closed\]/i.test(message) ||
      (/\bclosed\b/.test(normalizeId(bareMessage)) &&
        (mode === 'status_count' ||
          mode === 'summary' ||
          mode === 'metric_aggregate' ||
          mode === 'project_count' ||
          mode === 'filtered_list'));
    const forceArchived =
      /\[scope_archived\]/i.test(message) ||
      (/\b(archived|arsip)\b/.test(normalizeId(bareMessage)) &&
        (mode === 'status_count' || mode === 'filtered_list'));
    const forceActive =
      (/\[scope_active\]/i.test(message) &&
        mode !== 'project_count' &&
        mode !== 'metric_aggregate') ||
      (/\baktif\b|\bactive\b/.test(normalizeId(bareMessage)) &&
        !broaderScope &&
        !forceClosed &&
        !forceArchived &&
        mode !== 'status_count' &&
        mode !== 'project_count');

    const hierarchyLevel = extractHierarchyConstraint(message);

    let statusWhere: Prisma.FinanceProjectWhereInput['status'] = {
      not: 'ARCHIVED',
    };
    if (forceArchived || metric === 'status_archived') statusWhere = 'ARCHIVED';
    else if (forceClosed || metric === 'status_closed') statusWhere = 'CLOSED';
    else if (
      !broaderScope &&
      (forceActive ||
        metric === 'status_active' ||
        // PAI-FNC-002: full Finance Summary still defaults to ACTIVE.
        // Ranking / filter-only must NOT silently drop CLOSED rows unless the
        // user or session actually said ACTIVE (PAI-FNC-004 / FNC-005).
        (mode === 'summary' && !forceClosed && !forceArchived))
    ) {
      statusWhere = 'ACTIVE';
    }

    const baseWhere: Prisma.FinanceProjectWhereInput = {
      status: statusWhere,
      ...(hierarchyLevel ? { hierarchyLevel } : {}),
    };

    if (/\[broader_retry\]/i.test(message)) {
      return this.financeBroaderRetry(user, {
        ...baseWhere,
        status: { not: 'ARCHIVED' },
      });
    }

    if (!this.canSeeAllFinance(user.role)) {
      baseWhere.createdById = user.userId;
    }

    if (mode === 'by_owner') {
      const owner = extractOwnerName(message);
      if (owner) {
        const people = await this.prisma.user.findMany({
          where: { name: { contains: owner, mode: 'insensitive' } },
          select: { id: true, name: true },
          take: 5,
        });
        if (people.length === 0) {
          return {
            name: 'finance_analytics',
            ok: true,
            summary: `Tidak ketemu user bernama “${owner}”. Coba ejaan lain ya.`,
          };
        }
        baseWhere.createdById = { in: people.map((p) => p.id) };
      }
    }

    if (mode === 'status_count') {
      const statusLabel =
        metric === 'status_closed'
          ? 'CLOSED'
          : metric === 'status_archived'
            ? 'ARCHIVED'
            : 'ACTIVE';
      const count = await this.prisma.financeProject.count({
        where: {
          ...baseWhere,
          status: statusLabel,
          ...(hierarchyLevel ? { hierarchyLevel } : {}),
        },
      });
      return {
        name: 'finance_analytics',
        ok: true,
        summary: hierarchyLevel
          ? `${statusLabel} ${hierarchyLevel} – ${count} Project`
          : `${statusLabel} Project – ${count} Project`,
        data: { status: statusLabel, count, mode: 'status_count' },
      };
    }

    // PAI-FNC-002: "Berapa total project?" → count non-ARCHIVED (or forced status)
    if (mode === 'project_count') {
      const count = await this.prisma.financeProject.count({
        where: {
          ...baseWhere,
          ...(hierarchyLevel ? { hierarchyLevel } : {}),
        },
      });
      const scopeLabel = forceActive
        ? 'ACTIVE'
        : forceClosed
          ? 'CLOSED'
          : 'non-ARCHIVED';
      return {
        name: 'finance_analytics',
        ok: true,
        summary: `Total Project – ${count} Project (${scopeLabel})`,
        data: { count, mode: 'project_count', scope: scopeLabel },
      };
    }

    if (mode === 'metric_aggregate' && metrics.length > 0) {
      return this.financeMetricAggregate(baseWhere, metrics, hierarchyLevel);
    }

    if (mode === 'search') {
      const needle =
        extractProjectNeedle(message) || extractSearchNeedle(message);
      const exactCode = (needle || message).match(
        /\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i,
      )?.[1];
      const isCari =
        /\bcari\b/i.test(normalizeId(bareMessage)) ||
        /\bcari\b/i.test(normalizeId(message));
      const isDetailLookup = /^detail\b/i.test(bareMessage.trim());
      if (exactCode && isDetailLookup && !isCari) {
        const exactRows = await this.prisma.financeProject.findMany({
          where: {
            status: { not: 'ARCHIVED' },
            ...(hierarchyLevel ? { hierarchyLevel } : {}),
          },
          select: {
            code: true,
            name: true,
            description: true,
            totalBudget: true,
            materialBudget: true,
            jasaBudget: true,
            materialSpent: true,
            jasaSpent: true,
            status: true,
            hierarchyLevel: true,
            isOverbudget: true,
            poCustomerNumber: true,
            parent: { select: { code: true, name: true } },
          },
          take: 20,
        });
        const hit = exactRows.filter(
          (r) => r.code.toUpperCase() === exactCode.toUpperCase(),
        );
        if (hit.length === 1) {
          const r = hit[0];
          const spent = Number(r.materialSpent) + Number(r.jasaSpent);
          const budget = Number(r.totalBudget);
          return {
            name: 'finance_analytics',
            ok: true,
            summary: [
              `${r.code} — ${r.name}`,
              `• Status: ${r.status} (${r.hierarchyLevel})`,
              r.parent ? `• Parent: ${r.parent.code} ${r.parent.name}` : null,
              r.poCustomerNumber ? `• PO/Client: ${r.poCustomerNumber}` : null,
              `• Total Budget: ${fmtIdr(budget)}`,
              `• Material budget: ${fmtIdr(Number(r.materialBudget ?? 0))} | Jasa budget: ${fmtIdr(Number(r.jasaBudget ?? 0))}`,
              `• Realisasi: ${fmtIdr(spent)} | Sisa: ${fmtIdr(budget - spent)}`,
              r.isOverbudget ? `• Over budget` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            data: hit,
          };
        }
      }
      if (needle) {
        if (exactCode) {
          // Exact object + children of that code. Do not tokenize SEG-2026-005
          // into "005" (that falsely matches FIN-2026-005 via contains).
          baseWhere.OR = [
            { code: { equals: exactCode, mode: 'insensitive' } },
            { parent: { code: { equals: exactCode, mode: 'insensitive' } } },
          ];
        } else {
          const tokens = meaningfulTokens(needle);
          const parts = tokens.length > 0 ? tokens : [needle];
          const attrOr = (p: string): Prisma.FinanceProjectWhereInput[] => [
            { name: { contains: p, mode: 'insensitive' } },
            { code: { contains: p, mode: 'insensitive' } },
            { description: { contains: p, mode: 'insensitive' } },
            { poCustomerNumber: { contains: p, mode: 'insensitive' } },
            { parent: { name: { contains: p, mode: 'insensitive' } } },
            { parent: { code: { contains: p, mode: 'insensitive' } } },
          ];
          baseWhere.OR = parts.flatMap((p) => attrOr(p));
        }
        delete (baseWhere as { status?: unknown }).status;
        baseWhere.status = { not: 'ARCHIVED' };
      }
    }

    if (mode === 'overbudget') {
      baseWhere.isOverbudget = true;
    }

    if (mode === 'hierarchy_counts') {
      const [sites, segments, standalone, active] = await Promise.all([
        this.prisma.financeProject.count({
          where: { ...baseWhere, hierarchyLevel: 'SITE' },
        }),
        this.prisma.financeProject.count({
          where: { ...baseWhere, hierarchyLevel: 'SEGMENT' },
        }),
        this.prisma.financeProject.count({
          where: { ...baseWhere, hierarchyLevel: 'STANDALONE' },
        }),
        this.prisma.financeProject.count({
          where: { ...baseWhere, status: 'ACTIVE' },
        }),
      ]);
      return {
        name: 'finance_analytics',
        ok: true,
        summary: [
          `Ringkasan hierarki Finance Project`,
          `• Total ACTIVE : ${active}`,
          `• Segment : ${segments}`,
          `• Site : ${sites}`,
          `• Standalone : ${standalone}`,
          `Data per ${fmtDateId()}.`,
        ].join('\n'),
        data: { sites, segments, standalone, active },
      };
    }

    if (mode === 'top_budget' || mode === 'smallest' || mode === 'ranking') {
      const dir: 'asc' | 'desc' =
        rankDir === 'asc'
          ? 'asc'
          : rankDir === 'desc'
            ? 'desc'
            : mode === 'smallest'
              ? 'asc'
              : 'desc';
      return this.financeRankingList(
        baseWhere,
        rankingMetric,
        dir,
        hierarchyLevel,
        topN,
      );
    }

    if (mode === 'filtered_list') {
      return this.financeFilteredList(baseWhere, hierarchyLevel, statusWhere);
    }

    if (mode === 'search') {
      const rows = await this.prisma.financeProject.findMany({
        where: baseWhere,
        select: {
          code: true,
          name: true,
          description: true,
          totalBudget: true,
          materialBudget: true,
          jasaBudget: true,
          materialSpent: true,
          jasaSpent: true,
          status: true,
          hierarchyLevel: true,
          isOverbudget: true,
          poCustomerNumber: true,
          parent: { select: { code: true, name: true } },
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      });
      if (rows.length === 0) {
        return {
          name: 'finance_analytics',
          ok: true,
          summary:
            'Project tidak ditemukan di database untuk kata kunci tersebut (non-ARCHIVED). Coba nama site, segment, client/PO, atau kode project.',
          data: { mode: 'search', count: 0 },
        };
      }
      const lines = rows.map((r) => {
        const spent = Number(r.materialSpent) + Number(r.jasaSpent);
        const budget = Number(r.totalBudget);
        return [
          `${r.code} — ${r.name}`,
          `• Status: ${r.status} (${r.hierarchyLevel})`,
          r.parent ? `• Parent: ${r.parent.code} ${r.parent.name}` : null,
          r.poCustomerNumber ? `• PO/Client: ${r.poCustomerNumber}` : null,
          `• Total Budget: ${fmtIdr(budget)}`,
          `• Material budget: ${fmtIdr(Number(r.materialBudget ?? 0))} | Jasa budget: ${fmtIdr(Number(r.jasaBudget ?? 0))}`,
          `• Realisasi: ${fmtIdr(spent)} | Sisa: ${fmtIdr(budget - spent)}`,
          r.isOverbudget ? `• Over budget` : null,
        ]
          .filter(Boolean)
          .join('\n');
      });
      const header =
        rows.length > 1
          ? `Ditemukan ${rows.length} project — pilih salah satu (sebutkan kode):\n`
          : '';
      return {
        name: 'finance_analytics',
        ok: true,
        summary: header + lines.join('\n\n'),
        data: rows,
      };
    }

    const where = baseWhere;
    const [count, agg, biggest, smallest, siteCount, segmentCount, overCount] =
      await Promise.all([
        this.prisma.financeProject.count({ where }),
        this.prisma.financeProject.aggregate({
          where,
          _sum: {
            totalBudget: true,
            materialBudget: true,
            jasaBudget: true,
            materialSpent: true,
            jasaSpent: true,
          },
        }),
        this.prisma.financeProject.findFirst({
          where,
          orderBy: { totalBudget: 'desc' },
          select: { code: true, name: true, totalBudget: true },
        }),
        this.prisma.financeProject.findFirst({
          where,
          orderBy: { totalBudget: 'asc' },
          select: { code: true, name: true, totalBudget: true },
        }),
        this.prisma.financeProject.count({
          where: { ...where, hierarchyLevel: 'SITE' },
        }),
        this.prisma.financeProject.count({
          where: { ...where, hierarchyLevel: 'SEGMENT' },
        }),
        this.prisma.financeProject.count({
          where: { ...where, isOverbudget: true },
        }),
      ]);

    const totalBudget = Number(agg._sum.totalBudget ?? 0);
    const materialBudget = Number(agg._sum.materialBudget ?? 0);
    const jasaBudget = Number(agg._sum.jasaBudget ?? 0);
    const realized =
      Number(agg._sum.materialSpent ?? 0) + Number(agg._sum.jasaSpent ?? 0);
    const remaining = totalBudget - realized;
    const statusLabel =
      statusWhere === 'ACTIVE'
        ? 'ACTIVE'
        : statusWhere === 'CLOSED'
          ? 'CLOSED'
          : statusWhere === 'ARCHIVED'
            ? 'ARCHIVED'
            : 'non-ARCHIVED';

    if (count === 0) {
      return {
        name: 'finance_analytics',
        ok: true,
        summary: `Tidak ada Finance Project berstatus ${statusLabel} di scope akses kamu.`,
        data: { count: 0 },
      };
    }

    const hierNote = hierarchyLevel ? ` | hierarki ${hierarchyLevel}` : '';
    const summary = [
      `Total Budget Finance Project (${statusLabel}${hierNote})`,
      `• Total Project : ${count}`,
      hierarchyLevel
        ? `• Filter hierarki : ${hierarchyLevel}`
        : `• Segment : ${segmentCount} | Site : ${siteCount}`,
      `• Total Budget : ${fmtIdr(totalBudget)}`,
      `• Material Budget : ${fmtIdr(materialBudget)} | Jasa Budget : ${fmtIdr(jasaBudget)}`,
      `• Total Realisasi : ${fmtIdr(realized)}`,
      `• Total Sisa Budget : ${fmtIdr(remaining)}`,
      `• Over budget : ${overCount} project`,
      biggest
        ? `• Project terbesar : ${biggest.code} ${biggest.name} (${fmtIdr(Number(biggest.totalBudget))})`
        : null,
      smallest
        ? `• Project terkecil : ${smallest.code} ${smallest.name} (${fmtIdr(Number(smallest.totalBudget))})`
        : null,
      `Data dihitung dari Finance Project status ${statusLabel}${hierNote} per ${fmtDateId()}.`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      name: 'finance_analytics',
      ok: true,
      summary,
      data: {
        count,
        totalBudget,
        materialBudget,
        jasaBudget,
        realized,
        remaining,
        siteCount,
        segmentCount,
        overCount,
        biggest,
        smallest,
      },
    };
  }

  /** PAI-FNC-005: list projects by status/hierarchy filters, never keyword search. */
  private async financeFilteredList(
    baseWhere: Prisma.FinanceProjectWhereInput,
    hierarchyLevel: 'SITE' | 'SEGMENT' | 'STANDALONE' | null,
    statusWhere: Prisma.FinanceProjectWhereInput['status'],
  ): Promise<ToolTrace> {
    const rows = await this.prisma.financeProject.findMany({
      where: baseWhere,
      select: {
        code: true,
        name: true,
        totalBudget: true,
        materialBudget: true,
        jasaBudget: true,
        materialSpent: true,
        jasaSpent: true,
        status: true,
        hierarchyLevel: true,
        isOverbudget: true,
        poCustomerNumber: true,
        parent: { select: { code: true, name: true } },
      },
      take: 15,
      orderBy: { updatedAt: 'desc' },
    });
    const statusLabel =
      statusWhere === 'ACTIVE'
        ? 'ACTIVE'
        : statusWhere === 'CLOSED'
          ? 'CLOSED'
          : statusWhere === 'ARCHIVED'
            ? 'ARCHIVED'
            : 'non-ARCHIVED';
    const filterBits = [statusLabel, hierarchyLevel].filter(Boolean).join(' + ');
    const ack = `Baik. Filter project sekarang: ${filterBits}.`;
    if (rows.length === 0) {
      return {
        name: 'finance_analytics',
        ok: true,
        summary: `${ack}\nTidak ada Finance Project dengan filter ${filterBits} di scope akses kamu.`,
        data: { mode: 'filtered_list', count: 0, status: statusLabel, hierarchyLevel },
      };
    }
    const lines = rows.map((r) => {
      const spent = Number(r.materialSpent) + Number(r.jasaSpent);
      const budget = Number(r.totalBudget);
      return `${r.code} — ${r.name} [${r.status} / ${r.hierarchyLevel}] • Budget ${fmtIdr(budget)} • Realisasi ${fmtIdr(spent)}`;
    });
    return {
      name: 'finance_analytics',
      ok: true,
      summary: [
        ack,
        `Ditemukan ${rows.length} project (${filterBits}):`,
        ...lines,
        `Data per ${fmtDateId()}.`,
      ].join('\n'),
      data: { mode: 'filtered_list', count: rows.length, rows },
    };
  }

  /** PAI-FNC-002: emit one or more aggregate metrics without full Finance Summary dump. */
  private async financeMetricAggregate(
    baseWhere: Prisma.FinanceProjectWhereInput,
    metrics: FinanceMetric[],
    hierarchyLevel: 'SITE' | 'SEGMENT' | 'STANDALONE' | null,
  ): Promise<ToolTrace> {
    const hierNote = hierarchyLevel ? ` (${hierarchyLevel})` : '';
    const wanted = metrics.filter((m) => !m.startsWith('status_'));
    if (wanted.length === 0 && metrics[0]?.startsWith('status_')) {
      // Should be handled by status_count; fallback
      wanted.push(metrics[0]);
    }

    if (wanted.length === 1 && wanted[0] === 'overbudget_count') {
      const count = await this.prisma.financeProject.count({
        where: { ...baseWhere, isOverbudget: true },
      });
      return {
        name: 'finance_analytics',
        ok: true,
        summary: `Over Budget – ${count} Project${hierNote}`,
        data: { metric: 'overbudget_count', count },
      };
    }

    const needAgg = wanted.some((m) => m !== 'overbudget_count');
    let totalBudget = 0;
    let materialBudget = 0;
    let jasaBudget = 0;
    let realized = 0;
    let remaining = 0;
    let count = 0;
    if (needAgg) {
      const agg = await this.prisma.financeProject.aggregate({
        where: baseWhere,
        _sum: {
          totalBudget: true,
          materialBudget: true,
          jasaBudget: true,
          materialSpent: true,
          jasaSpent: true,
        },
        _count: true,
      });
      totalBudget = Number(agg._sum.totalBudget ?? 0);
      materialBudget = Number(agg._sum.materialBudget ?? 0);
      jasaBudget = Number(agg._sum.jasaBudget ?? 0);
      realized =
        Number(agg._sum.materialSpent ?? 0) + Number(agg._sum.jasaSpent ?? 0);
      remaining = totalBudget - realized;
      count = agg._count;
    }

    let overCount: number | null = null;
    if (wanted.includes('overbudget_count')) {
      overCount = await this.prisma.financeProject.count({
        where: { ...baseWhere, isOverbudget: true },
      });
    }

    const lineFor = (metric: FinanceMetric): string | null => {
      switch (metric) {
        case 'material_budget':
          return `Material Budget${hierNote} – ${fmtIdr(materialBudget)} (${count} project)`;
        case 'jasa_budget':
          return `Jasa Budget${hierNote} – ${fmtIdr(jasaBudget)} (${count} project)`;
        case 'realization':
          return `Total Realisasi${hierNote} – ${fmtIdr(realized)} (${count} project)`;
        case 'remaining':
          return `Remaining Budget${hierNote} – ${fmtIdr(remaining)} (${count} project)`;
        case 'total_budget':
          return `Total Budget${hierNote} – ${fmtIdr(totalBudget)} (${count} project)`;
        case 'overbudget_count':
          return `Over Budget – ${overCount ?? 0} Project${hierNote}`;
        default:
          return null;
      }
    };

    const lines = wanted.map(lineFor).filter((x): x is string => Boolean(x));
    return {
      name: 'finance_analytics',
      ok: true,
      summary:
        lines.join('\n') ||
        `Metric tersedia untuk ${count} project${hierNote}`,
      data: {
        metrics: wanted,
        metric: wanted[0],
        count,
        totalBudget,
        materialBudget,
        jasaBudget,
        realized,
        remaining,
        overCount,
      },
    };
  }

  /** PAI-FNC-004: dynamic ranking by metric + direction + Top N. */
  private async financeRankingList(
    baseWhere: Prisma.FinanceProjectWhereInput,
    rankingMetric: FinanceRankingMetric,
    dir: 'asc' | 'desc',
    hierarchyLevel: 'SITE' | 'SEGMENT' | 'STANDALONE' | null,
    limit = 10,
  ): Promise<ToolTrace> {
    const where: Prisma.FinanceProjectWhereInput = {
      ...baseWhere,
      ...(rankingMetric === 'overbudget' ? { isOverbudget: true } : {}),
    };
    const scalarOrder: Prisma.FinanceProjectOrderByWithRelationInput | undefined =
      rankingMetric === 'totalBudget'
        ? { totalBudget: dir }
        : rankingMetric === 'materialBudget'
          ? { materialBudget: dir }
          : rankingMetric === 'jasaBudget'
            ? { jasaBudget: dir }
            : undefined;
    let rows = await this.prisma.financeProject.findMany({
      where,
      select: {
        code: true,
        name: true,
        totalBudget: true,
        materialBudget: true,
        jasaBudget: true,
        materialSpent: true,
        jasaSpent: true,
        status: true,
        hierarchyLevel: true,
        isOverbudget: true,
      },
      ...(scalarOrder ? { orderBy: scalarOrder } : {}),
      take: 80,
    });
    // PAI-FNC-004: if a leftover ACTIVE default yielded zero rows and the user
    // did not name SITE/SEGMENT, retry the non-ARCHIVED Finance dataset.
    const statusIsScalar = typeof where.status === 'string';
    if (rows.length === 0 && !hierarchyLevel && statusIsScalar) {
      rows = await this.prisma.financeProject.findMany({
        where: {
          ...where,
          status: { not: 'ARCHIVED' },
        },
        select: {
          code: true,
          name: true,
          totalBudget: true,
          materialBudget: true,
          jasaBudget: true,
          materialSpent: true,
          jasaSpent: true,
          status: true,
          hierarchyLevel: true,
          isOverbudget: true,
        },
        ...(scalarOrder ? { orderBy: scalarOrder } : {}),
        take: 80,
      });
    }
    if (rows.length === 0) {
      return {
        name: 'finance_analytics',
        ok: true,
        summary: 'Belum ada Finance Project yang cocok untuk ranking.',
      };
    }

    const scored = rows.map((r) => {
      const totalBudget = Number(r.totalBudget);
      const materialBudget = Number(r.materialBudget ?? 0);
      const jasaBudget = Number(r.jasaBudget ?? 0);
      const realization = Number(r.materialSpent) + Number(r.jasaSpent);
      const remaining = totalBudget - realization;
      const overAmount = Math.max(0, realization - totalBudget);
      let sortValue = totalBudget;
      if (rankingMetric === 'realization') sortValue = realization;
      else if (rankingMetric === 'remaining') sortValue = remaining;
      else if (rankingMetric === 'materialBudget') sortValue = materialBudget;
      else if (rankingMetric === 'jasaBudget') sortValue = jasaBudget;
      else if (rankingMetric === 'overbudget') sortValue = overAmount;
      return {
        r,
        sortValue,
        totalBudget,
        realization,
        remaining,
        materialBudget,
        jasaBudget,
        overAmount,
      };
    });
    scored.sort((a, b) =>
      dir === 'desc' ? b.sortValue - a.sortValue : a.sortValue - b.sortValue,
    );
    const n = Math.max(1, Math.min(50, limit || 10));
    const top = scored.slice(0, n);
    const hierLabel = hierarchyLevel ? ` (${hierarchyLevel} saja)` : '';
    const metricLabel: Record<FinanceRankingMetric, string> = {
      totalBudget: 'Total Budget',
      realization: 'Realisasi',
      remaining: 'Sisa Budget',
      materialBudget: 'Material Budget',
      jasaBudget: 'Jasa Budget',
      overbudget: 'Over Budget',
    };
    const dirLabel = dir === 'desc' ? 'terbesar' : 'terkecil';
    const title = `Top ${n} Finance Project — ${metricLabel[rankingMetric]} ${dirLabel}${hierLabel}`;
    const lines = top.map((item, i) => {
      const val =
        rankingMetric === 'realization'
          ? item.realization
          : rankingMetric === 'remaining'
            ? item.remaining
            : rankingMetric === 'materialBudget'
              ? item.materialBudget
              : rankingMetric === 'jasaBudget'
                ? item.jasaBudget
                : rankingMetric === 'overbudget'
                  ? item.overAmount
                  : item.totalBudget;
      // Include Realisasi + Status so Active Object attribute follow-ups
      // (CSM-002) resolve from the dataset without a live re-query.
      return `${i + 1}. ${item.r.code} ${item.r.name} — ${fmtIdr(val)} (budget ${fmtIdr(item.totalBudget)}; realisasi ${fmtIdr(item.realization)}; status ${item.r.status}) [${item.r.hierarchyLevel}]`;
    });
    return {
      name: 'finance_analytics',
      ok: true,
      summary: [title, ...lines, `Data per ${fmtDateId()}.`].join('\n'),
      data: { rankingMetric, dir, limit: n, rows: top.map((t) => t.r) },
    };
  }

  private async pendingFundApprovals(user: AuthUser): Promise<ToolTrace> {
    const canSeeAll = this.canSeeAllFinance(user.role) || user.role === 'PURCHASING';
    const where: Prisma.CashOperationRequestWhereInput = {
      status: { in: ['SUBMITTED', 'IN_REVIEW', 'APPROVED'] },
      ...(canSeeAll ? {} : { requestedBy: user.userId }),
    };
    const rows = await this.prisma.cashOperationRequest.findMany({
      where,
      select: {
        requestNumber: true,
        status: true,
        amount: true,
        description: true,
        currentApproverRole: true,
        requester: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    if (rows.length === 0) {
      return {
        name: 'pending_fund_approvals',
        ok: true,
        summary: 'Tidak ada pengajuan dana yang masih pending di scope kamu.',
      };
    }
    const lines = rows.map(
      (r) =>
        `• ${r.requestNumber} — ${fmtIdr(Number(r.amount))} — ${r.status}` +
        `${r.currentApproverRole ? ` (menunggu ${r.currentApproverRole})` : ''}` +
        ` — ${r.requester.name}: ${r.description.slice(0, 80)}`,
    );
    return {
      name: 'pending_fund_approvals',
      ok: true,
      summary: [
        `Approval / pengajuan dana yang masih jalan (${rows.length})`,
        ...lines,
        `Per ${fmtDateId()}.`,
      ].join('\n'),
      data: rows,
    };
  }

  private async countSuppliers(user: AuthUser): Promise<ToolTrace> {
    if (
      ![
        'GENERAL_MANAGER',
        'FINANCE',
        'PURCHASING',
        'ADMIN',
        'ADMIN_STOCK',
        'OPERATIONAL_MANAGER',
        'PM_SENIOR',
      ].includes(user.role) &&
      !user.role.startsWith('PM_')
    ) {
      return {
        name: 'count_suppliers',
        ok: true,
        summary: 'Role kamu tidak punya akses data supplier.',
      };
    }
    const total = await this.prisma.supplier.count();
    return {
      name: 'count_suppliers',
      ok: true,
      summary: `Total supplier terdaftar: ${total}.`,
      data: { total },
    };
  }

  private canSeeAllClusters(role: string): boolean {
    return [
      'GENERAL_MANAGER',
      'PM_SENIOR',
      'ADMIN',
      'OPERATIONAL_MANAGER',
    ].includes(role);
  }

  private async lastFundDisbursement(user: AuthUser): Promise<ToolTrace> {
    const canSeeAll = [
      'GENERAL_MANAGER',
      'FINANCE',
      'OPERATIONAL_MANAGER',
      'PM_SENIOR',
      'ADMIN',
      'PURCHASING',
      'MARKETING_HEAD',
    ].includes(user.role);

    const cashWhere: Prisma.CashOperationRequestWhereInput = {
      disbursedAt: { not: null },
      ...(canSeeAll ? {} : { requestedBy: user.userId }),
    };

    const [cash, fttt] = await Promise.all([
      this.prisma.cashOperationRequest.findFirst({
        where: cashWhere,
        orderBy: { disbursedAt: 'desc' },
        select: {
          requestNumber: true,
          type: true,
          description: true,
          amount: true,
          disbursedAmount: true,
          finalApprovedAmount: true,
          status: true,
          disbursedAt: true,
          category: true,
          projectRef: true,
          requester: { select: { name: true, email: true, role: true } },
          financeProject: { select: { code: true, name: true } },
        },
      }),
      canSeeAll || user.role.startsWith('PM_') || user.role.includes('FTTT')
        ? this.prisma.ftttTransaction.findFirst({
            where: { disbursedAt: { not: null } },
            orderBy: { disbursedAt: 'desc' },
            select: {
              id: true,
              aktivitas: true,
              remarks: true,
              reason: true,
              total: true,
              category: true,
              disbursedAt: true,
              requestStatus: true,
              createdBy: { select: { name: true, email: true } },
              ftttProject: { select: { id: true, projectName: true } },
              financeProject: { select: { code: true, name: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    const fmt = (n: number) =>
      new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(n);

    const fmtDt = (d: Date) =>
      new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      }).format(d);

    type Candidate = { at: Date; summary: string; data: unknown };
    const candidates: Candidate[] = [];

    if (cash?.disbursedAt) {
      const nominal = Number(
        cash.disbursedAmount ??
          cash.finalApprovedAmount ??
          cash.amount ??
          0,
      );
      candidates.push({
        at: cash.disbursedAt,
        summary: [
          `Dana terakhir keluar dari Cash Operation:`,
          `• No. transaksi: ${cash.requestNumber}`,
          `• Tanggal cair: ${fmtDt(cash.disbursedAt)} WIB`,
          `• Nominal: ${fmt(nominal)}`,
          `• Tipe: ${cash.type}`,
          `• Status: ${cash.status}`,
          `• Pengaju: ${cash.requester.name} (${cash.requester.role})`,
          `• Deskripsi: ${cash.description}`,
          cash.financeProject
            ? `• Finance Project: ${cash.financeProject.code} — ${cash.financeProject.name}`
            : cash.projectRef
              ? `• Project ref: ${cash.projectRef}`
              : null,
          cash.category ? `• Kategori: ${cash.category}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        data: {
          source: 'cash_operation',
          ...cash,
          amount: cash.amount?.toString?.(),
          disbursedAmount: cash.disbursedAmount?.toString?.(),
          finalApprovedAmount: cash.finalApprovedAmount?.toString?.(),
        },
      });
    }

    if (fttt?.disbursedAt) {
      candidates.push({
        at: fttt.disbursedAt,
        summary: [
          `Dana terakhir keluar dari FTTT Financial Request (Dana Keluar):`,
          `• No. transaksi: ${fttt.id}`,
          `• Tanggal cair: ${fmtDt(fttt.disbursedAt)} WIB`,
          `• Nominal: ${fmt(Number(fttt.total))}`,
          `• Aktivitas: ${fttt.aktivitas}`,
          `• Kategori: ${fttt.category}`,
          `• Status: ${fttt.requestStatus}`,
          `• Pengaju: ${fttt.createdBy.name}`,
          `• Proyek FTTT: ${fttt.ftttProject.projectName || fttt.ftttProject.id}`,
          fttt.financeProject
            ? `• Finance Project: ${fttt.financeProject.code} — ${fttt.financeProject.name}`
            : null,
          `• Keterangan: ${fttt.remarks || fttt.reason || '-'}`,
        ]
          .filter(Boolean)
          .join('\n'),
        data: {
          source: 'fttt_transaction',
          ...fttt,
          total: fttt.total?.toString?.(),
        },
      });
    }

    if (candidates.length === 0) {
      return {
        name: 'last_fund_disbursement',
        ok: true,
        summary:
          'Tidak ditemukan pencairan dana (Cash Operation / FTTT Dana Keluar) di database untuk scope Anda.',
        data: { found: false },
      };
    }

    candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
    const latest = candidates[0];
    return {
      name: 'last_fund_disbursement',
      ok: true,
      summary: latest.summary,
      data: latest.data,
    };
  }

  private async explainFinanceProject(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    if (!this.canAccessFinance(user.role)) {
      return {
        name: 'explain_finance_project',
        ok: true,
        summary:
          'Role kamu belum punya akses explain Finance Project. Buka menu Finance Projects jika tersedia.',
      };
    }
    const code = message.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i)?.[1];
    if (!code) {
      return {
        name: 'explain_finance_project',
        ok: false,
        summary: 'Sebutkan kode project (SITE/SEG/FIN-YYYY-NNN) untuk 5-why faktual.',
      };
    }
    const scope: Prisma.FinanceProjectWhereInput = {
      status: { not: 'ARCHIVED' },
    };
    if (!this.canSeeAllFinance(user.role)) {
      scope.createdById = user.userId;
    }
    const rows = await this.prisma.financeProject.findMany({
      where: scope,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        hierarchyLevel: true,
        totalBudget: true,
        materialBudget: true,
        jasaBudget: true,
        materialSpent: true,
        jasaSpent: true,
        isOverbudget: true,
        poCustomerNumber: true,
        poApprovalStatus: true,
        parent: { select: { code: true } },
      },
      take: 40,
    });
    const r = rows.find((x) => x.code.toUpperCase() === code.toUpperCase());
    if (!r) {
      return {
        name: 'explain_finance_project',
        ok: true,
        summary: `Project ${code.toUpperCase()} tidak ditemukan di data live / scope akses Anda.`,
      };
    }

    let ledgerNotes: string[] = [];
    try {
      const ledger = await this.prisma.budgetLedger.findMany({
        where: {
          financeProjectId: r.id,
          notes: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { notes: true, entryType: true, amount: true },
      });
      ledgerNotes = ledger
        .map((l) =>
          l.notes
            ? `${l.entryType} ${fmtIdr(Number(l.amount))}: ${l.notes}`.slice(0, 120)
            : '',
        )
        .filter(Boolean);
    } catch {
      ledgerNotes = [];
    }

    let cashPendingCount = 0;
    let cashLatestStatus: string | null = null;
    try {
      const cash = await this.prisma.cashOperationRequest.findMany({
        where: {
          financeProjectId: r.id,
          status: { in: ['SUBMITTED', 'IN_REVIEW', 'APPROVED'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { status: true },
      });
      cashPendingCount = cash.length;
      cashLatestStatus = cash[0]?.status ?? null;
    } catch {
      cashPendingCount = 0;
    }

    const pack: FinanceExplainPack = {
      code: r.code,
      name: r.name,
      status: r.status,
      hierarchyLevel: r.hierarchyLevel,
      totalBudget: Number(r.totalBudget),
      materialBudget: Number(r.materialBudget ?? 0),
      jasaBudget: Number(r.jasaBudget ?? 0),
      materialSpent: Number(r.materialSpent),
      jasaSpent: Number(r.jasaSpent),
      isOverbudget: r.isOverbudget,
      poCustomerNumber: r.poCustomerNumber,
      poApprovalStatus: r.poApprovalStatus,
      parentCode: r.parent?.code ?? null,
      ledgerNotes,
      cashPendingCount,
      cashLatestStatus,
    };
    return {
      name: 'explain_finance_project',
      ok: true,
      summary: buildFinanceWhyTemplate(pack, detectWhyFocus(message)),
      data: pack,
    };
  }

  private async explainPermitCluster(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    const where: Prisma.PermitClusterWhereInput = {};
    if (!this.canSeeAllClusters(user.role)) {
      if (user.role.startsWith('PM_')) {
        where.assignedPmId = user.userId;
      } else if (user.fiberType) {
        where.fiberType = user.fiberType;
      } else {
        return {
          name: 'explain_permit_cluster',
          ok: true,
          summary: buildClusterWhyTemplate({
            clusterCode: null,
            phase: null,
            status: null,
            daysSinceUpdate: null,
            holdNote: null,
          }),
        };
      }
    }
    const needle = message.match(/\b([A-Z0-9][A-Z0-9._-]{2,})\b/i)?.[1];
    const rows = await this.prisma.permitCluster.findMany({
      where,
      select: {
        id: true,
        clusterCode: true,
        currentPhase: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    const row =
      (needle
        ? rows.find((c) =>
            c.clusterCode.toUpperCase().includes(needle.toUpperCase()),
          )
        : null) ||
      rows.find((c) => c.status === 'ON_HOLD') ||
      rows[0] ||
      null;
    let holdNote: string | null = null;
    if (row) {
      try {
        const stages = await this.prisma.clusterStageProgress.findMany({
          where: { clusterId: row.id },
          select: { notes: true, status: true },
          take: 8,
        });
        holdNote =
          stages
            .filter((s) => s.notes)
            .map((s) => `${s.status}: ${s.notes}`)
            .join('; ') || null;
      } catch {
        holdNote = null;
      }
    }
    const days =
      row?.updatedAt != null
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(row.updatedAt).getTime()) / 86400000,
            ),
          )
        : null;
    return {
      name: 'explain_permit_cluster',
      ok: true,
      summary: buildClusterWhyTemplate({
        clusterCode: row?.clusterCode ?? null,
        phase: row?.currentPhase ?? null,
        status: row?.status ?? null,
        daysSinceUpdate: days,
        holdNote,
      }),
      data: row,
    };
  }

  private async countPermitClusters(user: AuthUser): Promise<ToolTrace> {
    const where: Prisma.PermitClusterWhereInput = {};
    if (!this.canSeeAllClusters(user.role)) {
      if (user.role.startsWith('PM_')) {
        where.assignedPmId = user.userId;
      } else if (user.fiberType) {
        where.fiberType = user.fiberType;
      } else {
        return {
          name: 'count_permit_clusters',
          ok: true,
          summary:
            'Role Anda tidak memiliki ringkasan cluster global. Buka menu Permit Clusters.',
          data: { scoped: false },
        };
      }
    }
    const [total, inProgress, completed, onHold] = await Promise.all([
      this.prisma.permitCluster.count({ where }),
      this.prisma.permitCluster.count({
        where: { ...where, status: 'IN_PROGRESS' },
      }),
      this.prisma.permitCluster.count({
        where: { ...where, status: 'COMPLETED' },
      }),
      this.prisma.permitCluster.count({
        where: { ...where, status: 'ON_HOLD' },
      }),
    ]);
    return {
      name: 'count_permit_clusters',
      ok: true,
      summary: `Permit cluster: total ${total} (IN_PROGRESS ${inProgress}, ON_HOLD ${onHold}, COMPLETED ${completed}).`,
      data: { total, inProgress, onHold, completed },
    };
  }

  private async myCashOperations(user: AuthUser): Promise<ToolTrace> {
    const openStatuses = [
      'DRAFT',
      'SUBMITTED',
      'IN_REVIEW',
      'APPROVED',
      'REALISASI_IN_PROGRESS',
      'REALISASI_PENDING_PM',
      'REALISASI_PENDING_OPS',
      'REALISASI_PENDING_MARKETING_HEAD',
      'REALISASI_PENDING_GM',
    ] as const;

    const where: Prisma.CashOperationRequestWhereInput =
      user.role === 'GENERAL_MANAGER' ||
      user.role === 'FINANCE' ||
      user.role === 'OPERATIONAL_MANAGER'
        ? { status: { in: [...openStatuses] } }
        : {
            requestedBy: user.userId,
            status: { in: [...openStatuses] },
          };

    const rows = await this.prisma.cashOperationRequest.findMany({
      where,
      select: {
        requestNumber: true,
        status: true,
        amount: true,
        description: true,
        currentApproverRole: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      name: 'my_cash_operations',
      ok: true,
      summary:
        rows.length === 0
          ? 'Tidak ada cash operation terbuka yang relevan untuk Anda.'
          : `Ditemukan ${rows.length} cash operation terbuka. Contoh: ${rows
              .slice(0, 3)
              .map((r) => `${r.requestNumber} (${r.status})`)
              .join(', ')}.`,
      data: rows.map((r) => ({
        ...r,
        amount: r.amount?.toString?.() ?? r.amount,
      })),
    };
  }

  private async myVisitRequests(user: AuthUser): Promise<ToolTrace> {
    const where: Prisma.VisitRequestWhereInput = user.role.startsWith(
      'SURVEYOR_',
    )
      ? { requestedBy: user.userId }
      : user.role.startsWith('PM_')
        ? { assignedPmId: user.userId }
        : this.canSeeAllClusters(user.role)
          ? {}
          : { requestedBy: user.userId };

    const open = await this.prisma.visitRequest.count({
      where: {
        ...where,
        status: { notIn: ['APPROVED', 'REJECTED', 'EXISTING_FIBER'] },
      },
    });
    const total = await this.prisma.visitRequest.count({ where });
    return {
      name: 'my_visit_requests',
      ok: true,
      summary: `Visit request dalam scope Anda: ${total} total, ${open} masih berjalan.`,
      data: { total, open },
    };
  }

  private async myPurchaseRequests(user: AuthUser): Promise<ToolTrace> {
    const where: Prisma.PurchaseRequestWhereInput =
      user.role === 'FINANCE' || user.role === 'PURCHASING' || user.role === 'GENERAL_MANAGER'
        ? { status: { in: ['PENDING', 'IN_REVIEW', 'APPROVED', 'ORDERED'] } }
        : {
            requestedBy: user.userId,
            status: { in: ['PENDING', 'IN_REVIEW', 'APPROVED', 'ORDERED'] },
          };
    const count = await this.prisma.purchaseRequest.count({ where });
    const recent = await this.prisma.purchaseRequest.findMany({
      where,
      select: { requestNumber: true, status: true, totalAmount: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return {
      name: 'my_purchase_requests',
      ok: true,
      summary:
        count === 0
          ? 'Tidak ada purchase request aktif di scope Anda.'
          : `${count} purchase request aktif. Contoh: ${recent
              .map((r) => `${r.requestNumber} (${r.status})`)
              .join(', ')}.`,
      data: recent.map((r) => ({
        ...r,
        totalAmount: r.totalAmount?.toString?.() ?? null,
      })),
    };
  }

  private async searchStock(user: AuthUser, message: string): Promise<ToolTrace> {
    const m = normalizeId(message);
    const lowest =
      /(paling sedikit|paling kecil|terendah|terkecil|lowest|min stock|hampir habis|sedikit)/.test(
        m,
      );
    const highest = /(paling banyak|paling besar|tertinggi|terbesar)/.test(m);

    const stop = new Set([
      'stok',
      'stock',
      'barang',
      'berapa',
      'cari',
      'cek',
      'qty',
      'jumlah',
      'yang',
      'untuk',
      'ada',
      'paling',
      'sedikit',
      'banyak',
      'kecil',
      'besar',
      'terendah',
      'tertinggi',
    ]);
    const tokens = message
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));

    const items = await this.prisma.stockItem.findMany({
      where: {
        isActive: true,
        ...(tokens.length && !lowest && !highest
          ? {
              OR: tokens.flatMap((t) => [
                { name: { contains: t, mode: 'insensitive' as const } },
                { code: { contains: t, mode: 'insensitive' as const } },
                { category: { contains: t, mode: 'insensitive' as const } },
              ]),
            }
          : {}),
      },
      select: {
        code: true,
        name: true,
        currentQty: true,
        unit: true,
        minStockQty: true,
        category: true,
      },
      take: lowest || highest ? 10 : 8,
      orderBy: lowest
        ? { currentQty: 'asc' }
        : highest
          ? { currentQty: 'desc' }
          : { name: 'asc' },
    });

    if (items.length === 0) {
      return {
        name: 'search_stock',
        ok: true,
        summary: 'Tidak ditemukan item stok yang cocok.',
      };
    }

    const title = lowest
      ? 'Stok paling sedikit (currentQty terendah)'
      : highest
        ? 'Stok paling banyak (currentQty tertinggi)'
        : 'Stok';
    const lines = items.map(
      (i, idx) =>
        `${idx + 1}. ${i.code} — ${i.name}: ${i.currentQty} ${i.unit}` +
        (i.minStockQty != null ? ` (min ${i.minStockQty})` : ''),
    );

    return {
      name: 'search_stock',
      ok: true,
      summary: [title, ...lines, `Data per ${fmtDateId()}.`].join('\n'),
      data: items,
    };
  }

  private async countFttt(user: AuthUser): Promise<ToolTrace> {
    const where: Prisma.FtttProjectWhereInput = {};
    if (user.role.startsWith('PM_FTTT') || user.role === 'SURVEYOR_FTTT') {
      // keep open filter — most FTTT models scope by assignment differently; count all active for privileged
    }
    if (
      !['GENERAL_MANAGER', 'PM_SENIOR', 'ADMIN', 'PM_FTTT', 'SURVEYOR_FTTT', 'OPERATIONAL_MANAGER'].includes(
        user.role,
      )
    ) {
      return {
        name: 'count_fttt_projects',
        ok: true,
        summary: 'Role Anda tidak memiliki akses ringkasan FTTT.',
      };
    }
    const total = await this.prisma.ftttProject.count({ where });
    return {
      name: 'count_fttt_projects',
      ok: true,
      summary: `Jumlah proyek FTTT terdaftar: ${total}.`,
      data: { total },
    };
  }

  private async dailySummary(user: AuthUser): Promise<ToolTrace> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [clustersToday, cashToday, prToday] = await Promise.all([
      this.prisma.permitCluster.count({
        where: { createdAt: { gte: start } },
      }),
      this.prisma.cashOperationRequest.count({
        where: {
          createdAt: { gte: start },
          ...(user.role === 'GENERAL_MANAGER' || user.role === 'FINANCE'
            ? {}
            : { requestedBy: user.userId }),
        },
      }),
      this.prisma.purchaseRequest.count({
        where: {
          createdAt: { gte: start },
          ...(user.role === 'FINANCE' || user.role === 'GENERAL_MANAGER'
            ? {}
            : { requestedBy: user.userId }),
        },
      }),
    ]);
    return {
      name: 'daily_summary',
      ok: true,
      summary: `Ringkasan hari ini: cluster baru ${clustersToday}, cash op ${cashToday}, purchase request ${prToday}.`,
      data: { clustersToday, cashToday, prToday },
    };
  }

  /** PIC / owner for finance project, clean-list, or permit cluster (PAI P1). */
  private async lookupProjectPic(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    const needle =
      extractProjectNeedle(message) ||
      extractSearchNeedle(message) ||
      message
        .replace(/siapa|pic|pm|penanggung jawab|project|proyek|owner|yang/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const lines: string[] = [];

    if (this.canAccessFinance(user.role) && needle) {
      const fpWhere: Prisma.FinanceProjectWhereInput = {
        status: { not: 'ARCHIVED' },
        OR: [
          { code: { contains: needle, mode: 'insensitive' } },
          { name: { contains: needle, mode: 'insensitive' } },
        ],
      };
      if (!this.canSeeAllFinance(user.role)) {
        fpWhere.createdById = user.userId;
      }
      const fps = await this.prisma.financeProject.findMany({
        where: fpWhere,
        select: {
          code: true,
          name: true,
          status: true,
          createdBy: { select: { name: true, email: true, role: true } },
        },
        take: 5,
        orderBy: { updatedAt: 'desc' },
      });
      for (const r of fps) {
        lines.push(
          `Finance ${r.code} — ${r.name}: PIC/owner = ${r.createdBy.name} (${r.createdBy.role}) [${r.status}]`,
        );
      }
    }

    if (needle) {
      const cleans = await this.prisma.cleanList.findMany({
        where: {
          OR: [
            { rwCode: { contains: needle, mode: 'insensitive' } },
            { ispCustomer: { contains: needle, mode: 'insensitive' } },
            { kelurahan: { contains: needle, mode: 'insensitive' } },
          ],
        },
        select: {
          rwCode: true,
          ispCustomer: true,
          picPermit: true,
          status: true,
        },
        take: 5,
      });
      for (const c of cleans) {
        lines.push(
          `CleanList ${c.rwCode} (${c.ispCustomer}): PIC Permit = ${c.picPermit || '(belum diisi)'} [${c.status}]`,
        );
      }

      const clusters = await this.prisma.permitCluster.findMany({
        where: {
          OR: [
            { clusterCode: { contains: needle, mode: 'insensitive' } },
            { ispCustomer: { contains: needle, mode: 'insensitive' } },
          ],
        },
        select: {
          clusterCode: true,
          ispCustomer: true,
          status: true,
          assignedPm: { select: { name: true, role: true } },
        },
        take: 5,
      });
      for (const c of clusters) {
        lines.push(
          `Cluster ${c.clusterCode} (${c.ispCustomer}): PM = ${c.assignedPm.name} (${c.assignedPm.role}) [${c.status}]`,
        );
      }
    }

    if (lines.length === 0) {
      return {
        name: 'lookup_project_pic',
        ok: true,
        summary: needle
          ? `Tidak ketemu PIC/PM untuk “${needle}”. Coba kode project/cluster yang lebih spesifik.`
          : 'Sebutkan kode/nama project atau cluster untuk saya cek PIC/PM-nya.',
      };
    }
    return {
      name: 'lookup_project_pic',
      ok: true,
      summary: [`PIC / penanggung jawab (data live)`, ...lines].join('\n'),
      data: { count: lines.length },
    };
  }

  private async lookupVisitRequestor(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    const needle =
      extractSearchNeedle(message) ||
      message
        .replace(/siapa|requestor|requester|pemohon|visit|request|yang/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const where: Prisma.VisitRequestWhereInput =
      user.role === 'GENERAL_MANAGER' ||
      user.role === 'ADMIN' ||
      user.role.startsWith('PM_')
        ? needle
          ? {
              OR: [
                { ispCustomer: { contains: needle, mode: 'insensitive' } },
                { cleanList: { rwCode: { contains: needle, mode: 'insensitive' } } },
              ],
            }
          : {}
        : { requestedBy: user.userId };

    const rows = await this.prisma.visitRequest.findMany({
      where,
      select: {
        id: true,
        status: true,
        ispCustomer: true,
        requester: { select: { name: true, role: true } },
        cleanList: { select: { rwCode: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    if (rows.length === 0) {
      return {
        name: 'lookup_visit_requestor',
        ok: true,
        summary: 'Tidak ada Visit Request yang cocok untuk cek requestor.',
      };
    }
    const lines = rows.map(
      (r) =>
        `Visit ${r.cleanList.rwCode || r.id.slice(0, 8)} (${r.ispCustomer}): requestor = ${r.requester.name} (${r.requester.role}) [${r.status}]`,
    );
    return {
      name: 'lookup_visit_requestor',
      ok: true,
      summary: ['Requestor Visit Request (data live)', ...lines].join('\n'),
      data: rows,
    };
  }

  private async lookupPrRequestor(
    user: AuthUser,
    message: string,
  ): Promise<ToolTrace> {
    const needle =
      extractSearchNeedle(message) ||
      message.match(/\b(PR[-\s]?\w+)\b/i)?.[1] ||
      '';
    const where: Prisma.PurchaseRequestWhereInput =
      user.role === 'GENERAL_MANAGER' ||
      user.role === 'FINANCE' ||
      user.role === 'ADMIN'
        ? needle
          ? { requestNumber: { contains: needle, mode: 'insensitive' } }
          : {}
        : { requestedBy: user.userId };

    const rows = await this.prisma.purchaseRequest.findMany({
      where,
      select: {
        requestNumber: true,
        status: true,
        requester: { select: { name: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
    if (rows.length === 0) {
      return {
        name: 'lookup_pr_requestor',
        ok: true,
        summary: 'Tidak ada Purchase Request yang cocok untuk cek requestor.',
      };
    }
    const lines = rows.map(
      (r) =>
        `${r.requestNumber}: requestor = ${r.requester.name} (${r.requester.role}) [${r.status}]`,
    );
    return {
      name: 'lookup_pr_requestor',
      ok: true,
      summary: ['Requestor Purchase Request (data live)', ...lines].join('\n'),
      data: rows,
    };
  }

  /** Phase 3 — gated action proposals (no silent writes). */
  detectActionProposal(message: string): {
    action: string;
    label: string;
  } | null {
    const m = message.toLowerCase();
    if (/(buat|create).*(visit request|kunjungan)/.test(m)) {
      return {
        action: 'open_clean_list',
        label: 'Buka Clean List untuk membuat Visit Request',
      };
    }
    if (/(buat|create).*(cash op|cash operation|pengajuan dana)/.test(m)) {
      return {
        action: 'open_cash_operation',
        label: 'Buka menu Cash Operation untuk membuat pengajuan',
      };
    }
    if (/(buat|create).*(purchase request|\bpr\b)/.test(m)) {
      return {
        action: 'open_purchase_request',
        label: 'Buka Purchase Request / Order untuk membuat PR',
      };
    }
    return null;
  }
}
