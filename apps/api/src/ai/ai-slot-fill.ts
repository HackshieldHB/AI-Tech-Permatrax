/**
 * Optional LLM-assisted slot fill (PAI P3).
 * Enabled only when PAI_SLOT_FILL=1 (or true) AND Ollama is available.
 * Always falls back to heuristic extractConstraintsFromText.
 */

import { AiOllamaService } from './ai-ollama.service';
import { extractConstraintsFromText } from './ai-constraints';
import type { ActiveConstraintSet } from './ai-session';
import { EMPTY_CONSTRAINTS } from './ai-session';
import { extractHierarchyConstraint, normalizeId, isStandaloneFinanceAggregateQuery, isFinanceFilterOnlyQuery, isFinanceContextFilterQuery, isResultSetNarrowingQuery } from './ai-nlu';
import { fillEmptySlotsFromLlm, shouldAskFrameLlm } from './ai-frame-llm';

export function isSlotFillEnabled(): boolean {
  const v = (process.env.PAI_SLOT_FILL || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function parseSlotJson(raw: string): ActiveConstraintSet | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const status =
      typeof obj.status === 'string'
        ? (obj.status.toUpperCase() as ActiveConstraintSet['status'])
        : null;
    const hierarchy =
      typeof obj.hierarchy === 'string'
        ? (obj.hierarchy.toUpperCase() as ActiveConstraintSet['hierarchy'])
        : null;
    const ranking =
      typeof obj.ranking === 'string'
        ? (obj.ranking as ActiveConstraintSet['ranking'])
        : null;
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
      extra: Array.isArray(obj.extra)
        ? obj.extra.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Extract slots: heuristic first, optionally enriched by Ollama JSON fill.
 */
export async function extractSlots(
  text: string,
  ollama: AiOllamaService,
): Promise<{ constraints: ActiveConstraintSet; usedLlm: boolean }> {
  const heuristic = extractConstraintsFromText(text);
  // Never promote "Yang SEGMENT" candidate-picks into a global filter.
  if (!isResultSetNarrowingQuery(text)) {
    const hier = extractHierarchyConstraint(text);
    if (hier && !heuristic.hierarchy) heuristic.hierarchy = hier;
  }

  if (!isSlotFillEnabled()) {
    if (shouldAskFrameLlm(text, heuristic)) {
      return fillEmptySlotsFromLlm(text, heuristic, ollama);
    }
    return { constraints: heuristic, usedLlm: false };
  }

  // Skip LLM for very short / already-rich messages
  // PAI-FNC-001/002/005: never let slot-fill invent SITE/object on aggregate or filter-only
  const m = normalizeId(text);
  if (
    m.length < 8 ||
    hasUsableHeuristic(heuristic) ||
    isStandaloneFinanceAggregateQuery(text) ||
    isFinanceFilterOnlyQuery(text) ||
    isFinanceContextFilterQuery(text) ||
    isResultSetNarrowingQuery(text)
  ) {
    return { constraints: heuristic, usedLlm: false };
  }

  const system = [
    'Extract PermaTrax query slots as JSON only. Keys:',
    'status: ACTIVE|CLOSED|ARCHIVED|NON_ARCHIVED|null',
    'hierarchy: SITE|SEGMENT|STANDALONE|null',
    'ranking: top|smallest|lowest_stock|highest_stock|null',
    'ownerName: string|null',
    'projectNeedle: string|null',
    'extra: string[]',
    'No prose. Indonesian or English input.',
  ].join('\n');

  const { text: out, used } = await ollama.chat(system, text, 8000);
  if (!used || !out) return { constraints: heuristic, usedLlm: false };
  const parsed = parseSlotJson(out);
  if (!parsed) return { constraints: heuristic, usedLlm: false };

  return {
    constraints: {
      status: parsed.status ?? heuristic.status ?? null,
      hierarchy: parsed.hierarchy ?? heuristic.hierarchy ?? null,
      ranking: parsed.ranking ?? heuristic.ranking ?? null,
      ownerName: parsed.ownerName ?? heuristic.ownerName ?? null,
      projectNeedle: parsed.projectNeedle ?? heuristic.projectNeedle ?? null,
      extra: [
        ...new Set([...(heuristic.extra || []), ...(parsed.extra || [])]),
      ],
    },
    usedLlm: true,
  };
}

function hasUsableHeuristic(c: ActiveConstraintSet): boolean {
  return !!(c.status || c.hierarchy || c.ranking || c.ownerName || c.projectNeedle);
}
