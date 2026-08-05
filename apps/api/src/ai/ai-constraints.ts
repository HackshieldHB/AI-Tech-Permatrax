/** Constraint extraction / merge for PAI recovery refinement (P0). */

import { normalizeId, extractOwnerName, extractProjectNeedle } from './ai-nlu';
import type { ActiveConstraintSet } from './ai-session';
import { EMPTY_CONSTRAINTS } from './ai-session';

/** Pull structured constraints from a user utterance. */
export function extractConstraintsFromText(text: string): ActiveConstraintSet {
  const m = normalizeId(text);
  const out: ActiveConstraintSet = { ...EMPTY_CONSTRAINTS, extra: [] };

  if (/\b(aktif|active)\b/.test(m) && !/(non.?arsip|seluruh|semua|closed)/.test(m)) {
    out.status = 'ACTIVE';
  } else if (/(non.?arsip|non.?archived|active\s*\+\s*closed)/.test(m)) {
    out.status = 'NON_ARCHIVED';
  } else if (/\b(closed|ditutup)\b/.test(m)) {
    out.status = 'CLOSED';
  } else if (/\b(archived|arsip)\b/.test(m)) {
    out.status = 'ARCHIVED';
  } else if (/(seluruh|semua)\b/.test(m) && /(project|finance|budget)/.test(m)) {
    out.status = 'NON_ARCHIVED';
  }

  if (/\b(site)\b/.test(m) && !/(site-\d|website)/.test(m)) {
    out.hierarchy = 'SITE';
  } else if (/\b(segment)\b/.test(m)) {
    out.hierarchy = 'SEGMENT';
  } else if (/\b(standalone)\b/.test(m)) {
    out.hierarchy = 'STANDALONE';
  }

  if (/(terbesar|top\s*\d*|ranking|paling besar)/.test(m)) {
    out.ranking = 'top';
  } else if (/(terkecil|paling kecil|paling rendah.*budget)/.test(m)) {
    out.ranking = 'smallest';
  } else if (/(paling sedikit|terendah|hampir habis)/.test(m)) {
    out.ranking = 'lowest_stock';
  } else if (/(paling banyak|tertinggi)/.test(m) && /(stok|stock|barang)/.test(m)) {
    out.ranking = 'highest_stock';
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
  const ranking =
    constraints.ranking ||
    (/(terbesar|top\s*\d*)/i.test(lastDataQuery || '') ? 'top' : null) ||
    (/(terkecil)/i.test(lastDataQuery || '') ? 'smallest' : null);

  if (ranking === 'top') {
    parts.push('Top 10 Finance Project budget terbesar');
  } else if (ranking === 'smallest') {
    parts.push('Top 10 Finance Project budget terkecil');
  } else if (constraints.projectNeedle) {
    parts.push(`Budget project ${constraints.projectNeedle}`);
  } else {
    parts.push('Berapa nominal total budget project aktif saat ini?');
  }

  if (constraints.hierarchy) {
    parts.push(`berdasarkan ${constraints.hierarchy}`);
    parts.push(`[HIERARCHY_${constraints.hierarchy}]`);
  }
  if (constraints.status === 'ACTIVE' || !constraints.status) {
    parts.push('[SCOPE_ACTIVE]');
  } else if (constraints.status === 'NON_ARCHIVED') {
    parts.push('[BROADER_RETRY]');
  }
  if (constraints.ownerName) {
    parts.push(`milik ${constraints.ownerName}`);
  }
  return parts.join(' ');
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
