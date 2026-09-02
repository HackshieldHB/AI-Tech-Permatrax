/**
 * Committed conversation frame (PAI Phase 2).
 * Precedence: this-turn explicit → committed frame → default. No history scrape.
 */

import type { ActiveConstraintSet, ConversationSessionState } from './ai-session';
import { extractExplicitEntityCode } from './ai-reference';

export type ConversationGoal =
  | 'rank'
  | 'filter_list'
  | 'search'
  | 'object_attr'
  | 'aggregate'
  | 'diagnostic'
  | 'none';

export type RankingFrame = {
  metric: string | null;
  dir: 'asc' | 'desc' | null;
  limit: number | null;
};

export type ConversationFrame = {
  goal: ConversationGoal;
  ranking: RankingFrame;
  filters: {
    status: ActiveConstraintSet['status'];
    hierarchy: ActiveConstraintSet['hierarchy'];
  };
  activeObjectCode: string | null;
  pending: ConversationSessionState['pendingCandidates'];
};

export const EMPTY_FRAME: ConversationFrame = {
  goal: 'none',
  ranking: { metric: null, dir: null, limit: null },
  filters: { status: null, hierarchy: null },
  activeObjectCode: null,
  pending: null,
};

export function normalizeConversationFrame(
  raw: Partial<ConversationFrame> | null | undefined,
): ConversationFrame {
  return {
    goal: raw?.goal ?? 'none',
    ranking: {
      metric: raw?.ranking?.metric ?? null,
      dir: raw?.ranking?.dir ?? null,
      limit: raw?.ranking?.limit ?? null,
    },
    filters: {
      status: raw?.filters?.status ?? null,
      hierarchy: raw?.filters?.hierarchy ?? null,
    },
    activeObjectCode: raw?.activeObjectCode ?? null,
    pending: raw?.pending ?? null,
  };
}

/** Copy committed ranking into constraint extras when extras were lost. */
export function hydrateConstraintsFromFrame(
  constraints: ActiveConstraintSet,
  frame: ConversationFrame | null | undefined,
): ActiveConstraintSet {
  if (!frame) return constraints;
  const extra = [...(constraints.extra || [])];
  if (frame.ranking.metric && !extra.some((e) => e.startsWith('metric:'))) {
    extra.push(`metric:${frame.ranking.metric}`);
  }
  if (
    frame.ranking.limit &&
    Number.isFinite(frame.ranking.limit) &&
    !extra.some((e) => e.startsWith('limit:'))
  ) {
    extra.push(`limit:${frame.ranking.limit}`);
  }
  let ranking = constraints.ranking ?? null;
  if (!ranking && frame.ranking.dir === 'asc') ranking = 'smallest';
  if (!ranking && frame.ranking.dir === 'desc') ranking = 'top';
  return {
    ...constraints,
    status: constraints.status ?? frame.filters.status ?? null,
    hierarchy: constraints.hierarchy ?? frame.filters.hierarchy ?? null,
    ranking,
    extra,
  };
}

export function applyFramePrecedence(input: {
  utteranceConstraints: ActiveConstraintSet;
  committed: ConversationFrame;
}): ConversationFrame {
  const incoming = input.utteranceConstraints;
  const c = input.committed;
  const incomingMetric = incoming.extra?.find((e) => e.startsWith('metric:'));
  const incomingLimit = incoming.extra?.find((e) => e.startsWith('limit:'));
  let goal: ConversationGoal = c.goal;
  if (incoming.ranking === 'top' || incoming.ranking === 'smallest') {
    goal = 'rank';
  } else if (incoming.projectNeedle) {
    goal = 'search';
  } else if (incoming.status || incoming.hierarchy) {
    goal = 'filter_list';
  }
  return {
    goal,
    ranking: {
      metric: incomingMetric
        ? incomingMetric.replace('metric:', '')
        : c.ranking.metric,
      dir:
        incoming.ranking === 'smallest'
          ? 'asc'
          : incoming.ranking === 'top'
            ? 'desc'
            : c.ranking.dir,
      limit: incomingLimit
        ? Number(incomingLimit.replace('limit:', ''))
        : c.ranking.limit,
    },
    filters: {
      status: incoming.status ?? c.filters.status,
      hierarchy: incoming.hierarchy ?? c.filters.hierarchy,
    },
    activeObjectCode: c.activeObjectCode,
    pending: c.pending,
  };
}

export function inferConversationGoal(input: {
  diagnostic: boolean;
  rankedList: boolean;
  candidateSet: boolean;
  pendingCount: number;
  hasRanking: boolean;
  filterOnly: boolean;
  aggregate: boolean;
  objectCode: string | null;
  previousGoal: ConversationGoal;
}): ConversationGoal {
  if (input.diagnostic) return 'diagnostic';
  if (input.candidateSet || input.pendingCount > 1) return 'search';
  if (input.rankedList) return 'rank';
  if (input.filterOnly) return 'filter_list';
  if (input.aggregate) return 'aggregate';
  if (input.objectCode) return 'object_attr';
  if (input.hasRanking) return 'rank';
  return input.previousGoal || 'none';
}

export function commitConversationFrame(
  state: ConversationSessionState,
  goal: ConversationGoal,
): ConversationFrame {
  const extra = state.constraints.extra || [];
  const metricExtra = extra.find((e) => e.startsWith('metric:'));
  const limitExtra = extra.find((e) => e.startsWith('limit:'));
  const prev = normalizeConversationFrame(state.frame);
  const dir: RankingFrame['dir'] =
    state.constraints.ranking === 'smallest'
      ? 'asc'
      : state.constraints.ranking === 'top'
        ? 'desc'
        : prev.ranking.dir;
  const limit = limitExtra
    ? Number(limitExtra.replace('limit:', ''))
    : prev.ranking.limit;
  return {
    goal,
    ranking: {
      metric: metricExtra
        ? metricExtra.replace('metric:', '')
        : goal === 'aggregate'
          ? null
          : prev.ranking.metric,
      dir: goal === 'aggregate' ? null : dir,
      limit:
        goal === 'aggregate'
          ? null
          : Number.isFinite(limit)
            ? limit
            : null,
    },
    filters: {
      status: state.constraints.status ?? null,
      hierarchy: state.constraints.hierarchy ?? null,
    },
    activeObjectCode:
      extractExplicitEntityCode(state.activeObject || '') ||
      extractExplicitEntityCode(state.activeReference || '') ||
      prev.activeObjectCode,
    pending: state.pendingCandidates,
  };
}
