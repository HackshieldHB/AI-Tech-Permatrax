/** Persisted conversation session state for PAI multi-turn consistency (V2–V7). */

import type { SessionTopic, UnknownKind } from './ai-nlu';
import { detectTopic, extractEntityFromAnswer, topicLabel } from './ai-nlu';

export type RetrievalStrategy =
  | 'summary'
  | 'search'
  | 'broader'
  | 'clarify'
  | 'recovery'
  | 'capability'
  | 'howto'
  | 'none';

/** What the user wants inside the active module (PAI-RSN-002 V4). */
export type ActiveIntent =
  | 'data'
  | 'analytics'
  | 'howto'
  | 'navigation'
  | 'meta'
  | 'clarify'
  | 'recovery'
  | 'capability'
  | 'none';

/** Explicit response strategy selected before answer generation (PAI P1). */
export type ResponseStrategy =
  | 'operational_data'
  | 'operational_analytics'
  | 'meta_reasoning'
  | 'unknown_information'
  | 'capability'
  | 'recovery'
  | 'clarification'
  | 'howto'
  | 'navigation'
  | 'failure'
  | 'refusal'
  | 'module_ack'
  | 'none';

/** Structured filters merged across recovery turns (PAI P0). */
export type ActiveConstraintSet = {
  status?: 'ACTIVE' | 'CLOSED' | 'ARCHIVED' | 'NON_ARCHIVED' | null;
  hierarchy?: 'SITE' | 'SEGMENT' | 'STANDALONE' | null;
  ranking?: 'top' | 'smallest' | 'lowest_stock' | 'highest_stock' | null;
  ownerName?: string | null;
  projectNeedle?: string | null;
  extra?: string[];
};

export type ConversationSessionState = {
  activeTopic: SessionTopic | null;
  /** Last project / entity under discussion */
  activeObject: string | null;
  /**
   * Active Reference snapshot — focused ranked object so attribute follow-ups
   * resolve without re-listing all rows.
   */
  activeReference: string | null;
  /**
   * Locked dataset identity (module + ranking + filters). Must not change
   * unless the user explicitly changes scope (PAI-CSM-002).
   */
  activeDataset: string | null;
  /** Snapshot of last ranked/list answer for offline ordinal/attribute resolve */
  activeDatasetAnswer: string | null;
  /** Last requested attribute on Active Object (status/realisasi/…) */
  activeAttribute: string | null;
  /** Intent within active module — preserved across follow-ups */
  activeIntent: ActiveIntent;
  /** Merged recovery / filter constraints */
  constraints: ActiveConstraintSet;
  /** Last operational question (for "yang tadi" / recovery refine) */
  lastDataQuery: string | null;
  lastStrategy: RetrievalStrategy;
  lastResponseStrategy: ResponseStrategy;
  lastFailureKind: UnknownKind | null;
  /** User correction applied — keep domain/recovery lane */
  correctionApplied: boolean;
  /** Awaiting user clarification after recovery */
  pendingRecovery: boolean;
  /** Last user-facing answer fingerprint (core data) */
  lastAnswerFp: string | null;
  /** Short note of how last answer was produced (meta reasoning) */
  lastReasoningNote: string | null;
};

export const EMPTY_CONSTRAINTS: ActiveConstraintSet = {
  status: null,
  hierarchy: null,
  ranking: null,
  ownerName: null,
  projectNeedle: null,
  extra: [],
};

export const EMPTY_SESSION: ConversationSessionState = {
  activeTopic: null,
  activeObject: null,
  activeReference: null,
  activeDataset: null,
  activeDatasetAnswer: null,
  activeAttribute: null,
  activeIntent: 'none',
  constraints: { ...EMPTY_CONSTRAINTS, extra: [] },
  lastDataQuery: null,
  lastStrategy: 'none',
  lastResponseStrategy: 'none',
  lastFailureKind: null,
  correctionApplied: false,
  pendingRecovery: false,
  lastAnswerFp: null,
  lastReasoningNote: null,
};

const SESSION_TOOL = '_session';

export function normalizeSessionState(
  raw: Partial<ConversationSessionState> | null | undefined,
): ConversationSessionState {
  const base = { ...EMPTY_SESSION, ...(raw || {}) };
  return {
    ...base,
    constraints: {
      ...EMPTY_CONSTRAINTS,
      ...(raw?.constraints || {}),
      extra: [...(raw?.constraints?.extra || [])],
    },
  };
}

export function encodeSessionInTraces(
  traces: Array<{ name: string; ok: boolean; summary: string; data?: unknown }>,
  state: ConversationSessionState,
): Array<{ name: string; ok: boolean; summary: string; data?: unknown }> {
  const without = traces.filter((t) => t.name !== SESSION_TOOL);
  return [
    ...without,
    {
      name: SESSION_TOOL,
      ok: true,
      summary: 'session',
      data: state,
    },
  ];
}

export function extractSessionFromHistory(
  messages: Array<{ role: string; content: string; toolTraces?: unknown }>,
): ConversationSessionState {
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const traces = msg.toolTraces;
    if (!Array.isArray(traces)) continue;
    for (const t of traces) {
      if (
        t &&
        typeof t === 'object' &&
        (t as { name?: string }).name === SESSION_TOOL &&
        (t as { data?: unknown }).data &&
        typeof (t as { data?: unknown }).data === 'object'
      ) {
        return normalizeSessionState(
          (t as { data: ConversationSessionState }).data,
        );
      }
    }
  }
  const lastAssistant = messages.find((m) => m.role === 'assistant');
  const lastUser = messages.find((m) => m.role === 'user');
  const topic =
    (lastUser ? detectTopic(lastUser.content) : null) ||
    (lastAssistant ? detectTopic(lastAssistant.content) : null);
  return normalizeSessionState({
    activeTopic: topic,
    activeObject: extractEntityFromAnswer(lastAssistant?.content ?? null),
  });
}

export function mergeSessionTopic(
  state: ConversationSessionState,
  nextTopic: SessionTopic | null,
  opts?: { force?: boolean; isReference?: boolean },
): ConversationSessionState {
  if (opts?.isReference) {
    return { ...state, activeTopic: state.activeTopic || nextTopic };
  }
  if (opts?.force && nextTopic) {
    return {
      ...state,
      activeTopic: nextTopic,
      correctionApplied: false,
      pendingRecovery: false,
      constraints: { ...EMPTY_CONSTRAINTS, extra: [] },
    };
  }
  if (nextTopic && !state.activeTopic) {
    return { ...state, activeTopic: nextTopic };
  }
  if (nextTopic && state.activeTopic && nextTopic !== state.activeTopic) {
    return { ...state, activeTopic: nextTopic };
  }
  return state;
}

export function sessionTopicHint(state: ConversationSessionState): string | null {
  return state.activeTopic ? topicLabel(state.activeTopic) : null;
}

/** Short follow-ups that must inherit active topic (no FAQ drift). */
export function isContextDependentFollowUp(text: string): boolean {
  const m = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!m) return false;
  if (
    /\b(yang tadi|tadi|tersebut|yang sebelumnya|project itu|yang barusan|itu dong|lanjut|terus)\b/.test(
      m,
    )
  ) {
    return true;
  }
  // PAI-FNC-001: status/metric aggregates are standalone intents, not soft follow-ups
  if (
    /^(berapa\s+)?(active|aktif|closed|archived|arsip)\??$/.test(m) ||
    /(berapa|jumlah).*(project|proyek).*(active|aktif|closed|archived)/.test(m) ||
    /(over\s*budget|overbudget)/.test(m) ||
    /^(material|jasa)(\s*budget)?\??$/.test(m) ||
    /^(sisa(\s*budget)?|realisasi|remaining)\??$/.test(m) ||
    /(total\s*)?(budget|anggaran|realisasi).*(berapa|jumlah)/.test(m) ||
    /(berapa|jumlah).*(total\s*)?(budget|anggaran|realisasi|sisa)/.test(m)
  ) {
    return false;
  }
  if (
    m.length <= 48 &&
    /^(berapa|brapa|budgetnya|statusnya|realisasinya|detail|yang mana|hitung|tampilkan|lagi|ulangi|material|sisa)/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

export function mergeConstraints(
  current: ActiveConstraintSet,
  incoming: ActiveConstraintSet,
): ActiveConstraintSet {
  const incomingHasMetric = (incoming.extra || []).some((e) =>
    e.startsWith('metric:'),
  );
  const incomingHasRanking = incoming.ranking != null;
  const extra =
    incomingHasRanking || incomingHasMetric
      ? [
          ...(current.extra || []).filter((e) => !e.startsWith('metric:')),
          ...(incoming.extra || []),
        ]
      : [...new Set([...(current.extra || []), ...(incoming.extra || [])])];
  return {
    status: incoming.status ?? current.status ?? null,
    hierarchy: incoming.hierarchy ?? current.hierarchy ?? null,
    ranking: incoming.ranking ?? current.ranking ?? null,
    ownerName: incoming.ownerName ?? current.ownerName ?? null,
    projectNeedle: incoming.projectNeedle ?? current.projectNeedle ?? null,
    extra,
  };
}
