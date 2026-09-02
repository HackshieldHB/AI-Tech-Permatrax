/** Lightweight free NLU helpers for PermaTrax AI (PAI) — no paid NLP APIs. */

import { normalizeId } from './ai-text';
import {
  extractEntityFromAnswer,
  hasConversationalReference,
  isActiveReferenceDetailQuery,
  isAttributeFollowUp,
  isOrdinalReference,
} from './ai-reference';
import {
  isBusinessDiagnosticQuery,
  isMetaReasoningInquiry,
  isUnknownInformationInquiry,
} from './ai-strategy';
import { buildPaiCapabilityCard } from './ai-capability';

export { normalizeId };

const STOP = new Set([
  'finance',
  'project',
  'projects',
  'proyek',
  'segment',
  'site',
  'berapa',
  'brapa',
  'jumlah',
  'total',
  'totalnya',
  'budget',
  'budgetnya',
  'anggaran',
  'anggarannya',
  'nilai',
  'nilainya',
  'nominal',
  'duit',
  'uang',
  'yang',
  'ini',
  'itu',
  'yah',
  'ya',
  'yuk',
  'dong',
  'deh',
  'sih',
  'kah',
  'aja',
  'saja',
  'ada',
  'semua',
  'seluruh',
  'keseluruhan',
  'aktif',
  'active',
  'saat',
  'sekarang',
  'hari',
  'bulan',
  'tahun',
  'per',
  'dari',
  'untuk',
  'dengan',
  'dalam',
  'pada',
  'punya',
  'milik',
  'tolong',
  'hitung',
  'hitungin',
  'ringkas',
  'ringkasan',
  'tampilkan',
  'lihat',
  'cek',
  'cari',
  'status',
  'statusnya',
  'apa',
  'mana',
  'siapa',
  'kasih',
  'kasi',
  'pls',
  'please',
  'yaudah',
  'udah',
  'ok',
  'oke',
  'the',
  'of',
  'and',
  'to',
  'gimana',
  'bagaimana',
  'cara',
  'kalau',
  'mau',
  'ajuin',
  'ajukan',
  'dimana',
  'letak',
  'buka',
  // conversational noise — never treat as project names
  'sudah',
  'tersedia',
  'berdasarkan',
  'ingin',
  'bertanya',
  'seputar',
  'bisa',
  'maaf',
  'mengenai',
  'tentang',
  'banyak',
  'loh',
  'tapi',
  'aku',
  'saya',
  'kamu',
  'kami',
  'mereka',
  'masih',
  'terlihat',
  'menu',
  'tadi',
  'tersebut',
  'sebelumnya',
  'maksud',
  'closed',
  'archived',
  'arsip',
  'ditutup',
  'standalone',
]);

/** Status / hierarchy tokens — never treat as a named-project search needle. */
const FINANCE_FILTER_TOKENS = new Set([
  'active',
  'aktif',
  'closed',
  'archived',
  'arsip',
  'ditutup',
  'site',
  'segment',
  'standalone',
]);

/** Strip inherited context / constraint tags so metric mapping uses this turn. */
export function primaryUtterance(text: string): string {
  return text
    .split(/\n/)[0]
    .replace(/\s*\(konteks[^)]*\)/gi, ' ')
    .replace(/\s*\[(SCOPE_|HIERARCHY_|BROADER_|USER_|METRIC|LIMIT_|DIR_).*?\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PaIntent =
  | 'greeting'
  | 'capability'
  | 'correction'
  | 'recovery'
  | 'clarify'
  | 'meta'
  | 'data'
  | 'analytics'
  | 'howto'
  | 'navigation'
  | 'comparison'
  | 'faq'
  | 'off_topic';

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export function isFollowUpShort(text: string): boolean {
  const m = normalizeId(text);
  if (m.length <= 40) {
    return /^(yaudah|udah|ok|oke|hitung|hitungin|lanjut|detail|yang terbesar|terbesar|terkecil|top\s*\d*|yang mana|terus|lalu|sama|itulah|dong)/.test(
      m,
    );
  }
  return /^(yaudah|hitung dong|hitungin|yang terbesar|yang terkecil)/.test(m);
}

/** User disagrees / corrects prior AI answer (PAI-BHV-001 / 005 / RSN-001). */
export function isUserCorrection(text: string): boolean {
  const m = normalizeId(text);
  // Hypothetical "kalau datanya tidak ada" is unknown-info meta, not correction
  if (isUnknownInformationInquiry(text)) return false;
  return (
    /^(tapi|namun|padahal|lho|loh)\b/.test(m) ||
    /(tapi|padahal).*(lihat|ada|banyak|muncul|ketemu|tersedia)/.test(m) ||
    /(aku|saya).*(lihat|lihat di|masih lihat).*(ada|banyak)/.test(m) ||
    /(bukan|salah|tidak begitu|kurang tepat|tidak sesuai|nggak sesuai|ga sesuai)/.test(
      m,
    ) ||
    /maksud saya/.test(m) ||
    /(jawabannya|jawabanmu|itu).*(salah|tidak|bukan)/.test(m) ||
    /(kayaknya|sepertinya).*(kurang sesuai|tidak sesuai|kurang pas|salah|bukan)/.test(
      m,
    ) ||
    (/(datanya).*(kurang|salah|tidak sesuai)/.test(m) &&
      !/(kalau|jika|apabila).*(datanya|data).*(tidak|belum).*(ada|tersedia)/.test(
        m,
      ))
  );
}

/** Explicit recovery trigger after bad answer (PAI-BHV-005 / RSN-003). */
export function isErrorRecovery(text: string): boolean {
  const m = normalizeId(text);
  return (
    /^(bukan itu|bukan begitu|salah|kurang tepat)/.test(m) ||
    /(bukan itu maksud|maksud saya bukan|jawaban(mu|nya)? tidak|tidak sesuai|nggak gitu|ga gitu)/.test(
      m,
    ) ||
    /(coba pahami|pahami lagi|pahami kembali).*(pertanyaan|maksud)?/.test(m) ||
    /(kayaknya|sepertinya).*(bukan itu maksud|bukan maksud)/.test(m) ||
    /bukan itu maksudku/.test(m) ||
    /(salah nangkep|salah tangkap|salah paham|kamu salah)/.test(m)
  );
}

/** Capability / can-you-help inquiry — explain ability, do NOT execute (PAI-BHV-006). */
export function isCapabilityInquiry(text: string): boolean {
  const m = normalizeId(text);
  // Imperative / live data / module-switch are NOT capability
  if (
    /^(hitung|hitungin|tampilkan|cari|berapa|brapa|jumlah|list|yang tadi|total budget project aktif)/.test(
      m,
    )
  ) {
    return false;
  }
  if (/(mau|ingin).*(bahas)|pindah bahas|fokus (ke|di)/.test(m)) return false;
  if (
    /(apa saja yang (bisa|dapat) (kamu|kau|pai)|kemampuan(mu)?|fitur (kamu|pai)|what can you)/.test(
      m,
    )
  ) {
    return true;
  }
  // "Apakah kamu bisa menghitung/bantu/tampilkan …?" → capability, not execute
  if (/(apakah|bisakah).*(bisa|dapat)/.test(m)) return true;
  if (
    /(bisa|dapat).*(bantu|bantuan|menghitung|hitung|menampilkan)/.test(m) &&
    /(kamu|anda|pai|finance|budget|cash|stok|stock|visit|permit|module|modul)/.test(
      m,
    ) &&
    !/(berapa|brapa|sekarang|dong|yaudah)/.test(m)
  ) {
    return true;
  }
  if (
    /(ingin|mau|ingin bertanya|mau tanya|boleh tanya).*(seputar|tentang|mengenai)?/.test(
      m,
    ) &&
    /(finance|budget|cash|stok|stock|visit|permit|approval|project)/.test(m) &&
    !/(berapa|brapa|jumlah|status|cari|tampilkan|cara|gimana)/.test(m)
  ) {
    return true;
  }
  if (
    /halo.*pai/.test(m) &&
    /(ingin|mau|bisa).*(tanya|bertanya|bantu)/.test(m) &&
    !/(berapa|jumlah|cara)/.test(m)
  ) {
    return true;
  }
  return false;
}

/** Scope asks for Closed/Archived — clarify before retrieval (PAI-BHV-004). */
export function needsScopeClarification(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(termasuk|ikut).*(closed|archived|arsip)/.test(m) ||
    /(closed|archived).*(dan|&|serta).*(closed|archived|arsip)/.test(m) ||
    /(seluruh|semua).*(finance\s*)?(project|proyek).*(closed|archived|arsip)/.test(
      m,
    ) ||
    /(tampilkan|list).*(seluruh|semua).*(project|proyek).*(closed|archived|arsip|status)/.test(
      m,
    )
  );
}

export function buildScopeClarificationPrompt(): string {
  return [
    'Saat ini pencarian default saya fokus fokus ke project ACTIVE.',
    'Untuk Closed dan Archived, scope-nya berbeda dan bisa terbatas sesuai filter/hak akses.',
    '',
    'Mau saya lanjutkan dengan opsi mana?',
    '• Tampilkan ringkasan ACTIVE dulu',
    '• Coba ringkasan non-ARCHIVED (ACTIVE + CLOSED)',
    '• Atau sebutkan nama/kode project tertentu',
  ].join('\n');
}

export type SessionTopic =
  | 'finance'
  | 'procurement'
  | 'stock'
  | 'cash'
  | 'visit'
  | 'permit'
  | 'fttt'
  | 'general';

export function detectTopic(text: string): SessionTopic | null {
  const m = normalizeId(text);
  if (/procurement|purchase request|\bpr\b|pembelian|order barang|surat jalan/.test(m))
    return 'procurement';
  if (/(stok|stock)\b/.test(m) && !/finance|budget/.test(m)) return 'stock';
  if (/cash\s*op|cash operation|pengajuan dana|approval dana/.test(m)) return 'cash';
  if (/visit request|kunjungan|clean list/.test(m)) return 'visit';
  if (/permit|pipeline|cluster/.test(m)) return 'permit';
  if (/\bfttt\b/.test(m)) return 'fttt';
  if (/finance|budget|anggaran|finance project|proyek finance/.test(m))
    return 'finance';
  return null;
}

/** Explicit "mau bahas X" / "pindah bahas Y" — set Active Module (PAI-RSN-002). */
export function isExplicitModuleSwitch(text: string): SessionTopic | null {
  const m = normalizeId(text);
  if (
    !/(mau bahas|ingin bahas|kita bahas|bahas dulu|pindah bahas|pindah ke|sekarang.*(bahas|pindah)|fokus (ke|di)|mengenai modul)/.test(
      m,
    )
  ) {
    // Still allow short "bahas Finance Project" / "tentang Procurement"
    if (!/^(bahas|tentang|mengenai)\s+/.test(m) && !/(aku|saya).*(mau|ingin).*(bahas|bicara)/.test(m)) {
      return null;
    }
  }
  return detectTopic(text);
}

export function buildModuleAck(topic: SessionTopic): string {
  const label = topicLabel(topic);
  const examples: Record<SessionTopic, string> = {
    finance:
      'contoh: “berapa project aktif?”, “budget terbesar?”, atau nama/kode project',
    procurement:
      'contoh: “berapa PR pending?”, “cara buat Purchase Request”, atau status PR',
    stock: 'contoh: “cara add stock”, “cek stok kabel”, atau letak menu stok',
    cash: 'contoh: “dana terakhir keluar?”, “pending approval dana”, atau cara ajuin cash op',
    visit: 'contoh: “cara buat Visit Request”, atau berapa visit open saya',
    permit: 'contoh: “berapa cluster open?”, atau tahap pipeline berikutnya',
    fttt: 'contoh: “berapa proyek FTTT aktif?”',
    general: 'silakan sebut pertanyaan spesifiknya',
  };
  return [
    `Baik — Active Module sekarang: ${label}.`,
    `Saya akan tetap fokus di modul ini sampai Anda berpindah topik secara eksplisit.`,
    '',
    `Silakan lanjutkan pertanyaan Anda (${examples[topic]}).`,
  ].join('\n');
}

/** Map active module → allowed knowledge modules (PAI-RSN-001 domain lock). */
export function topicToKnowledgeModules(topic: SessionTopic): string[] {
  switch (topic) {
    case 'finance':
      return ['finance-project'];
    case 'procurement':
      return ['procurement'];
    case 'stock':
      return ['stock'];
    case 'cash':
      return ['cash-operation'];
    case 'visit':
      return ['visit-request'];
    case 'permit':
      return ['permit-cluster', 'legal', 'design'];
    case 'fttt':
      return ['fttt'];
    default:
      return [];
  }
}

/** Tools allowed while domain is locked (prevent cross-module retrieval). */
export function topicAllowedTools(topic: SessionTopic): string[] | null {
  switch (topic) {
    case 'finance':
      return [
        'finance_analytics',
        'finance_project_totals',
        'explain_finance_project',
        'lookup_project_pic',
      ];
    case 'cash':
      return [
        'last_fund_disbursement',
        'pending_fund_approvals',
        'my_cash_operations',
      ];
    case 'visit':
      return ['my_visit_requests', 'lookup_visit_requestor'];
    case 'procurement':
      return ['my_purchase_requests', 'lookup_pr_requestor'];
    case 'stock':
      return ['search_stock'];
    case 'permit':
      return [
        'count_permit_clusters',
        'explain_permit_cluster',
        'lookup_project_pic',
      ];
    case 'fttt':
      return ['count_fttt_projects'];
    default:
      return null;
  }
}

/** Truly unsupported PII / fields (email, phone, NIK) — PIC/requestor use live tools. */
export function isUnsupportedDataQuery(text: string): boolean {
  const m = normalizeId(text);
  if (/(email|nomor telepon|no hp|alamat).*(project|proyek|pic|user)/.test(m))
    return true;
  if (/(nik|ktp).*(project|user|pic)/.test(m)) return true;
  return false;
}

export function isPicOrRequestorQuery(text: string): boolean {
  const m = normalizeId(text);
  if (/(siapa|who).*(pic|pm|project manager|penanggung jawab|owner|requestor)/.test(m))
    return true;
  if (/\bpic\b/.test(m) && /(project|proyek|siapa|cluster)/.test(m)) return true;
  if (/(requestor|requester|pemohon).*(siapa|who|nama)/.test(m)) return true;
  if (/(siapa).*(requestor|requester|pemohon)/.test(m)) return true;
  return false;
}

export function buildUnsupportedDataAnswer(text: string): string {
  const m = normalizeId(text);
  if (/(email|telepon|no hp|alamat|nik|ktp)/.test(m)) {
    return [
      'Field kontak sensitif (email / telepon / NIK / alamat) tidak diekspos melalui PAI.',
      'Saya tidak akan mengarang atau mengganti jawaban dengan ringkasan modul lain.',
      '',
      'Gunakan menu aplikasi sesuai hak akses Anda, atau tanya metrik operasional (budget, status, jumlah).',
    ].join('\n');
  }
  return [
    'Informasi spesifik itu belum tersedia melalui data tool / knowledge PAI saat ini.',
    'Saya tidak akan mengalihkan ke ringkasan modul lain yang tidak menjawab pertanyaan Anda.',
    '',
    'Coba sebutkan metrik yang tersedia (budget, status, jumlah, approval) atau buka detail di menu aplikasi.',
  ].join('\n');
}

export function topicLabel(topic: SessionTopic): string {
  switch (topic) {
    case 'finance':
      return 'Finance Project';
    case 'procurement':
      return 'Procurement / Purchase Request';
    case 'stock':
      return 'Stok';
    case 'cash':
      return 'Cash Operation';
    case 'visit':
      return 'Visit Request';
    case 'permit':
      return 'Permit Cluster';
    case 'fttt':
      return 'FTTT';
    default:
      return 'topik sebelumnya';
  }
}

export function inferActiveTopic(
  recentUserMessages: string[],
  lastAssistant?: string | null,
): SessionTopic | null {
  for (const u of recentUserMessages) {
    const t = detectTopic(u);
    if (t) return t;
  }
  if (lastAssistant) return detectTopic(lastAssistant);
  return null;
}

/**
 * Active topic + reference resolution (PAI-BHV-003).
 * Prefer persisted activeTopic/activeObject — only clarify on true ambiguity.
 */
export function resolveSessionContext(input: {
  message: string;
  priorUsers: string[];
  lastAssistant?: string | null;
  /** From persisted session — preferred over re-inference */
  persistedTopic?: SessionTopic | null;
  persistedObject?: string | null;
}): {
  effectiveText: string;
  activeTopic: SessionTopic | null;
  activeObject: string | null;
  needsTopicClarify: boolean;
  clarifyPrompt?: string;
  topicSwitched: boolean;
} {
  const msg = input.message.trim();
  const msgTopic = detectTopic(msg);
  const historyTopic =
    input.persistedTopic ||
    inferActiveTopic(input.priorUsers, input.lastAssistant);
  const ref = hasConversationalReference(msg);
  const prior =
    input.priorUsers.find((u) => !isFollowUpShort(u) && !isUserCorrection(u)) ??
    input.priorUsers[0];
  const entity =
    input.persistedObject || extractEntityFromAnswer(input.lastAssistant);

  // Explicit new topic without pronoun → switch (e.g. Finance → Procurement)
  if (msgTopic && historyTopic && msgTopic !== historyTopic && !ref) {
    return {
      effectiveText: expandWithContext(msg, input.priorUsers, input.lastAssistant),
      activeTopic: msgTopic,
      activeObject: null,
      needsTopicClarify: false,
      topicSwitched: true,
    };
  }

  if (ref) {
    // Persist topic wins — do NOT ask clarify when we already have active context
    if (!historyTopic && !prior && !entity) {
      return {
        effectiveText: msg,
        activeTopic: null,
        activeObject: null,
        needsTopicClarify: true,
        clarifyPrompt:
          'Yang Anda maksud topik yang mana — Finance Project, Procurement, atau lainnya?',
        topicSwitched: false,
      };
    }
    // Conflicting explicit topic in same breath as reference
    if (
      msgTopic &&
      historyTopic &&
      msgTopic !== historyTopic &&
      /(procurement|stok|stock|cash|visit|permit)/.test(normalizeId(msg))
    ) {
      return {
        effectiveText: msg,
        activeTopic: historyTopic,
        activeObject: entity,
        needsTopicClarify: true,
        clarifyPrompt: `Yang Anda maksud ${topicLabel(historyTopic)} atau ${topicLabel(msgTopic)}?`,
        topicSwitched: false,
      };
    }

    const topic = historyTopic || msgTopic || 'finance';
    const norm = normalizeId(msg);

    if (entity && /budget|anggaran|nominal|berapa|status|detail/.test(norm)) {
      return {
        effectiveText: `Total budget project ${entity} berapa?\n(konteks referensi: ${msg})`,
        activeTopic: topic,
        activeObject: entity,
        needsTopicClarify: false,
        topicSwitched: false,
      };
    }
    if (topic === 'finance') {
      // PAI-FNC-001/004/005: ranking + filter modification are this-turn intents.
      // Do not prepend the prior list/ranking line or "budget terbesar" loses to
      // leftover SITE list / realisasi ranking.
      if (
        isModuleDataRankingQuery(msg) ||
        isFinanceContextFilterQuery(msg) ||
        isFinanceFilterOnlyQuery(msg) ||
        isFinanceFilterOrAggregateQuery(msg)
      ) {
        return {
          effectiveText: msg,
          activeTopic: topic,
          activeObject: entity,
          needsTopicClarify: false,
          topicSwitched: false,
        };
      }
      // Inherit last finance question — never FAQ-drift on "yang tadi"
      const inherit =
        prior ||
        'Berapa nominal total budget project aktif saat ini?';
      return {
        effectiveText: `${inherit}\n(konteks referensi: ${msg})`,
        activeTopic: topic,
        activeObject: entity,
        needsTopicClarify: false,
        topicSwitched: false,
      };
    }
    return {
      effectiveText: prior ? `${prior}\n(konteks referensi: ${msg})` : msg,
      activeTopic: topic,
      activeObject: entity,
      needsTopicClarify: false,
      topicSwitched: false,
    };
  }

  // Short follow-up without naming topic → keep persisted topic
  const shortFollow =
    normalizeId(msg).length <= 48 &&
    /^(berapa|brapa|budgetnya|statusnya|detail|hitung|tampilkan|lagi)/.test(
      normalizeId(msg),
    );
  if (shortFollow && historyTopic && !msgTopic) {
    // PAI-FNC-001/002: standalone metric/count questions must not inherit
    // prior "bahas Finance…" prose (that was collapsing into full Summary).
    if (
      historyTopic === 'finance' &&
      (isProjectCountQuery(msg) ||
        detectFinanceMetrics(msg).length > 0 ||
        isFinanceFilterOrAggregateQuery(msg))
    ) {
      return {
        effectiveText: msg,
        activeTopic: historyTopic,
        activeObject: entity,
        needsTopicClarify: false,
        topicSwitched: false,
      };
    }
    const inherit = prior || `Ringkasan ${topicLabel(historyTopic)}`;
    return {
      effectiveText: `${inherit}\n${msg}`,
      activeTopic: historyTopic,
      activeObject: entity,
      needsTopicClarify: false,
      topicSwitched: false,
    };
  }

  return {
    effectiveText: expandWithContext(msg, input.priorUsers, input.lastAssistant),
    activeTopic: msgTopic || historyTopic,
    activeObject: entity,
    needsTopicClarify: false,
    topicSwitched: false,
  };
}

export function isGreetingOnly(text: string): boolean {
  const m = normalizeId(text);
  return /^(halo|hai|hi|hello|selamat (pagi|siang|sore|malam))( pai| permatrax)?[!?.]*$/.test(
    m,
  );
}

/** Ambiguous / underspecified — ask clarification first (PAI-BHV-004). */
export function isAmbiguousQuery(text: string): boolean {
  const m = normalizeId(text);
  // Conversation-state follow-ups are never ambiguous (PAI-CSM-002)
  if (
    isOrdinalReference(text) ||
    isAttributeFollowUp(text) ||
    isActiveReferenceDetailQuery(text)
  ) {
    return false;
  }
  // Recovery refinements are never "ambiguous" — they carry the answer
  if (
    /^(maksudku|maksud saya|yang saya maksud|maksudnya)\b/.test(m) ||
    /\b(aktif|active|seluruh|semua|non.?arsip)\b/.test(m)
  ) {
    return false;
  }
  if (
    isModuleDataRankingQuery(text) ||
    isFinanceFilterClearQuery(text) ||
    isFinanceFilterRemoveQuery(text) ||
    isFinanceContextFilterQuery(text)
  ) {
    return false;
  }
  const words = m.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    if (
      /^(budget|anggaran)( project| proyek)?$/.test(m) ||
      /^(approval|approve)( saya| ku)?$/.test(m) ||
      /^(status)( project| proyek| saya)?$/.test(m) ||
      /^(finance|cash op|cash operation|stok|stock|visit|dana)$/.test(m) ||
      /^(project|proyek)$/.test(m)
    ) {
      return true;
    }
  }
  // PAI-FNC-001: over-budget / material / status metrics are clear aggregates — not clarify
  if (
    /(over\s*budget|overbudget|material|jasa|realisasi|sisa\s*budget|remaining|\bactive\b|\bclosed\b|\barchived\b)/.test(
      m,
    )
  ) {
    return false;
  }
  // Noun phrase only, no question verb / metric
  if (
    words.length <= 4 &&
    /(budget|approval|status|project|proyek|dana)/.test(m) &&
    !/(berapa|brapa|jumlah|total|cara|gimana|bagaimana|dimana|siapa|kapan|cari|tampilkan|list|bisa|tolong|ajuin|ajukan|aktif|active|maksud|over|material|jasa|realisasi|sisa)/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * PAI-FNC-004 V4: partial ranking follow-up (metric / direction / limit only).
 * Must patch the latest active ranking state — not start an aggregate.
 */
export function isRankingPatchFollowUp(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  if (!m) return false;
  if (isResultSetNarrowingQuery(text)) return false;
  if (isFinanceFilterClearQuery(text) || isFinanceFilterRemoveQuery(text)) {
    return false;
  }
  if (
    /\b(berapa|jumlah|count|ada berapa)\b/.test(m) &&
    !/(terbesar|terkecil|top\s*\d*)/.test(m)
  ) {
    return false;
  }
  if (
    isFinanceContextFilterQuery(text) &&
    !hasExplicitRankingMetric(text) &&
    detectRankingDirection(text) == null &&
    detectExplicitTopN(text) == null
  ) {
    return false;
  }
  // Locked FNC-001 short aggregates ("Material Budget?") stay aggregates.
  if (
    /^(material|jasa|realisasi|sisa|remaining|over)(\s+budget)?\??$/.test(m) &&
    detectRankingDirection(text) == null &&
    detectExplicitTopN(text) == null
  ) {
    return false;
  }

  const hasDir =
    detectRankingDirection(text) != null ||
    /\byang\s+(terkecil|terbesar)\b/.test(m);
  const hasLimit = detectExplicitTopN(text) != null;
  const hasMetric = hasExplicitRankingMetric(text);
  const glue =
    /\b(sekarang|kalau|kita lihat|dilihat dari|berdasarkan|gimana|bagaimana|jadikan|pake|pakai|ganti (jadi|ke|menjadi))\b/.test(
      m,
    );

  if (hasLimit && (hasDir || hasMetric || glue || /^top\s*\d+$/.test(m))) {
    return true;
  }
  if (hasDir && (hasMetric || glue || /yang (terkecil|terbesar)/.test(m))) {
    return true;
  }
  if (hasMetric && glue) return true;
  return false;
}

/** Data ranking / live lookup inside a module (not howto). */
export function isModuleDataRankingQuery(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(paling sedikit|paling kecil|terendah|terkecil|lowest|min stock|hampir habis)/.test(
      m,
    ) ||
    /(paling banyak|paling besar|tertinggi|terbesar|top\s*\d*|highest|largest|maximum|\bmax\b)/.test(
      m,
    ) ||
    /(barang|stok|stock|item).*(sedikit|kecil|besar|banyak)/.test(m) ||
    // PAI-FNC-004 V2: "kalau berdasarkan realisasi?" is ranking, not object attr
    /(berdasarkan|dilihat dari|lihat dari|lihat)\s+(total\s+)?(realisasi|budget|anggaran|material|jasa|sisa)/.test(
      m,
    ) ||
    /(kalau|gimana|bagaimana).*(berdasarkan|dari)\s+(realisasi|budget|material|jasa|sisa)/.test(
      m,
    ) ||
    isRankingPatchFollowUp(text)
  );
}

export function buildClarificationPrompt(text: string): string {
  const m = normalizeId(text);
  if (/budget|anggaran/.test(m)) {
    return [
      'Budget project yang mana ya?',
      '',
      'Misalnya kamu bisa sebutkan:',
      '• total budget semua project aktif',
      '• nama / kode project tertentu (contoh: Test Jua TI)',
      '• atau top 10 budget terbesar',
    ].join('\n');
  }
  if (/approval/.test(m)) {
    return [
      'Approval yang mana yang dimaksud?',
      '',
      '• Approval dana / cash operation yang pending',
      '• Approval Visit Request',
      '• Approval Purchase Request',
      '',
      'Kasih sedikit detail biar aku bantu tepat ya.',
    ].join('\n');
  }
  if (/status/.test(m)) {
    return [
      'Status project / dokumen yang mana ya?',
      'Sebutkan nama atau kode project / nomor request biar aku cek di database.',
    ].join('\n');
  }
  return [
    'Bisa diperjelas sedikit?',
    'Sebutkan modulnya (Finance Project, Cash Op, Stok, Visit, dll) dan apa yang ingin dicek (jumlah, budget, status, cara pakai).',
  ].join('\n');
}

export function buildCapabilityAnswer(text: string): string {
  const m = normalizeId(text);
  const card = buildPaiCapabilityCard();
  if (/(hitung|menghitung).*(budget|anggaran)|budget.*(hitung|menghitung)/.test(m)) {
    return [
      'Ya, saya dapat membantu menghitung total budget Finance Project berdasarkan data yang tersedia.',
      '',
      'Apabila Anda ingin saya menghitungnya, silakan beri tahu ruang lingkup project yang dimaksud (misalnya seluruh project atau hanya ACTIVE).',
      '',
      card,
    ].join('\n');
  }
  const financeFocus = /finance|budget|cash|invoice|payment|dana|anggaran/.test(
    m,
  );
  if (financeFocus) {
    return [
      'Tentu bisa — seputar Finance di PermaTrax, sesuai kartu kemampuan di bawah. Saya belum menjalankan pencarian.',
      '',
      card,
      '',
      'Contoh: “berapa total budget project ACTIVE?” atau “Top 10 budget terbesar”.',
    ].join('\n');
  }
  return [
    'Tentu. Aku PAI, asisten PermaTrax. Saya belum mengeksekusi pencarian.',
    '',
    card,
    '',
    'Contoh: “berapa total budget project aktif?” atau “cara add stock”.',
  ].join('\n');
}

/** Expand pronouns / short refs using prior topic (PAI-BHV-003). */
export function expandWithContext(
  message: string,
  recentUserMessages: string[],
  lastAssistant?: string | null,
): string {
  const m = message.trim();
  const prior =
    recentUserMessages.find((u) => !isFollowUpShort(u) && !isUserCorrection(u)) ??
    recentUserMessages[0];

  if (isFollowUpShort(m) && prior) {
    return `${prior}\n${m}`;
  }

  const norm = normalizeId(m);
  const hasPronoun =
    /\b(itu|tersebut|tadi|yang sebelumnya|yang tadi|project itu|yang barusan)\b/.test(
      norm,
    ) || /^(lanjut|terus|yang mana|detailnya)/.test(norm);

  if (hasPronoun && prior) {
    return `${prior}\n(konteks referensi: ${m})`;
  }

  // Correction after empty finance search → force summary retry intent via marker
  if (isUserCorrection(m) && prior) {
    return `${prior}\n[USER_CORRECTION] ${m}`;
  }

  if (isErrorRecovery(m) && prior) {
    return `${prior}\n[USER_RECOVERY] ${m}`;
  }

  void lastAssistant;
  return m;
}

export function resolveFollowUp(
  message: string,
  recentUserMessages: string[],
): string {
  return expandWithContext(message, recentUserMessages, null);
}

export function inferTopicHint(
  recentUserMessages: string[],
  lastAssistant?: string | null,
): string | null {
  const blob = [...recentUserMessages, lastAssistant || ''].join(' ').toLowerCase();
  if (/finance|budget|anggaran/.test(blob)) return 'Finance Project';
  if (/cash|dana|approval dana/.test(blob)) return 'Cash Operation';
  if (/stok|stock/.test(blob)) return 'Stok';
  if (/visit|clean list/.test(blob)) return 'Visit Request';
  return null;
}

/** Primary intent router — conversational intents before retrieval. */
export function classifyPaIntent(text: string): PaIntent {
  const m = normalizeId(text);
  const raw = text;

  if (isGreetingOnly(raw)) return 'greeting';
  if (isMetaReasoningInquiry(raw)) return 'meta';
  if (isErrorRecovery(raw)) return 'recovery';
  if (isUserCorrection(raw) || /\[user_correction\]/i.test(raw))
    return 'correction';
  if (isCapabilityInquiry(raw)) return 'capability';
  if (isFinanceFilterClearQuery(raw) || isFinanceFilterRemoveQuery(raw)) {
    return 'data';
  }
  if (isAmbiguousQuery(raw)) return 'clarify';

  if (
    /presiden|cuaca|resep|bitcoin|lagu|film|olahraga/.test(m) &&
    !/(permatrax|budget|project|stok|dokumen|cash|visit|cluster)/.test(m)
  ) {
    return 'off_topic';
  }

  // Ranking / live data inside module — before howto keyword traps
  if (isModuleDataRankingQuery(raw)) return 'analytics';

  // Causal 5-why before overbudget/analytics keyword traps
  if (isBusinessDiagnosticQuery(raw)) return 'data';

  if (
    (/(bagaimana|gimana|cara|langkah|tutorial|caranya|gimana cara)/.test(m) ||
      /(mau ajuin|mau ajukan|kalau mau).*(gimana|cara)?/.test(m) ||
      /(cara).*(add|tambah|buat|ajukan|buka)/.test(m) ||
      /^(ajuin|ajukan)\b/.test(m) ||
      /(ajuin|ajukan).*(budget|perizinan|dana|cash|stock|stok|visit)/.test(m) ||
      /(add stock|tambah stok|tambah barang)/.test(m)) &&
    !isMetaReasoningInquiry(raw)
  ) {
    return 'howto';
  }

  if (
    /(dimana|di mana|\bletak\b|menu apa|buka dimana|lihat dimana|akses dimana|\bpath\b|sidebar)/.test(
      m,
    ) ||
    /(daftar dokumen|dokumen).*(dimana|\bmana\b|menu|lihat)/.test(m) ||
    /(dimana|\bmana\b).*(dokumen|menu|stock|stok|cash|finance)/.test(m)
  ) {
    return 'navigation';
  }

  if (
    /(terbesar|terkecil|top\s*\d*|ranking|over\s*budget|overbudget|paling besar|paling kecil|progress.*lambat)/.test(
      m,
    )
  ) {
    return 'analytics';
  }

  if (/(bandingkan|vs\b|versus|dibanding)/.test(m)) {
    return 'comparison';
  }

  if (
    isFinanceBudgetQuery(text) ||
    isProjectCountQuery(text) ||
    isFinanceFilterOrAggregateQuery(text) ||
    /(berapa|brapa|jumlah|total|nominal|cari|tampilkan|list|summary|ringkas|siapa|status(nya)?)/.test(
      m,
    ) ||
    /(kapan|terakhir).*(dana|cair|keluar|disburse|pencairan)/.test(m) ||
    /(dana|cair|pencairan).*(terakhir|keluar|kapan)/.test(m) ||
    /(pending|approval).*(dana|cash)/.test(m)
  ) {
    return 'data';
  }

  if (/(apa itu|jelaskan|pengertian)/.test(m)) return 'faq';
  return 'faq';
}

/** Definition / glossary — allowed FAQ while a module topic is locked. */
export function isKnowledgeDefinitionQuery(text: string): boolean {
  const m = normalizeId(text);
  if (/(cara |tutorial|langkah|gimana cara)/.test(m)) return false;
  return /(apa itu|pengertian|definisi)/.test(m);
}

/** PAI-FNC-001/005: status / hierarchy / metric tokens as data filters, not Guide. */
export function isFinanceFilterOrAggregateQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  if (
    /^(berapa\s+)?(active|aktif|closed|archived|arsip)\??$/.test(m) ||
    /(berapa|jumlah|ada).*(active|aktif|closed|archived|arsip)/.test(m) ||
    /(berapa|jumlah).*(project|proyek).*(active|aktif|closed|archived|arsip)/.test(
      m,
    ) ||
    /(over\s*budget|overbudget)/.test(m) ||
    /^(material|jasa|realisasi|sisa(\s*budget)?|remaining)\??$/.test(m) ||
    /(material|jasa)\s*(budget|anggaran)/.test(m) ||
    /(budget|anggaran)\s*(material|jasa)/.test(m) ||
    detectFinanceMetrics(text).length > 0
  ) {
    return true;
  }
  // Multi-filter: ACTIVE SITE / CLOSED SEGMENT / ACTIVE + SEGMENT
  if (
    /\b(active|aktif|closed|archived)\b/.test(m) &&
    /\b(site|segment|standalone)\b/.test(m)
  ) {
    return true;
  }
  if (
    /\b(site|segment|standalone)\b/.test(m) &&
    /(filter|hanya|berdasarkan|tampilkan|list|daftar|project|budget|active|aktif|sekarang|saja)/.test(
      m,
    )
  ) {
    return true;
  }
  if (isFinanceContextFilterQuery(text)) return true;
  if (isFinanceFilterOnlyQuery(text)) return true;
  return false;
}

/** "berapa project tersedia" / count inventory — not a named search. */
export function isProjectCountQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  // Budget-amount questions are not inventory counts
  if (/(berapa|total|jumlah|nominal).*(budget|anggaran|duit|nilai)/.test(m)) {
    return false;
  }
  if (/(budget|anggaran).*(berapa|total|nominal)/.test(m)) return false;
  // PAI-FNC-001/002: "Berapa project ACTIVE?" is status_count, not inventory
  if (
    /\b(active|aktif|closed|archived|arsip)\b/.test(m) &&
    /(berapa|jumlah|ada|count)/.test(m)
  ) {
    return false;
  }
  return (
    /(berapa|brapa|jumlah|sudah ada|ada berapa).*(project|proyek)/.test(m) ||
    /(project|proyek).*(tersedia|ada berapa)/.test(m) ||
    /(finance\s*project).*(berapa project|jumlah project|tersedia)/.test(m)
  );
}

/** PAI-FNC-005: status/hierarchy filters without a named project or ranking metric. */
export function isFinanceFilterOnlyQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  if (isResultSetNarrowingQuery(text) || isFinanceFilterClearQuery(text)) {
    return false;
  }
  if (
    /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil|paling tinggi|paling rendah)/.test(
      m,
    )
  ) {
    return false;
  }
  if (/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i.test(text)) return false;
  const hasStatus = /\b(active|aktif|closed|archived|arsip)\b/.test(m);
  const hasHier =
    /\b(site|segment|standalone)\b/.test(m) && !/(site-\d|website)/.test(m);
  if (!hasStatus && !hasHier) return false;
  const leftover = m
    .replace(
      /\b(tampilkan|list|daftar|lihat|show|cari|project|proyek|finance|yang|dengan|berdasarkan|filter|hanya|sekarang|saja|hanya|active|aktif|closed|archived|arsip|ditutup|site|segment|standalone|hapus|buang|hilangkan|ganti|kembali|semua|seluruh)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (
    leftover.length >= 3 &&
    !FINANCE_FILTER_TOKENS.has(leftover) &&
    leftover.split(' ').some((t) => !FINANCE_FILTER_TOKENS.has(t) && t.length > 1)
  ) {
    return false;
  }
  return true;
}

/**
 * PAI-FNC-001/005 V11: "Sekarang …", "… saja", "hanya …" modify the active
 * Finance filter set instead of starting a Knowledge/Guide turn.
 */
export function isFinanceContextFilterQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  if (/(apa itu|jelaskan|pengertian|cara |gimana|bagaimana)/.test(m)) {
    return false;
  }
  if (/(bahas|pindah|fokus|modul)/.test(m)) return false;
  if (isFinanceFilterRemoveQuery(text) || isFinanceFilterClearQuery(text)) {
    return true;
  }
  if (
    /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil)/.test(m)
  ) {
    return false;
  }
  const hasStatus = /\b(active|aktif|closed|archived|arsip)\b/.test(m);
  const hasHier =
    /\b(site|segment|standalone)\b/.test(m) && !/(site-\d|website)/.test(m);
  if (!hasStatus && !hasHier) return false;
  if (
    /^(sekarang|hanya|filter|ganti)\b/.test(m) ||
    /\bsaja\??$/.test(m) ||
    /(hanya|filter|ganti(\s+ke)?|ganti\s+menjadi|ubah(\s+jadi)?|ubah\s+menjadi)\s+(project|proyek|site|segment|standalone|active|aktif|closed)/.test(
      m,
    ) ||
    /^(ganti|ubah)\s+(menjadi|ke|jadi)\s+(site|segment|standalone|active|aktif|closed)/.test(
      m,
    ) ||
    /(dari yang tadi|yang tadi).*(site|segment|standalone|active|aktif|closed)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /^(project\s+)?(active|aktif|closed|archived)\s+(site|segment|standalone)\??$/.test(
      m,
    ) ||
    /^(site|segment|standalone)\s*(saja)?\??$/.test(m)
  ) {
    return true;
  }
  return false;
}

/** PAI-FNC-005: drop the entire filter set and wait for the next intent. */
export function isFinanceFilterClearQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  return (
    /(kembali ke semua|kembali ke seluruh|reset filter|hapus semua filter|hapus seluruh filter|tanpa filter|clear filter)/.test(
      m,
    ) ||
    /(kembali|reset)\s+(ke\s+)?(semua|seluruh)\s+(project|proyek|finance)/.test(m) ||
    /^(semua project|seluruh project|semua finance project)\s*(saja)?\??$/.test(m)
  );
}

/** PAI-FNC-005: remove one filter dimension ("Hapus filter SITE"). */
export function isFinanceFilterRemoveQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  return /(hapus|buang|hilangkan|lepas|drop)\s+(filter\s+)?(site|segment|standalone|active|aktif|closed|archived|arsip|status)/.test(
    m,
  );
}

/**
 * PAI-FNC-005: "Yang SEGMENT" after a multi-hit search picks an object,
 * it does not start a new dataset filter.
 */
export function isResultSetNarrowingQuery(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  if (/(top\s*\d*|terbesar|terkecil|tampilkan|list|daftar|hanya|hapus)/.test(m)) {
    return false;
  }
  if (/\bfilter\b/.test(m) && !/\byang\b/.test(m)) {
    return false;
  }
  return (
    /^(yang\s+)?(site|segment|standalone|active|aktif|closed)\??$/.test(m) ||
    /^yang\s+(site|segment|standalone|seg|fin)\b/.test(m) ||
    /^(yang\s+)?(kode\s+)?((?:site|seg|fin)-\d{4}-\d+)/.test(m) ||
    /(segment-nya|site-nya|yang kode)/.test(m)
  );
}

/**
 * PAI-FNC-001/002: complete aggregate / status / metric questions that must
 * use the default Finance dataset — not Active Object or leftover filters.
 */
export function isStandaloneFinanceAggregateQuery(text: string): boolean {
  if (hasConversationalReference(text)) return false;
  if (isFinanceContextFilterQuery(text) || isFinanceFilterOnlyQuery(text)) {
    return false;
  }
  if (isModuleDataRankingQuery(text)) return false;
  const m = normalizeId(primaryUtterance(text));
  if (
    /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil|paling tinggi|paling rendah)/.test(
      m,
    )
  ) {
    return false;
  }
  if (isProjectCountQuery(text)) return true;
  if (detectFinanceMetrics(text).length > 0) return true;
  if (
    /^(berapa\s+)?(active|aktif|closed|archived|arsip|material|jasa|realisasi|sisa|remaining|over)\b/.test(
      m,
    )
  ) {
    return true;
  }
  return false;
}

export function hasExplicitRankingMetric(text: string): boolean {
  const m = normalizeId(primaryUtterance(text));
  return (
    /(over\s*budget|overbudget|realisasi|spent|terpakai|sisa|remaining|material|jasa|service|budget|anggaran)/.test(
      m,
    )
  );
}

/**
 * PAI-FNC-001/002 vs FNC-005: inherit SITE/ACTIVE across ranking/list follow-ups,
 * but never onto a new standalone aggregate (that silently shrinks the dataset).
 */
export function shouldApplySessionFinanceFilters(text: string): boolean {
  if (isFinanceFilterClearQuery(text)) return false;
  if (hasConversationalReference(text)) return true;
  if (isStandaloneFinanceAggregateQuery(text)) return false;
  if (/(semua|seluruh|keseluruhan)\b/.test(normalizeId(primaryUtterance(text)))) {
    return false;
  }
  const mode = detectFinanceMode(text);
  if (mode === 'top_budget' || mode === 'smallest' || mode === 'ranking') {
    return true;
  }
  // Filter-set turns persist the other dimension (e.g. keep ACTIVE when
  // switching SITE → SEGMENT). This turn's extractConstraints already replaced
  // the dimension the user named.
  if (
    mode === 'filtered_list' ||
    isFinanceFilterOnlyQuery(text) ||
    isFinanceContextFilterQuery(text)
  ) {
    return true;
  }
  return false;
}

export function isFinanceBudgetQuery(text: string): boolean {
  const m = normalizeId(text);
  if (isProjectCountQuery(text)) return true;
  if (isFinanceFilterOrAggregateQuery(text)) return true;
  if (/(finance\s*project|proyek\s*finance|project\s*finance|fp\b)/.test(m)) {
    return true;
  }
  if (
    /(budget|anggaran|duit|nominal|realisasi|sisa budget).*(aktif|project|proyek|finance|site|segment)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /(total|berapa|brapa|jumlah|ringkas|summary).*(budget|anggaran|project aktif|proyek aktif|duit project|duit proyek)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /(project|proyek|segment|site).+\b(budget|anggaran|nominal)/.test(m) ||
    /(budget|anggaran|nominal).+(project|proyek|segment|site)/.test(m)
  ) {
    return true;
  }
  if (isRankingPatchFollowUp(text) && !/(stok|stock|barang)/.test(m)) {
    return true;
  }
  if (/^(sekarang\s+)?top\s*\d+(\s+saja)?$/.test(m)) {
    return true;
  }
  if (
    /(top\s*\d*|terbesar|terkecil|over\s*budget|overbudget)/.test(m) &&
    /(budget|project|proyek|finance|realisasi|sisa|material|jasa)/.test(m)
  ) {
    return true;
  }
  if (/(hitung|hitungin).*(budget|project|proyek|finance|anggaran)?/.test(m)) {
    return true;
  }
  if (/(berapa|jumlah).*(site|segment)/.test(m)) {
    return true;
  }
  // PAI-FNC-003: business-attribute search cues
  if (
    /(cari|tampilkan|list|daftar|lihat).*(project|proyek|site|segment|client|finance)/.test(
      m,
    ) ||
    /(project|proyek|site|segment).*(bernama|atas nama|client|pelanggan)/.test(m)
  ) {
    return true;
  }
  if (/\b((?:site|seg|fin)-\d{4}-\d+)\b/.test(m)) {
    return true;
  }
  return false;
}

/** Single-metric / status aggregate (PAI-FNC-001/002). */
export type FinanceMetric =
  | 'status_active'
  | 'status_closed'
  | 'status_archived'
  | 'overbudget_count'
  | 'material_budget'
  | 'jasa_budget'
  | 'realization'
  | 'remaining'
  | 'total_budget';

/** Ranking field for dynamic ORDER BY (PAI-FNC-004). */
export type FinanceRankingMetric =
  | 'totalBudget'
  | 'realization'
  | 'remaining'
  | 'materialBudget'
  | 'jasaBudget'
  | 'overbudget';

export type FinanceMode =
  | 'summary'
  | 'top_budget'
  | 'smallest'
  | 'overbudget'
  | 'search'
  | 'by_owner'
  | 'hierarchy_counts'
  | 'status_count'
  | 'metric_aggregate'
  | 'project_count'
  | 'ranking'
  | 'filtered_list';

/** Explicit Top-N, or null when the user did not name a count (PAI-FNC-004). */
export function detectExplicitTopN(text: string): number | null {
  const t = normalizeId(primaryUtterance(text)).replace(/\bbbudget\b/g, 'budget');
  const patterns = [
    /\btop\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s+yang\s+(?:terbesar|terkecil|teratas|terendah|paling)/,
    /\b(\d{1,2})\s+(?:project\s+)?(?:dengan\s+)?(?:total\s+)?(?:budget|anggaran|realisasi|sisa|material|jasa)?\s*(terbesar|terkecil|teratas|terendah|paling)/,
    /\b(?:sekarang|tampilkan|ambil|lihat)\s+(\d{1,2})\s+(?:yang\s+)?(?:budget|anggaran|realisasi|sisa|material|jasa|project|proyek)/,
    /\b(?:jadikan|ambil|pakai|pake|limit)\s+(?:top\s*)?(\d{1,2})\b/,
    /\b(?:sekarang|hanya)\s+(\d{1,2})\s*(?:saja)?$/,
    /\b(\d{1,2})\s+(?:budget|anggaran|realisasi|material|sisa)/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 50) return Math.floor(n);
  }
  return null;
}

/** Top-N limit from ranking wording. Default 10 when unspecified. */
export function detectTopNLimit(text: string): number {
  return detectExplicitTopN(text) ?? 10;
}

/**
 * Ranking sort direction from THIS utterance only (PAI-FNC-004).
 * Last mentioned direction wins when both terbesar and terkecil appear.
 * `Top N` alone does not imply terbesar when terkecil is also present.
 */
export function detectRankingDirection(text: string): 'desc' | 'asc' | null {
  const t = normalizeId(primaryUtterance(text));
  const smallRe =
    /terkecil|paling kecil|paling rendah|terendah|lowest|smallest|ascending/g;
  const largeRe =
    /terbesar|paling besar|paling tinggi|tertinggi|highest|largest|maximum/g;
  let lastSmall = -1;
  let lastLarge = -1;
  for (const m of t.matchAll(smallRe)) {
    if (m.index != null) lastSmall = m.index;
  }
  for (const m of t.matchAll(largeRe)) {
    if (m.index != null) lastLarge = m.index;
  }
  if (lastSmall < 0 && lastLarge < 0) return null;
  if (lastSmall > lastLarge) return 'asc';
  if (lastLarge > lastSmall) return 'desc';
  return lastSmall >= 0 ? 'asc' : 'desc';
}

/**
 * Collect all aggregate metrics mentioned (PAI-FNC-002 multi-metric).
 * Order follows user phrasing priority used by detectFinanceMetric.
 */
export function detectFinanceMetrics(text: string): FinanceMetric[] {
  const m = normalizeId(text);
  const out: FinanceMetric[] = [];
  const push = (x: FinanceMetric) => {
    if (!out.includes(x)) out.push(x);
  };

  if (
    (/\b(archived|arsip)\b/.test(m) &&
      /(berapa|jumlah|ada|count)|^archived\??$|^arsip\??$/.test(m)) ||
    /^berapa\s+(archived|arsip)\??$/.test(m)
  ) {
    push('status_archived');
  }
  if (
    (/\b(closed|ditutup)\b/.test(m) &&
      /(berapa|jumlah|ada|count)|^closed\??$/.test(m)) ||
    /^berapa\s+closed\??$/.test(m)
  ) {
    push('status_closed');
  }
  if (
    (/\b(active|aktif)\b/.test(m) &&
      /(berapa|jumlah|ada|count|project|proyek)|^active\??$|^aktif\??$/.test(
        m,
      ) &&
      !/(budget|anggaran|realisasi|material|jasa|sisa|top|terbesar|terkecil)/.test(
        m,
      )) ||
    /^berapa\s+(active|aktif)\??$/.test(m) ||
    /berapa\s+(project|proyek)\s+(active|aktif)/.test(m)
  ) {
    push('status_active');
  }
  if (
    /(over\s*budget|overbudget)/.test(m) &&
    !/(top|terbesar|terkecil|ranking|daftar|list|paling)/.test(m)
  ) {
    push('overbudget_count');
  }
  if (
    /(material).*(budget|anggaran)|(budget|anggaran).*material|\bmaterial\b\s*(budget|anggaran)?\??$/.test(
      m,
    ) &&
    !/(spent|realisasi|terpakai|terbesar|terkecil|top)/.test(m)
  ) {
    push('material_budget');
  }
  if (
    /(jasa|service).*(budget|anggaran)|(budget|anggaran).*(jasa|service)|\bjasa\b\s*(budget|anggaran)?\??$/.test(
      m,
    ) &&
    !/(spent|realisasi|terpakai|terbesar|terkecil|top)/.test(m)
  ) {
    push('jasa_budget');
  }
  // Total budget before realization so multi-metric answers lead with budget
  if (
    /(total\s*)?(budget|anggaran)/.test(m) &&
    !/(material\s*budget|jasa\s*budget|service\s*budget|sisa\s*budget|remaining)/.test(
      m,
    ) &&
    !/(terbesar|terkecil|top|ranking|paling)/.test(m)
  ) {
    push('total_budget');
  }
  if (
    /(realisasi|spent|terpakai)/.test(m) &&
    !/(terbesar|terkecil|top|ranking|paling)/.test(m)
  ) {
    push('realization');
  }
  if (
    /(sisa\s*budget|remaining(\s*budget)?|\bsisa\b)/.test(m) &&
    !/(terbesar|terkecil|top|ranking|paling)/.test(m)
  ) {
    push('remaining');
  }

  return out;
}

export function detectFinanceMetric(text: string): FinanceMetric | null {
  const all = detectFinanceMetrics(text);
  return all[0] ?? null;
}

export function detectRankingMetric(text: string): FinanceRankingMetric {
  const ctxRaw = text.match(/konteks referensi:\s*([^)\n]+)/i)?.[1];
  const m = normalizeId(primaryUtterance(text));
  const ctx = ctxRaw ? normalizeId(ctxRaw) : '';
  const full = normalizeId(text);
  const src = `${m} ${full}`;
  const tag = text.match(/\[METRIC_([A-Z_]+)\]/i);
  const fromTag = (): FinanceRankingMetric | null => {
    if (!tag) return null;
    const key = tag[1].toLowerCase();
    if (key === 'realization') return 'realization';
    if (key === 'remaining') return 'remaining';
    if (key === 'materialbudget') return 'materialBudget';
    if (key === 'jasabudget') return 'jasaBudget';
    if (key === 'overbudget') return 'overbudget';
    if (key === 'totalbudget') return 'totalBudget';
    return null;
  };
  const namedTotalBudget = (s: string) =>
    /(\btotal\s+)?(\bbudget\b|\banggaran\b)\s*(terbesar|tertinggi|terkecil|terendah|paling)/.test(
      s,
    ) ||
    /top\s*\d+\s*(project\s*)?(dengan\s*)?(total\s*)?(\bbudget\b|\banggaran\b)/.test(
      s,
    ) ||
    /(terbesar|tertinggi|terkecil|paling besar|paling tinggi).*(total\s+)?(\bbudget\b|\banggaran\b)/.test(
      s,
    );
  // This-turn wording on the primary utterance wins over inherited tags.
  // Do not scan METRIC/LIMIT tags as "budget" — "materialBudget" contains "budget".
  if (/(over\s*budget|overbudget)/.test(m)) return 'overbudget';
  if (/(sisa\s*budget|remaining(\s*budget)?)/.test(m) || /\bsisa\b/.test(m)) {
    return 'remaining';
  }
  if (/\bmaterial\b/.test(m)) return 'materialBudget';
  if (/\b(jasa|service)\b/.test(m)) return 'jasaBudget';
  if (namedTotalBudget(m) || namedTotalBudget(ctx)) return 'totalBudget';
  if (/(realisasi|spent|terpakai)/.test(m)) return 'realization';
  const tagged = fromTag();
  if (tagged && !hasExplicitRankingMetric(primaryUtterance(text))) return tagged;
  if (/(\bbudget\b|\banggaran\b)/.test(m) && !tagged) return 'totalBudget';
  if (tagged) return tagged;
  if (/(over\s*budget|overbudget)/.test(src)) return 'overbudget';
  if (/(sisa\s*budget|remaining(\s*budget)?)/.test(src)) return 'remaining';
  if (/\bmaterial\b/.test(src)) return 'materialBudget';
  if (/\b(jasa|service)\b/.test(src)) return 'jasaBudget';
  if (/(realisasi|spent|terpakai)/.test(src)) return 'realization';
  if (/(\bbudget\b|\banggaran\b)/.test(src)) return 'totalBudget';
  return 'totalBudget';
}

export function wantsFinanceFullSummary(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(ringkas|summary|overview|keseluruhan|semua metrik)/.test(m) ||
    /(finance\s*project).*(total budget|budget).*(keseluruhan|semua|per hari)/.test(
      m,
    ) ||
    /(total budget|nominal total).*(keseluruhan|semua project|project aktif|aktif saat)/.test(
      m,
    ) ||
    /(berapa|hitung).*(nominal\s*)?total budget.*(aktif|keseluruhan|semua)/.test(m)
  );
}

const WEAK_NEEDLES = new Set([
  'sudah',
  'tersedia',
  'berdasarkan',
  'saat',
  'ini',
  'banyak',
  'loh',
  'ada',
  'project',
  'proyek',
  'finance',
]);

/** Extract named project from questions like "budget project Segment Test Jua TI". */
export function extractProjectNeedle(text: string): string | null {
  const m = normalizeId(text);

  // PAI-FNC-004: ranking utterances are never named-project searches
  if (
    /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil)/.test(m) &&
    !/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i.test(text) &&
    !/\bcari\b/.test(m)
  ) {
    return null;
  }

  // Count / inventory questions are never named searches
  if (isProjectCountQuery(text) && !/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i.test(text)) {
    const maybeName = text.match(
      /(?:project|proyek|segment|site)\s+([A-Z][\w.-]*(?:\s+[A-Z0-9][\w.-]*){1,5})/,
    );
    // Only if Title Case multi-word name present
    if (!maybeName) return null;
  }

  if (
    /(keseluruhan|semua|seluruh|aktif|active|tersedia)/.test(m) &&
    !/(cari|["“]|site-\d|seg-\d|fin-\d)/i.test(text)
  ) {
    const hasExplicitName =
      /(?:project|proyek|segment|site)\s+(?!aktif\b|active\b|semua\b|seluruh\b|keseluruhan\b|tersedia\b|yang\b)[A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*){0,6}/i.test(
        text,
      ) &&
      !/(total budget|nominal total|jumlah budget|duit|berapa|sudah ada).*(project|proyek)/i.test(
        text,
      ) &&
      !/(project|proyek)\s+(aktif|active|semua|seluruh|keseluruhan|tersedia)/i.test(
        text,
      );
    if (!hasExplicitName) return null;
  }

  const code = text.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i);
  if (code) return code[1];

  const quoted = text.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();

  // PAI-FNC-001/002: bare metric phrases are never project needles
  // Still allow "Total budget project Segment Foo" named lookups
  if (detectFinanceMetric(text) && !/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i.test(text)) {
    const hasNamedProject =
      /(?:project|proyek|segment|site)\s+(?!aktif\b|active\b|semua\b|seluruh\b|keseluruhan\b|tersedia\b|yang\b|finance\b)[A-Za-z0-9]/i.test(
        text,
      ) || /\bcari\b/i.test(text);
    if (!hasNamedProject) return null;
  }
  if (
    /^(material|jasa|realisasi|sisa|remaining|over)(\s+budget)?\??$/i.test(m)
  ) {
    return null;
  }

  const named = text.match(
    /(?:project|proyek|segment|site|finance\s*project)\s+(.+?)(?:\s+(?:berapa|brapa|total|budget|anggaran|nominal|status|duit|tersedia|yang)|[?.!]|$)/i,
  );
  if (named?.[1]) {
    const cleaned = named[1]
      .replace(
        /\b(segment|site|finance|project|proyek|aktif|active|yang|ini|dong|yah|ya|semua|seluruh|keseluruhan|total|saat|sekarang|hari|sudah|ada|tersedia|berdasarkan|material|jasa)\b/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = meaningfulTokens(cleaned).filter((t) => !WEAK_NEEDLES.has(t));
    if (
      cleaned.length >= 2 &&
      tokens.length > 0 &&
      !WEAK_NEEDLES.has(cleaned.toLowerCase())
    ) {
      return tokens.join(' ');
    }
  }

  if (
    !/(total|nominal|jumlah|berapa|sudah ada).*(budget|anggaran|project|proyek).*(aktif|active|keseluruhan|semua|tersedia)?/.test(
      m,
    )
  ) {
    const beforeBudget = text.match(
      /(.+?)\s+(?:budget|anggaran|nominal)(?:nya)?\s*(?:berapa|brapa)?/i,
    );
    if (beforeBudget?.[1]) {
      const cleaned = beforeBudget[1]
        .replace(
          /\b(total|berapa|brapa|jumlah|project|proyek|segment|site|finance|yang|ini|aktif|active|nominal|sudah|ada|material|jasa|realisasi|sisa|remaining|over)\b/gi,
          ' ',
        )
        .replace(/\s+/g, ' ')
        .trim();
      // PAI-FNC-001: "Material Budget" → cleaned empty — not a project name
      if (/^(material|jasa|realisasi|sisa|over)$/i.test(cleaned)) return null;
      const tokens = meaningfulTokens(cleaned).filter((t) => !WEAK_NEEDLES.has(t));
      if (cleaned.length >= 3 && tokens.length > 0) {
        return tokens.join(' ');
      }
    }
  }

  return null;
}

/** Hierarchy constraint from recovery refine / user filter (PAI-RSN-003 V5/V6 + FNC-005). */
export function extractHierarchyConstraint(
  text: string,
): 'SITE' | 'SEGMENT' | 'STANDALONE' | null {
  if (isFinanceFilterRemoveQuery(text) || isFinanceFilterClearQuery(text)) {
    return null;
  }
  if (/\[HIERARCHY_NONE\]/i.test(text)) return null;
  if (/\[HIERARCHY_SITE\]/i.test(text)) return 'SITE';
  if (/\[HIERARCHY_SEGMENT\]/i.test(text)) return 'SEGMENT';
  if (/\[HIERARCHY_STANDALONE\]/i.test(text)) return 'STANDALONE';
  const m = normalizeId(text);
  const hierGlue =
    /(berdasarkan|filter|hanya|level|hierarki|maksud|bukan|sekarang|saja|project|proyek|terbesar|terkecil|top\s*\d*|ranking|budget|active|aktif|closed|archived|list|daftar|tampilkan)/;
  // PAI-FNC-001/005 V11: "Sekarang SEGMENT saja" is a type filter, not Guide
  if (
    /\b(segment)\b/.test(m) &&
    (hierGlue.test(m) ||
      /^(active|aktif|closed)\s+segment/.test(m) ||
      /^segment\s+(active|aktif|closed)/.test(m) ||
      /^(sekarang\s+)?(hanya\s+)?(project\s+)?segment(\s+saja)?$/.test(m))
  ) {
    return 'SEGMENT';
  }
  if (
    /\b(site)\b/.test(m) &&
    !/(site-\d|website)/.test(m) &&
    (hierGlue.test(m) ||
      /^(active|aktif|closed)\s+site/.test(m) ||
      /^site\s+(active|aktif|closed)/.test(m) ||
      /^(sekarang\s+)?(hanya\s+)?(project\s+)?site(\s+saja)?$/.test(m))
  ) {
    return 'SITE';
  }
  if (
    /\b(standalone)\b/.test(m) &&
    (hierGlue.test(m) || /(terbesar|active|aktif)/.test(m))
  ) {
    return 'STANDALONE';
  }
  return null;
}

export function detectFinanceMode(text: string): FinanceMode {
  const m = normalizeId(primaryUtterance(text));

  // PAI-FNC-004: ranking with dynamic metric (before generic overbudget/summary)
  const wantsRank =
    /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil|paling tinggi|paling rendah|highest|lowest|largest|smallest)/.test(
      m,
    ) ||
    /(berdasarkan|dilihat dari|lihat dari)\s+(total\s+)?(realisasi|budget|anggaran|material|jasa|sisa)/.test(
      m,
    ) ||
    /(kalau|gimana|bagaimana).*(berdasarkan|dari)\s+(realisasi|budget|material|jasa|sisa)/.test(
      m,
    ) ||
    isRankingPatchFollowUp(text);
  if (wantsRank) {
    const dir = detectRankingDirection(text);
    if (dir === 'asc') return 'smallest';
    return 'top_budget';
  }

  // PAI-FNC-005: filter-only list/summary BEFORE keyword search
  // ("Tampilkan project ACTIVE SITE" / "Sekarang SEGMENT saja" must not become
  // a name search or status_count that drops Project Type)
  if (isFinanceFilterOnlyQuery(text) || isFinanceContextFilterQuery(text)) {
    if (/(tampilkan|list|daftar|lihat|show)\b/.test(m)) {
      return 'filtered_list';
    }
    return 'filtered_list';
  }

  // Named project / "cari …" wins over bare metric aggregate (PAI-FNC-003)
  const earlyNeedle = extractProjectNeedle(text) || extractSearchNeedle(text);
  if (
    earlyNeedle &&
    !WEAK_NEEDLES.has(earlyNeedle.toLowerCase()) &&
    !FINANCE_FILTER_TOKENS.has(earlyNeedle.toLowerCase()) &&
    (/\bcari\b/.test(m) ||
      /(?:project|proyek|segment|site)\s+(?!aktif\b|active\b|closed\b|archived\b)/i.test(
        text,
      ))
  ) {
    return 'search';
  }

  // PAI-FNC-001/002: single/multi-metric / status aggregate before summary
  const metrics = detectFinanceMetrics(text);
  const metric = metrics[0] ?? null;
  if (metric?.startsWith('status_') && metrics.length === 1) return 'status_count';
  if (metric === 'overbudget_count' && metrics.length === 1) {
    return 'metric_aggregate';
  }
  if (
    metrics.length > 0 &&
    !wantsFinanceFullSummary(text) &&
    !extractProjectNeedle(text)
  ) {
    return 'metric_aggregate';
  }

  // Legacy overbudget filter mode only when listing over-budget projects
  if (
    /(over\s*budget|overbudget)/.test(m) &&
    /(list|daftar|tampilkan|project|yang)/.test(m)
  ) {
    return 'overbudget';
  }

  if (/(milik|punya)\s+[a-z]{2,}/.test(m)) return 'by_owner';

  // PAI-FNC-002: total project count — non-ARCHIVED scope (not forced ACTIVE)
  if (isProjectCountQuery(text) && !extractProjectNeedle(text)) {
    return 'project_count';
  }

  // User correction after failed search → broaden to summary
  if (/\[user_correction\]/i.test(text) && !extractProjectNeedle(text)) {
    return 'summary';
  }

  const needle = extractProjectNeedle(text) || extractSearchNeedle(text);
  if (
    needle &&
    !WEAK_NEEDLES.has(needle.toLowerCase()) &&
    !needle.split(/\s+/).every((t) => FINANCE_FILTER_TOKENS.has(t.toLowerCase()))
  ) {
    return 'search';
  }

  if (/\b(site|seg|fin)-\d+/i.test(m)) {
    return 'search';
  }
  // "cari X" / business-attribute search
  if (/\bcari\b/.test(m) || /(tampilkan|list|daftar).*(project|site|segment)/.test(m)) {
    const n = extractSearchNeedle(text) || extractProjectNeedle(text);
    if (n && !WEAK_NEEDLES.has(n.toLowerCase()) && meaningfulTokens(n).length > 0) {
      return 'search';
    }
  }
  if (/(berapa|jumlah).*(site|segment)/.test(m) && !/budget|anggaran/.test(m)) {
    return 'hierarchy_counts';
  }

  // PAI-FNC-005: multi-filter without explicit metric → filtered summary
  if (
    extractHierarchyConstraint(text) &&
    /\b(active|aktif|closed|archived)\b/.test(m)
  ) {
    return 'summary';
  }

  if (wantsFinanceFullSummary(text)) return 'summary';
  return 'summary';
}

export function extractOwnerName(text: string): string | null {
  const m = text.match(/\b(?:milik|punya)\s+([A-Za-z][\w.-]{1,40})/i);
  return m?.[1] ?? null;
}

export function extractSearchNeedle(text: string): string | null {
  const code = text.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i);
  if (code) return code[1];
  const quoted = text.match(/["“](.+?)["”]/);
  if (quoted) return quoted[1].trim();
  const afterCari = text.match(
    /\b(?:cari|tampilkan|list|daftar|lihat)\s+(?:project|proyek|site|segment|client)?\s*(.+)$/i,
  );
  if (afterCari) {
    const cleaned = afterCari[1]
      .replace(
        /\b(project|proyek|finance|dong|yah|ya|bernama|atas nama|client|pelanggan|yang|active|aktif|closed|archived|arsip|ditutup|site|segment|standalone)\b/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = meaningfulTokens(cleaned).filter(
      (t) => !WEAK_NEEDLES.has(t) && !FINANCE_FILTER_TOKENS.has(t),
    );
    return tokens.length > 0 ? tokens.join(' ') : null;
  }
  // PAI-FNC-003: "site/segment/client <Name>" without code
  const attrName = text.match(
    /\b(?:site|segment|client|pelanggan|nama)\s+([A-Za-z0-9][\w.-]*(?:\s+[A-Za-z0-9][\w.-]*){0,6})/i,
  );
  if (attrName?.[1]) {
    const cleaned = attrName[1]
      .replace(/\b(active|aktif|closed|archived|arsip|budget|berapa)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = meaningfulTokens(cleaned).filter(
      (t) => !WEAK_NEEDLES.has(t) && !FINANCE_FILTER_TOKENS.has(t),
    );
    if (tokens.length > 0) return tokens.join(' ');
  }
  return null;
}

export function meaningfulTokens(text: string): string[] {
  return normalizeId(text)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function fmtIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtDateId(d = new Date()): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(d);
}

export type NavHit = { answer: string; href?: string; sticker: string };

/** Hard navigation answers — never fall back to random KB. */
export function resolveNavigation(text: string): NavHit | null {
  const m = normalizeId(text);

  if (/(daftar dokumen|dokumen)/.test(m)) {
    return {
      sticker: '📁',
      href: '/document-list',
      answer: [
        'Daftar Dokumen bisa kamu buka lewat:',
        '',
        'Sidebar kiri → Dokumen → Daftar Dokumen',
        'atau langsung path: /document-list',
      ].join('\n'),
    };
  }
  if (/(stock|stok|inventory|barang)/.test(m)) {
    return {
      sticker: '📦',
      href: '/stock',
      answer: [
        'Menu stok ada di:',
        '',
        'Sidebar → Inventaris → Stok Barang',
        'atau path: /stock',
        '',
        'Kalau mau tambah barang: buka Stok Barang → klik Tambah Barang.',
      ].join('\n'),
    };
  }
  if (/(cash\s*op|cash operation|pengajuan dana|approval dana)/.test(m)) {
    return {
      sticker: '💸',
      href: '/cash-operation',
      answer: [
        'Menu dana / cash operation:',
        '',
        'Sidebar → Operasional → Cash Operation',
        'Approval Dana: Sidebar → Approval Dana',
      ].join('\n'),
    };
  }
  if (/(finance\s*project|proyek finance)/.test(m)) {
    return {
      sticker: '💰',
      href: '/finance-projects',
      answer:
        'Finance Project ada di:\nSidebar → Dashboard / Manajemen → Finance Projects\npath: /finance-projects',
    };
  }
  if (/(visit request|kunjungan|clean list)/.test(m)) {
    return {
      sticker: '🗺️',
      href: '/clean-list',
      answer:
        'Visit Request dimulai dari:\nSidebar → Clean List → pilih RW → buat Visit Request\npath: /clean-list',
    };
  }
  if (/(permit|pipeline|cluster)/.test(m)) {
    return {
      sticker: '🗺️',
      href: '/permit-clusters',
      answer:
        'Pipeline perizinan:\nSidebar → Pipeline Perizinan / Permit Clusters\npath: /permit-clusters',
    };
  }
  return null;
}

export type UnknownKind =
  | 'no_data'
  | 'no_access'
  | 'no_knowledge'
  | 'retrieval_failed'
  | 'unknown';

/** Transparent unknown handling (PAI-BHV-007). */
export function buildUnknownAnswer(kind: UnknownKind): string {
  switch (kind) {
    case 'no_access':
      return [
        'Saya tidak memiliki akses ke data tersebut berdasarkan hak akses saat ini.',
        'Coba hubungi admin / GM, atau buka menu terkait jika muncul di sidebar.',
      ].join('\n');
    case 'no_data':
      return [
        'Data tersebut memang belum tersedia di sistem untuk scope yang saya akses.',
        'Kalau menurutmu datanya ada di aplikasi, sebutkan nama/kode atau status filter lain supaya aku coba lagi.',
      ].join('\n');
    case 'no_knowledge':
      return [
        'Informasi itu belum ada di knowledge PAI.',
        'Buka menu modul terkait (Finance Project, Cash Operation, Stok, Visit, atau PR).',
      ].join('\n');
    case 'retrieval_failed':
      return [
        'Saya tidak berhasil menemukan data yang diminta.',
        'Kemungkinan terjadi perbedaan filter atau kendala pada proses pencarian.',
        'Alternatif: sebut nama/kode, atau minta ringkasan ACTIVE / non-ARCHIVED.',
      ].join('\n');
    default:
      return [
        'Informasi itu belum bisa aku pastikan dari knowledge maupun database PermaTrax.',
        'Buka menu modul yang dimaksud, atau sebut kode/nama supaya saya cek fakta live.',
      ].join('\n');
  }
}

export function classifyFailureFromTools(
  traces: Array<{ ok: boolean; summary: string }>,
): UnknownKind {
  const text = traces.map((t) => t.summary).join(' ').toLowerCase();
  if (/belum punya akses|tidak memiliki akses|role kamu belum/.test(text))
    return 'no_access';
  // Named search miss → retrieval failure (not "data tidak ada di sistem")
  if (/tidak ditemukan|tidak berhasil|kendala|project tidak ditemukan/.test(text))
    return 'retrieval_failed';
  if (/belum tersedia|tidak ada finance project|count:\s*0|total project\s*:\s*0/.test(text))
    return 'no_data';
  return 'unknown';
}

/** Compare core data lines so correction can detect identical tool results. */
export function answerFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/terima kasih[\s\S]*?hasil pencarian terbaru:?/g, '')
    .replace(/data per[^\n]*/g, '')
    .replace(/data dihitung[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

// ---- Split modules (keep barrel API stable) ----
export {
  extractEntityFromAnswer,
  extractActiveReferenceFromAnswer,
  extractActiveReferenceByDiscriminator,
  pickPendingFinanceCandidate,
  filterPendingFinanceCandidates,
  extractReferenceOrdinal,
  extractExplicitEntityCode,
  extractSessionProjectCode,
  detectRequestedAttribute,
  isOrdinalReference,
  isAttributeFollowUp,
  isActiveReferenceDetailQuery,
  isConversationStateFollowUp,
  resolveActiveReference,
  attributeNeedsLiveLookup,
  buildActiveReferenceDetailAnswer,
  hasConversationalReference,
  buildActiveDatasetKey,
  countRankedItems,
} from './ai-reference';

export {
  isMetaReasoningInquiry,
  isUnknownInformationInquiry,
  isBusinessDiagnosticQuery,
  buildBusinessDiagnosticAnswer,
  buildMetaReasoningAnswer,
  mapResponseStrategy,
} from './ai-strategy';

export {
  refineRecoveryQuery,
  buildCorrectionAckWithRetry,
  buildCorrectionSameResult,
  buildCorrectionRecoveryAnswer,
  buildRecoveryAnswer,
  buildRecoveryFailedAnswer,
} from './ai-recovery';

