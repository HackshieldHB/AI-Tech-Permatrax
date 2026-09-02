/**
 * PAI Phase 4 — optional Ollama as translator only.
 * Never chooses SQL filters. Never overrides this-turn heuristic slots.
 * Numbers in 5-why must remain extractive from Prisma.
 */

import { AiOllamaService } from './ai-ollama.service';
import type { ActiveConstraintSet } from './ai-session';
import { EMPTY_CONSTRAINTS } from './ai-session';
import {
  extractExplicitEntityCode,
  isCapabilityInquiry,
  isFinanceContextFilterQuery,
  isFinanceFilterOnlyQuery,
  isModuleDataRankingQuery,
  isRankingPatchFollowUp,
  isResultSetNarrowingQuery,
  isStandaloneFinanceAggregateQuery,
  normalizeId,
} from './ai-nlu';
import { isBusinessDiagnosticQuery } from './ai-strategy';
import type { FinanceExplainPack } from './ai-explain';

export function isFrameLlmEnabled(): boolean {
  const v = (process.env.PAI_FRAME_LLM || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function shouldAskFrameLlm(
  text: string,
  heuristic: ActiveConstraintSet,
): boolean {
  if (!isFrameLlmEnabled()) return false;
  if (isModuleDataRankingQuery(text) || isRankingPatchFollowUp(text)) {
    return false;
  }
  if (
    isFinanceFilterOnlyQuery(text) ||
    isFinanceContextFilterQuery(text) ||
    isResultSetNarrowingQuery(text) ||
    isStandaloneFinanceAggregateQuery(text)
  ) {
    return false;
  }
  if (isBusinessDiagnosticQuery(text) || isCapabilityInquiry(text)) {
    return false;
  }
  if (extractExplicitEntityCode(text)) return false;
  const m = normalizeId(text);
  if (m.length < 16) return false;
  if (
    heuristic.ranking ||
    heuristic.status ||
    heuristic.hierarchy ||
    heuristic.projectNeedle ||
    heuristic.ownerName
  ) {
    return false;
  }
  return true;
}

function parseSlotJson(raw: string): ActiveConstraintSet | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const status =
      typeof obj.status === 'string' ? obj.status.toUpperCase() : null;
    const hierarchy =
      typeof obj.hierarchy === 'string' ? obj.hierarchy.toUpperCase() : null;
    const ranking = typeof obj.ranking === 'string' ? obj.ranking : null;
    const extra = Array.isArray(obj.extra)
      ? obj.extra.filter((x): x is string => typeof x === 'string')
      : [];
    return {
      ...EMPTY_CONSTRAINTS,
      status:
        status === 'ACTIVE' ||
        status === 'CLOSED' ||
        status === 'ARCHIVED' ||
        status === 'NON_ARCHIVED'
          ? status
          : null,
      hierarchy:
        hierarchy === 'SITE' ||
        hierarchy === 'SEGMENT' ||
        hierarchy === 'STANDALONE'
          ? hierarchy
          : null,
      ranking:
        ranking === 'top' ||
        ranking === 'smallest' ||
        ranking === 'lowest_stock' ||
        ranking === 'highest_stock'
          ? ranking
          : null,
      ownerName: typeof obj.ownerName === 'string' ? obj.ownerName : null,
      projectNeedle:
        typeof obj.projectNeedle === 'string' ? obj.projectNeedle : null,
      extra,
    };
  } catch {
    return null;
  }
}

/** Heuristic non-null fields always win. LLM may only fill empties. */
export function mergeEmptySlotsOnly(
  heuristic: ActiveConstraintSet,
  parsed: ActiveConstraintSet,
): ActiveConstraintSet {
  const hExtra = heuristic.extra || [];
  const pExtra = (parsed.extra || []).filter(
    (e) =>
      !e.startsWith('metric:') &&
      !e.startsWith('limit:') &&
      !e.startsWith('op:') &&
      !e.startsWith('drop:'),
  );
  return {
    status: heuristic.status ?? parsed.status ?? null,
    hierarchy: heuristic.hierarchy ?? parsed.hierarchy ?? null,
    ranking: heuristic.ranking ?? parsed.ranking ?? null,
    ownerName: heuristic.ownerName ?? parsed.ownerName ?? null,
    projectNeedle: heuristic.projectNeedle ?? parsed.projectNeedle ?? null,
    extra: [...new Set([...hExtra, ...pExtra])],
  };
}

export async function fillEmptySlotsFromLlm(
  text: string,
  heuristic: ActiveConstraintSet,
  ollama: AiOllamaService,
): Promise<{ constraints: ActiveConstraintSet; usedLlm: boolean }> {
  const system = [
    'Map messy Indonesian PermaTrax chat to JSON slots only.',
    'Keys: status ACTIVE|CLOSED|ARCHIVED|NON_ARCHIVED|null, hierarchy SITE|SEGMENT|STANDALONE|null, ranking top|smallest|null, ownerName string|null, projectNeedle string|null, extra string[].',
    'Do not invent SITE/SEGMENT/ACTIVE if the user did not say them.',
    'Do not invent Top-N or ranking metric. extra must not include metric: or limit: unless the user named them.',
    'JSON only.',
  ].join(' ');
  const { text: out, used } = await ollama.chat(system, text, 8000);
  if (!used || !out) return { constraints: heuristic, usedLlm: false };
  const parsed = parseSlotJson(out);
  if (!parsed) return { constraints: heuristic, usedLlm: false };
  return {
    constraints: mergeEmptySlotsOnly(heuristic, parsed),
    usedLlm: true,
  };
}

function digitBlob(s: string): string {
  return s.replace(/[^\d]/g, '');
}

export function whyTemplatePreservesFacts(
  pack: FinanceExplainPack,
  text: string,
): boolean {
  if (!new RegExp(pack.code.replace(/-/g, '\\-'), 'i').test(text)) return false;
  if (!/Why1:/i.test(text) || !/Why2:/i.test(text) || !/Why3:/i.test(text)) {
    return false;
  }
  if (/Why4:/i.test(text)) return false;
  const spent = pack.materialSpent + pack.jasaSpent;
  const blob = digitBlob(text);
  const need = [
    digitBlob(String(Math.round(pack.totalBudget))),
    digitBlob(String(Math.round(spent))),
    digitBlob(String(Math.round(pack.materialSpent))),
    digitBlob(String(Math.round(pack.jasaSpent))),
  ].filter((n) => n.length >= 3);
  return need.every((n) => blob.includes(n));
}

export function whyProseIsSafe(original: string, llm: string): boolean {
  if (!llm.trim()) return false;
  if (/Why4:/i.test(llm)) return false;
  if (!/Why1:/i.test(llm) || !/Why2:/i.test(llm)) return false;
  const origNums = (original.match(/\d[\d.]*/g) || [])
    .map((n) => n.replace(/\./g, ''))
    .filter((n) => n.length >= 4);
  const blob = digitBlob(llm);
  return origNums.every((n) => blob.includes(n));
}

export async function polishWhyWithLlm(
  ollama: AiOllamaService,
  extractive: string,
  pack?: FinanceExplainPack | null,
): Promise<string> {
  if (!isFrameLlmEnabled() || !extractive) return extractive;
  const system = [
    'Tulis ulang 5-why PAI dalam Bahasa Indonesia yang rapi.',
    'WAJIB: salin SEMUA angka, kode project, Why1, Why2, Why3 persis dari input.',
    'JANGAN tambah Why4 atau Why5. JANGAN tambah angka baru. JANGAN tebak penyebab.',
    'Output teks saja.',
  ].join(' ');
  const { text: out, used } = await ollama.chat(system, extractive, 8000);
  if (!used || !out) return extractive;
  if (pack) {
    return whyTemplatePreservesFacts(pack, out) ? out : extractive;
  }
  return whyProseIsSafe(extractive, out) ? out : extractive;
}
