/** Persisted conversation session state for PAI multi-turn consistency (V2–V7). */

import type { SessionTopic, UnknownKind } from './ai-nlu';
import { detectTopic, extractEntityFromAnswer, topicLabel } from './ai-nlu';
import { extractExplicitEntityCode } from './ai-reference';
import { normalizeId } from './ai-text';
import {
  EMPTY_FRAME,
  normalizeConversationFrame,
  type ConversationFrame,
} from './ai-frame';

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

export type ActiveResultMember = {
  code: string;
  name?: string;
  hierarchyLevel?: string;
  status?: string;
};

/** One analytically meaningful result set (PAI-DIQ-005/008 history). */
export type ResultSetSnapshot = {
  members: ActiveResultMember[];
  cardinality: number;
};

const CARDINALITY_WORDS: Record<string, number> = {
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
};

function memberKey(members: ActiveResultMember[] | null | undefined): string {
  return (members || []).map((m) => m.code.toUpperCase()).join('|');
}

export function rememberObjectCode(
  history: string[] | null | undefined,
  code: string | null | undefined,
  cap = 8,
): string[] {
  const u = extractExplicitEntityCode(code || '') || (code || '').toUpperCase();
  if (!u || !/^(SITE|SEG|FIN)-\d{4}-\d+$/.test(u)) {
    return [...(history || [])];
  }
  return [u, ...(history || []).filter((c) => c !== u)].slice(0, cap);
}

export function pushResultSetHistory(
  history: ResultSetSnapshot[] | null | undefined,
  members: ActiveResultMember[] | null | undefined,
  cap = 5,
): ResultSetSnapshot[] {
  if (!members?.length) return [...(history || [])];
  const snap: ResultSetSnapshot = {
    members: members.map((m) => ({ ...m })),
    cardinality: members.length,
  };
  const key = memberKey(snap.members);
  return [
    snap,
    ...(history || []).filter((h) => memberKey(h.members) !== key),
  ].slice(0, cap);
}

/** lima tadi / 5 tadi / daftar sebelumnya → matching historical set. */
export function extractResultSetCardinalityHint(
  text: string,
): number | 'previous' | null {
  const m = normalizeId(text);
  if (
    /(daftar|hasil).*(sebelumnya|yang pertama|pertama tadi)/.test(m) ||
    /(result set|daftar) (awal|asli)/.test(m)
  ) {
    return 'previous';
  }
  const word = m.match(
    /\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s+(tadi|itu|project|proyek)/,
  );
  if (word) return CARDINALITY_WORDS[word[1]];
  const digit = m.match(
    /\b(?:dari\s+)?(\d+)\s+(?:project|proyek)?\s*(tadi|itu)\b/,
  );
  if (digit) return Number(digit[1]);
  return null;
}

export function selectResultSetMembers(
  text: string,
  active: ActiveResultMember[] | null | undefined,
  history: ResultSetSnapshot[] | null | undefined,
): ActiveResultMember[] {
  const hint = extractResultSetCardinalityHint(text);
  const pool: ResultSetSnapshot[] = [
    ...(active?.length
      ? [{ members: active, cardinality: active.length }]
      : []),
    ...(history || []),
  ];
  if (hint === 'previous') {
    return history?.[0]?.members || active || [];
  }
  if (typeof hint === 'number') {
    const match = pool.find((s) => s.cardinality === hint);
    if (match?.members?.length) return match.members;
  }
  return active?.length ? active : [];
}

/** SEG yang tadi / project sebelumnya → known object, never a fuzzy type search. */
export function resolveReferencedObjectCode(
  text: string,
  session: {
    activeObject?: string | null;
    previousObject?: string | null;
    objectHistory?: string[] | null;
  },
): string | null {
  const mentioned = extractExplicitEntityCode(text);
  if (mentioned) return mentioned;
  const m = normalizeId(text);
  const prefix = /\bseg(ment)?\b/.test(m)
    ? 'SEG'
    : /\bfin\b/.test(m)
      ? 'FIN'
      : /\bsite\b/.test(m) && !/website/.test(m)
        ? 'SITE'
        : null;
  const current = extractExplicitEntityCode(session.activeObject || '');
  const codes = [
    extractExplicitEntityCode(session.previousObject || ''),
    ...(session.objectHistory || []),
    current,
  ].filter((c, i, arr): c is string => !!c && arr.indexOf(c) === i);
  if (prefix) {
    return (
      codes.find((c) => c.startsWith(prefix) && c !== current) ||
      codes.find((c) => c.startsWith(prefix)) ||
      null
    );
  }
  if (/(sebelumnya|yang tadi|barusan|yang pertama)/.test(m)) {
    return codes.find((c) => c !== current) || null;
  }
  return null;
}

/** Two-object compare lock so metric follow-ups do not become global ranking. */
export type ActiveComparisonScope = {
  objectA: string;
  objectB: string;
  metric:
    | 'totalBudget'
    | 'realization'
    | 'remaining'
    | 'materialBudget'
    | 'jasaBudget';
};

export type ConversationSessionState = {
  activeTopic: SessionTopic | null;
  /** Last project / entity under discussion */
  activeObject: string | null;
  /** Previous Active Object (for “SEG yang tadi” / compare). */
  previousObject: string | null;
  /** Recent resolved object codes (PAI-DIQ-006/008). */
  objectHistory: string[];
  /** Last ranked/list population — independent of Active Object (PAI-DIQ-008). */
  activeResultSet: ActiveResultMember[] | null;
  /** Prior result sets so “lima tadi” can recover a parent set (PAI-DIQ-005). */
  resultSetHistory: ResultSetSnapshot[];
  /** Pair currently being compared (PAI-DIQ-008 RT-04). */
  comparisonScope: ActiveComparisonScope | null;
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
  /**
   * Temporary Finance Project candidate set after a multi-hit search
   * (PAI-FNC-005 disambiguation).
   */
  pendingCandidates: Array<{
    code: string;
    hierarchyLevel: string;
    name: string;
  }> | null;
  /** Awaiting Project Type before permit-budget SOP (PAI-KNW P3). */
  pendingPermitProjectType: boolean;
  /**
   * Permit-budget topic is open in this conversation so Project Type can
   * be overridden (FTTT → FTTH) without a new chat (PAI-KNW-005).
   */
  permitBudgetContextActive: boolean;
  resolvedPermitProjectType: 'ftth' | 'fttt' | 'fttb' | 'tower' | null;
  /** Active knowledge concept for FAQ referents (BAKP, HLD/LLD, PU, …). */
  knowledgeObject: string | null;
  previousKnowledgeObject: string | null;
  knowledgeRelation: string | null;
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
  /** Committed operational frame (PAI Phase 2) */
  frame: ConversationFrame;
  /** PAI-DIQ-012: deeper Why is unavailable for the current object */
  causalBoundaryReached: boolean;
  causalDepth: number;
  causalObject: string | null;
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
  previousObject: null,
  objectHistory: [],
  activeResultSet: null,
  resultSetHistory: [],
  comparisonScope: null,
  activeReference: null,
  activeDataset: null,
  activeDatasetAnswer: null,
  activeAttribute: null,
  pendingCandidates: null,
  pendingPermitProjectType: false,
  permitBudgetContextActive: false,
  resolvedPermitProjectType: null,
  knowledgeObject: null,
  previousKnowledgeObject: null,
  knowledgeRelation: null,
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
  frame: { ...EMPTY_FRAME, ranking: { ...EMPTY_FRAME.ranking }, filters: { ...EMPTY_FRAME.filters } },
  causalBoundaryReached: false,
  causalDepth: 0,
  causalObject: null,
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
    pendingCandidates: raw?.pendingCandidates ?? null,
    activeResultSet: raw?.activeResultSet ?? null,
    resultSetHistory: Array.isArray(raw?.resultSetHistory)
      ? raw!.resultSetHistory
      : [],
    comparisonScope: raw?.comparisonScope ?? null,
    previousObject: raw?.previousObject ?? null,
    objectHistory: Array.isArray(raw?.objectHistory) ? raw!.objectHistory : [],
    frame: normalizeConversationFrame(raw?.frame ?? base.frame),
    causalBoundaryReached: !!raw?.causalBoundaryReached,
    causalDepth: Number(raw?.causalDepth || 0),
    causalObject: raw?.causalObject ?? null,
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

export function hasActiveRankingState(c: ActiveConstraintSet): boolean {
  return !!(
    c.ranking === 'top' ||
    c.ranking === 'smallest' ||
    c.extra?.some((e) => e.startsWith('metric:') || e.startsWith('limit:'))
  );
}

export function mergeConstraints(
  current: ActiveConstraintSet,
  incoming: ActiveConstraintSet,
): ActiveConstraintSet {
  const inExtra = incoming.extra || [];
  const curExtra = current.extra || [];
  if (inExtra.includes('op:clear')) {
    return { ...EMPTY_CONSTRAINTS, extra: [] };
  }
  const dropHierarchy = inExtra.includes('drop:hierarchy');
  const dropStatus = inExtra.includes('drop:status');
  const exclusiveStatus = inExtra.includes('exclusive:status');
  const incomingHasMetric = inExtra.some((e) => e.startsWith('metric:'));
  const incomingLimit = inExtra.find((e) => e.startsWith('limit:'));
  // PAI-FNC-004: ranking-only follow-ups ("yang terkecil") must keep the last metric.
  const metricExtra = incomingHasMetric
    ? [
        ...curExtra.filter((e) => !e.startsWith('metric:')),
        ...inExtra.filter((e) => e.startsWith('metric:')),
      ]
    : [
        ...new Set([
          ...curExtra.filter((e) => e.startsWith('metric:')),
          ...inExtra.filter((e) => e.startsWith('metric:')),
        ]),
      ];
  const limitExtra = incomingLimit
    ? [incomingLimit]
    : curExtra.filter((e) => e.startsWith('limit:'));
  const rest = [
    ...curExtra.filter(
      (e) =>
        !e.startsWith('metric:') &&
        !e.startsWith('limit:') &&
        !e.startsWith('op:') &&
        !e.startsWith('drop:') &&
        !e.startsWith('exclusive:'),
    ),
    ...inExtra.filter(
      (e) =>
        !e.startsWith('metric:') &&
        !e.startsWith('limit:') &&
        !e.startsWith('op:') &&
        !e.startsWith('drop:') &&
        !e.startsWith('exclusive:'),
    ),
  ];
  let hierarchy = dropHierarchy
    ? incoming.hierarchy ?? null
    : incoming.hierarchy ?? current.hierarchy ?? null;
  let status = dropStatus
    ? incoming.status ?? null
    : incoming.status ?? current.status ?? null;
  // "CLOSED saja" replaces status and drops leftover SITE (PAI-FNC-005 Issue 6)
  if (exclusiveStatus && incoming.status && !incoming.hierarchy) {
    hierarchy = null;
  }
  return {
    status,
    hierarchy,
    ranking: incoming.ranking ?? current.ranking ?? null,
    ownerName: incoming.ownerName ?? current.ownerName ?? null,
    projectNeedle: incoming.projectNeedle ?? current.projectNeedle ?? null,
    extra: [...new Set([...metricExtra, ...limitExtra, ...rest])],
  };
}
