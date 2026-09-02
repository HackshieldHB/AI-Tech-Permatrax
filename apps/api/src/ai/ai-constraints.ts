/** Constraint extraction / merge for PAI recovery refinement (P0). */

import {
  normalizeId,
  extractOwnerName,
  extractProjectNeedle,
  hasExplicitRankingMetric,
  detectExplicitTopN,
  detectRankingDirection,
  isFinanceFilterClearQuery,
  isFinanceFilterRemoveQuery,
  isResultSetNarrowingQuery,
  isModuleDataRankingQuery,
  isRankingPatchFollowUp,
} from './ai-nlu';
import type { ActiveConstraintSet } from './ai-session';
import { EMPTY_CONSTRAINTS } from './ai-session';

/** Pull structured constraints from a user utterance. */
export function extractConstraintsFromText(text: string): ActiveConstraintSet {
  const m = normalizeId(text);
  const out: ActiveConstraintSet = { ...EMPTY_CONSTRAINTS, extra: [] };

  if (isFinanceFilterClearQuery(text)) {
    out.extra = ['op:clear'];
    return out;
  }

  if (isFinanceFilterRemoveQuery(text)) {
    if (/\b(site|segment|standalone)\b/.test(m) && !/(site-\d|website)/.test(m)) {
      out.extra!.push('drop:hierarchy');
    }
    if (/\b(active|aktif|closed|archived|arsip|status)\b/.test(m)) {
      out.extra!.push('drop:status');
    }
    return out;
  }

  if (/\b(aktif|active)\b/.test(m) && !/(non.?arsip|seluruh|semua|closed|archived)/.test(m)) {
    out.status = 'ACTIVE';
  } else if (/(non.?arsip|non.?archived|active\s*\+\s*closed)/.test(m)) {
    out.status = 'NON_ARCHIVED';
  } else if (/\b(closed|ditutup)\b/.test(m)) {
    out.status = 'CLOSED';
  } else if (/\b(archived|arsip)\b/.test(m)) {
    out.status = 'ARCHIVED';
  }

  // PAI-FNC-005: hierarchy from bare SITE/SEGMENT (+ status/filter).
  // Candidate disambiguation ("Yang SEGMENT") must not become a global filter.
  if (!isResultSetNarrowingQuery(text)) {
    if (/\b(site)\b/.test(m) && !/(site-\d|website)/.test(m)) {
      out.hierarchy = 'SITE';
    } else if (/\b(segment)\b/.test(m)) {
      out.hierarchy = 'SEGMENT';
    } else if (/\b(standalone)\b/.test(m)) {
      out.hierarchy = 'STANDALONE';
    }
  }

  const exclusiveSaja = /\bsaja\b/.test(m) || (/^\s*(sekarang|hanya)\b/.test(m) && /\bsaja\b/.test(m));
  if (exclusiveSaja && out.status && !out.hierarchy) {
    out.extra!.push('exclusive:status');
  }
  if (exclusiveSaja && out.hierarchy && !out.status) {
    out.extra!.push('exclusive:hierarchy');
  }

  const rankDir = detectRankingDirection(text);
  if (rankDir === 'desc') {
    out.ranking = 'top';
  } else if (rankDir === 'asc') {
    out.ranking = 'smallest';
  } else if (/(paling sedikit|hampir habis)/.test(m)) {
    out.ranking = 'lowest_stock';
  } else if (/(paling banyak|tertinggi)/.test(m) && /(stok|stock|barang)/.test(m)) {
    out.ranking = 'highest_stock';
  } else if (/\btop\s*\d+\b/.test(m) || /\branking\b/.test(m)) {
    out.ranking = 'top';
  }

  // PAI-FNC-004 V4: metric + Top-N attach to ranking utterances / patches
  // even when direction is inherited from the latest ranking state.
  const rankingTurn =
    out.ranking === 'top' ||
    out.ranking === 'smallest' ||
    isModuleDataRankingQuery(text) ||
    isRankingPatchFollowUp(text);
  if (rankingTurn) {
    if (/(over\s*budget|overbudget)/.test(m)) out.extra!.push('metric:overbudget');
    else if (/(sisa|remaining)/.test(m)) out.extra!.push('metric:remaining');
    else if (/(material)/.test(m)) out.extra!.push('metric:materialBudget');
    else if (/(jasa|service)/.test(m)) out.extra!.push('metric:jasaBudget');
    else if (/(realisasi|spent)/.test(m)) out.extra!.push('metric:realization');
    else if (/(budget|anggaran)/.test(m)) out.extra!.push('metric:totalBudget');
    const topN = detectExplicitTopN(text);
    if (topN) out.extra!.push(`limit:${topN}`);
  }

  const owner = extractOwnerName(text);
  if (owner) out.ownerName = owner;

  const needle = extractProjectNeedle(text);
  if (needle) out.projectNeedle = needle;

  return out;
}

/** Build a finance tool message from merged constraints + prior query. */
export function buildConstrainedFinanceQuery(
  constraints: ActiveConstraintSet,
  lastDataQuery?: string | null,
): string {
  const parts: string[] = [];
  // PAI Phase 2: ranking comes from the committed constraint frame only.
  const ranking = constraints.ranking || null;

  const limitHint = constraints.extra?.find((e) => e.startsWith('limit:'))?.replace(
    'limit:',
    '',
  );
  const n = limitHint && /^\d+$/.test(limitHint) ? limitHint : '10';
  const metricHint =
    constraints.extra?.find((e) => e.startsWith('metric:'))?.replace('metric:', '') ||
    '';
  const metricPhrase =
    metricHint === 'realization'
      ? 'realisasi'
      : metricHint === 'remaining'
        ? 'sisa budget'
        : metricHint === 'materialBudget'
          ? 'material budget'
          : metricHint === 'jasaBudget'
            ? 'jasa budget'
            : metricHint === 'overbudget'
              ? 'over budget'
              : 'budget';

  if (ranking === 'top') {
    parts.push(`Top ${n} Finance Project ${metricPhrase} terbesar`);
  } else if (ranking === 'smallest') {
    parts.push(`Top ${n} Finance Project ${metricPhrase} terkecil`);
  } else if (constraints.projectNeedle) {
    parts.push(`Budget project ${constraints.projectNeedle}`);
  } else if (constraints.status === 'CLOSED') {
    parts.push('Berapa CLOSED?');
  } else if (constraints.status === 'ARCHIVED') {
    parts.push('Berapa ARCHIVED?');
  } else {
    parts.push('Berapa nominal total budget project aktif saat ini?');
  }

  if (constraints.hierarchy) {
    parts.push(`berdasarkan ${constraints.hierarchy}`);
    parts.push(`[HIERARCHY_${constraints.hierarchy}]`);
  }
  if (constraints.status === 'ACTIVE' || !constraints.status) {
    parts.push('[SCOPE_ACTIVE]');
  } else if (constraints.status === 'CLOSED') {
    parts.push('[SCOPE_CLOSED]');
  } else if (constraints.status === 'ARCHIVED') {
    parts.push('[SCOPE_ARCHIVED]');
  } else if (constraints.status === 'NON_ARCHIVED') {
    parts.push('[BROADER_RETRY]');
  }
  if (constraints.ownerName) {
    parts.push(`milik ${constraints.ownerName}`);
  }
  return parts.join(' ');
}

/** Carry previous ranking metric only when this turn did not name a metric. */
export function appendInheritedRankingMetricTag(
  message: string,
  constraints: ActiveConstraintSet,
  text: string,
): string {
  if (/\[METRIC_/i.test(message)) return message;
  if (hasExplicitRankingMetric(text)) return message;
  const hint = constraints.extra?.find((e) => e.startsWith('metric:'));
  if (!hint) return message;
  const key = hint.replace('metric:', '');
  return `${message} [METRIC_${key}]`.trim();
}

/** Carry previous sort direction only when this turn did not name one. */
export function appendInheritedRankingDirectionTag(
  message: string,
  constraints: ActiveConstraintSet,
  text: string,
): string {
  if (/\[DIR_/i.test(message)) return message;
  if (detectRankingDirection(text) != null) return message;
  if (constraints.ranking === 'smallest') return `${message} [DIR_ASC]`.trim();
  if (constraints.ranking === 'top') return `${message} [DIR_DESC]`.trim();
  return message;
}

/** Carry previous Top-N only when this turn did not name a count. */
export function appendInheritedRankingLimitTag(
  message: string,
  constraints: ActiveConstraintSet,
  text: string,
): string {
  if (/\[LIMIT_/i.test(message)) return message;
  if (detectExplicitTopN(text) != null) return message;
  const hint = constraints.extra?.find((e) => e.startsWith('limit:'));
  if (!hint) return message;
  const n = hint.replace('limit:', '');
  return `${message} [LIMIT_${n}]`.trim();
}

/** Append constraint tags for first-pass finance tool calls (PAI-FNC-005). */
export function appendFinanceConstraintTags(
  message: string,
  constraints: ActiveConstraintSet,
): string {
  const tags: string[] = [];
  if (constraints.hierarchy && !/\[HIERARCHY_/i.test(message)) {
    tags.push(`[HIERARCHY_${constraints.hierarchy}]`);
  }
  if (constraints.status === 'ACTIVE' && !/\[SCOPE_ACTIVE\]/i.test(message)) {
    tags.push('[SCOPE_ACTIVE]');
  } else if (constraints.status === 'CLOSED' && !/\[SCOPE_CLOSED\]/i.test(message)) {
    tags.push('[SCOPE_CLOSED]');
  } else if (
    constraints.status === 'ARCHIVED' &&
    !/\[SCOPE_ARCHIVED\]/i.test(message)
  ) {
    tags.push('[SCOPE_ARCHIVED]');
  } else if (
    constraints.status === 'NON_ARCHIVED' &&
    !/\[SCOPE_NON_ARCHIVED\]/i.test(message)
  ) {
    tags.push('[SCOPE_NON_ARCHIVED]');
  }
  if (!tags.length) return message;
  return `${message} ${tags.join(' ')}`.trim();
}

/** Build stock tool message from constraints. */
export function buildConstrainedStockQuery(
  constraints: ActiveConstraintSet,
  lastDataQuery?: string | null,
): string {
  if (
    constraints.ranking === 'highest_stock' ||
    /(paling banyak)/i.test(lastDataQuery || '')
  ) {
    return 'Barang yang stoknya paling banyak';
  }
  return 'Barang yang stoknya paling sedikit';
}

/** Build cash / visit / PR refine queries. */
export function buildConstrainedDomainQuery(
  topic: string | null,
  constraints: ActiveConstraintSet,
  lastDataQuery?: string | null,
): string | null {
  if (topic === 'finance') {
    return buildConstrainedFinanceQuery(constraints, lastDataQuery);
  }
  if (topic === 'stock') {
    return buildConstrainedStockQuery(constraints, lastDataQuery);
  }
  if (topic === 'cash') {
    if (/(pending|approval|belum)/i.test(lastDataQuery || '') || constraints.extra?.includes('pending')) {
      return 'Berapa approval dana yang masih pending?';
    }
    return 'Kapan terakhir dana cair / disbursement?';
  }
  if (topic === 'visit') {
    return 'Berapa visit request saya yang masih open / status terbaru?';
  }
  if (topic === 'procurement') {
    return 'Berapa purchase request pending milik saya?';
  }
  return null;
}

export function hasUsableConstraint(c: ActiveConstraintSet): boolean {
  return !!(
    c.status ||
    c.hierarchy ||
    c.ranking ||
    c.ownerName ||
    c.projectNeedle ||
    (c.extra && c.extra.length)
  );
}
