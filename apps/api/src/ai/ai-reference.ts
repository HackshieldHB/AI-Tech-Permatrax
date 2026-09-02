/** Active Reference / Active Object / Attribute resolution (PAI-RSN-002 + CSM-002). */

import { normalizeId } from './ai-text';

export type ConversationAttribute =
  | 'status'
  | 'realisasi'
  | 'material_budget'
  | 'jasa_budget'
  | 'remaining'
  | 'budget'
  | 'satuan'
  | 'qty'
  | 'name'
  | 'requestor'
  | null;

export type ResolvedReference = {
  label: string;
  detailLine: string;
  qty?: string;
  unit?: string;
  code?: string;
  ordinal: number;
};

/** Extract project code/name mentioned in last AI answer for "yang tadi". */
export function extractEntityFromAnswer(
  answer: string | null | undefined,
): string | null {
  if (!answer) return null;
  const code = answer.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i);
  if (code) {
    const named = answer.match(
      new RegExp(`${code[1]}\\s*[—-]\\s*([^\\n•]+)`, 'i'),
    );
    if (named?.[1]) return `${code[1]} ${named[1].trim()}`;
    const alt = answer.match(
      new RegExp(`${code[1]}\\s+([^\\n(—-]{2,60})`, 'i'),
    );
    if (alt?.[1]) return `${code[1]} ${alt[1].trim()}`;
    return code[1];
  }
  const biggest = answer.match(
    /project terbesar\s*:\s*((?:SITE|SEG|FIN)-\d{4}-\d+)\s+([^\n(]+)/i,
  );
  if (biggest) return `${biggest[1]} ${biggest[2].trim()}`;
  const ranked = extractActiveReferenceFromAnswer(answer);
  if (ranked) return ranked.label;
  return null;
}

/** SITE/SEG/FIN code from locked Active Object / Active Reference. */
export function extractSessionProjectCode(session: {
  activeObject?: string | null;
  activeReference?: string | null;
}): string | null {
  return (
    extractExplicitEntityCode(session.activeObject || '') ||
    extractExplicitEntityCode(session.activeReference || '')
  );
}

/** Explicit project/stock code in the user utterance. */
export function extractExplicitEntityCode(text: string): string | null {
  const finance = text.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i);
  if (finance) return finance[1].toUpperCase();
  const stock = text.match(/\b([A-Z]{2,}-?\d{2,}[A-Z0-9._-]*)\b/);
  if (stock && !/^(TOP|RP|IDR)\b/i.test(stock[1])) return stock[1];
  return null;
}

export function extractActiveReferenceFromAnswer(
  answer: string | null | undefined,
  ordinal = 1,
): { label: string; detailLine: string; qty?: string; unit?: string; code?: string } | null {
  if (!answer) return null;
  const n = Math.max(1, ordinal);
  const stock = answer.match(
    new RegExp(
      `(?:^|\\n)\\s*${n}\\.\\s*([A-Z0-9][A-Z0-9._-]*)\\s*[—\\-]\\s*([^:\\n]+):\\s*([^\\n(]+)`,
      'i',
    ),
  );
  if (stock) {
    const code = stock[1].trim();
    const name = stock[2].trim();
    const qty = stock[3].trim();
    const unitMatch = qty.match(/([\d.,]+)\s*([A-Za-z]+)?/);
    return {
      label: `${code} — ${name}`,
      detailLine: `${code} — ${name}: ${qty}`,
      qty,
      unit: unitMatch?.[2]?.trim(),
      code,
    };
  }
  const finance = answer.match(
    new RegExp(
      `(?:^|\\n)\\s*${n}\\.\\s*((?:SITE|SEG|FIN)-\\d{4}-\\d+)\\s+([^\\n—\\-]+?)(?:\\s*[—\\-]\\s*([^\\n]+))?`,
      'i',
    ),
  );
  if (finance) {
    const code = finance[1].trim();
    const name = finance[2].trim();
    const rest = (finance[3] || '').trim();
    return {
      label: `${code} ${name}`,
      detailLine: rest ? `${code} ${name} — ${rest}` : `${code} ${name}`,
      qty: rest || undefined,
      code,
    };
  }
  return null;
}

/** Pick a search/list row by SITE/SEGMENT/status wording (PAI-FNC-005 object rule). */
export function extractActiveReferenceByDiscriminator(
  answer: string | null | undefined,
  text: string,
): { label: string; detailLine: string; code?: string } | null {
  if (!answer) return null;
  const m = normalizeId(text);
  const wantSeg = /\bsegment\b|\bseg\b/.test(m);
  const wantSite = /\bsite\b/.test(m) && !wantSeg;
  const wantStand = /\bstandalone\b/.test(m);
  const wantClosed = /\bclosed\b/.test(m);
  const wantActive = /\b(active|aktif)\b/.test(m);
  const codeHint = text.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i)?.[1];
  const lines = answer.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const typed = lines.filter((line) => {
    if (wantSeg)
      return /SEG-\d{4}-\d+|\bSEGMENT\b/i.test(line) && !/\bSITE\b/i.test(line.replace(/SEG-\d{4}-\d+/i, ''));
    if (wantSite)
      return /SITE-\d{4}-\d+|FIN-\d{4}-\d+|\bSITE\b/i.test(line) && !/\bSEGMENT\b/i.test(line);
    if (wantStand) return /STANDALONE/i.test(line);
    if (wantClosed) return /\bCLOSED\b/i.test(line);
    if (wantActive) return /\bACTIVE\b/i.test(line);
    return false;
  });
  const hit =
    (codeHint
      ? typed.find((line) =>
          new RegExp(`\\b${codeHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
            line,
          ),
        ) || lines.find((line) =>
          new RegExp(`\\b${codeHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
            line,
          ),
        )
      : typed[0]) || null;
  if (!hit) return null;
  const code = hit.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i)?.[1];
  return {
    label: code ? `${code}` : hit,
    detailLine: hit.replace(/^\d+\.\s*/, ''),
    code,
  };
}

export type PendingFinanceCandidate = {
  code: string;
  hierarchyLevel: string;
  name: string;
};

/**
 * Filter an existing candidate set. Exact object.code always outranks
 * parent/child relationship matches (PAI-FNC-005).
 */
export function filterPendingFinanceCandidates(
  candidates: PendingFinanceCandidate[] | null | undefined,
  text: string,
): PendingFinanceCandidate[] {
  if (!candidates || candidates.length === 0) return [];
  const m = normalizeId(text);
  const exact = text
    .match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/i)?.[1]
    ?.toUpperCase();
  let pool = candidates;
  if (exact) {
    const byCode = pool.filter((c) => c.code.toUpperCase() === exact);
    if (byCode.length > 0) pool = byCode;
  }
  const wantStand = /\bstandalone\b/.test(m);
  const wantSeg = /\bsegment\b/.test(m) || (/\bseg\b/.test(m) && !exact);
  const wantSite = /\bsite\b/.test(m) && !wantSeg && !wantStand;
  if (wantStand) {
    pool = pool.filter((c) => c.hierarchyLevel === 'STANDALONE');
  } else if (wantSeg) {
    pool = pool.filter(
      (c) => c.hierarchyLevel === 'SEGMENT' || /^SEG-/i.test(c.code),
    );
  } else if (wantSite) {
    pool = pool.filter(
      (c) => c.hierarchyLevel === 'SITE' || /^(SITE|FIN)-/i.test(c.code),
    );
  }
  return pool;
}

export function pickPendingFinanceCandidate(
  candidates:
    | Array<{ code: string; hierarchyLevel: string; name: string }>
    | null
    | undefined,
  text: string,
): { code: string; hierarchyLevel: string; name: string } | null {
  const typed = filterPendingFinanceCandidates(candidates, text);
  return typed.length === 1 ? typed[0] : null;
}

/** Count numbered rows in a ranked/list answer. */
export function countRankedItems(answer: string | null | undefined): number {
  if (!answer) return 0;
  let max = 0;
  for (const m of answer.matchAll(/(?:^|\n)\s*(\d+)\.\s+/g)) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export function extractReferenceOrdinal(
  text: string,
  lastAssistant?: string | null,
): number {
  const m = normalizeId(text);
  if (/\b(yang )?terakhir\b|\bterakhir\b/.test(m)) {
    const n = countRankedItems(lastAssistant);
    return Math.max(1, n || 1);
  }
  if (/\b(yang )?pertama\b|\bke-?1\b|\b#1\b|\b(barang|project|item|proyek)\s+pertama\b/.test(m))
    return 1;
  if (/\b(yang )?kedua\b|\bke-?2\b|\b#2\b|\b(barang|project|item|proyek)\s+kedua\b/.test(m))
    return 2;
  if (/\b(yang )?ketiga\b|\bke-?3\b|\b#3\b|\b(barang|project|item|proyek)\s+ketiga\b/.test(m))
    return 3;
  if (/\b(yang )?keempat\b|\bke-?4\b|\b(barang|project|item|proyek)\s+keempat\b/.test(m))
    return 4;
  if (/\b(yang )?kelima\b|\bke-?5\b/.test(m)) return 5;
  const num = m.match(/\b(?:yang\s+)?ke-?(\d+)\b/);
  if (num) return Math.max(1, parseInt(num[1], 10));
  const barangN = m.match(/\b(?:barang|project|item|proyek)\s+(?:ke-?)?(\d+)\b/);
  if (barangN) return Math.max(1, parseInt(barangN[1], 10));
  return 1;
}

export function detectRequestedAttribute(text: string): ConversationAttribute {
  const m = normalizeId(text);
  if (/(satuan(nya)?)/.test(m) && m.length <= 48) return 'satuan';
  if (/(requestor|pemohon)/.test(m) && m.length <= 64) return 'requestor';
  if (/(material\s*budget|budget\s*material|materialnya)/.test(m))
    return 'material_budget';
  if (/(jasa\s*budget|budget\s*jasa|jasanya)/.test(m)) return 'jasa_budget';
  if (/(sisa\s*budget|remaining|budget\s*tersisa|sisanya)/.test(m))
    return 'remaining';
  if (/(realisasi(nya)?)/.test(m) && m.length <= 48) return 'realisasi';
  if (
    /^(status(nya)?)[.!]?\s*$/.test(m) ||
    (/\bstatus(nya)?\b/.test(m) && m.length <= 40)
  )
    return 'status';
  if (
    /^(jumlah(nya)?|qty|quantity|stoknya|stocknya)[.!]?\s*$/.test(m) ||
    (/(jumlah(nya)?|qty|stoknya|stocknya)/.test(m) && m.length <= 40)
  )
    return 'qty';
  // Bare "budgetnya" — not "budget project" / "ajuin budget"
  if (
    /^(budget(nya)?|nominal(nya)?|nilainya)[.!]?\s*$/.test(m) ||
    (/^(budget(nya)?|nominal(nya)?)\b/.test(m) &&
      m.length <= 24 &&
      !/(project|proyek|ajuin|ajukan|cara|perizinan)/.test(m))
  )
    return 'budget';
  if (
    /^(nama(nya)?|apa\??|yang mana)[.!]?\s*$/.test(m) ||
    (/\b(barang|project|item).+\bapa\??$/.test(m) && m.length <= 40)
  )
    return 'name';
  return null;
}

/** Ordinal / pronoun / entity-style conversational reference. */
export function isOrdinalReference(text: string): boolean {
  const m = normalizeId(text);
  return (
    /\b(yang )?(pertama|kedua|ketiga|keempat|kelima|terakhir|ke-?\d+)\b/.test(
      m,
    ) ||
    /\b(barang|project|item|proyek)\s+(pertama|kedua|ketiga|keempat|terakhir|ke-?\d+)\b/.test(
      m,
    ) ||
    /^(yang tadi|tadi|tersebut|yang sebelumnya|yang barusan|yang terakhir)[.!]?\s*$/.test(
      m,
    )
  );
}

/** Attribute-only follow-up while Active Object is known (CSM-002). */
export function isAttributeFollowUp(text: string): boolean {
  const m = normalizeId(text);
  // Never treat howto / new-request phrasing as attribute follow-up
  if (
    /(ajuin|ajukan|cara|gimana|bagaimana|tambah|buat|tutorial|langkah)/.test(m)
  ) {
    return false;
  }
  // PAI-FNC-004 V2: ranking of a metric is not an Active Object attribute ask
  if (
    /(terbesar|terkecil|tertinggi|terendah|paling besar|paling kecil|paling tinggi|paling rendah|top\s*\d*|highest|lowest|largest|smallest|\bmax\b|\bmin\b|berdasarkan)/.test(
      m,
    )
  ) {
    return false;
  }
  // Strict short attribute phrases
  if (
    /^(status(nya)?|realisasi(nya)?|material\s*budget(nya)?|jasa\s*budget(nya)?|sisa\s*budget(nya)?|remaining|budget(nya)?|jumlah(nya)?|satuan(nya)?|nama(nya)?)[.!]?\s*$/.test(
      m,
    )
  ) {
    return true;
  }
  const attr = detectRequestedAttribute(text);
  if (!attr) return false;
  // Attribute + reference glue, still short
  if (
    m.length <= 48 &&
    (isOrdinalReference(text) ||
      /\b(nya|tadi|itu|tersebut|yang tadi)\b/.test(m) ||
      /^(material|jasa|sisa|realisasi|status|satuan)/.test(m))
  ) {
    return true;
  }
  return false;
}

export function isActiveReferenceDetailQuery(text: string): boolean {
  const m = normalizeId(text);
  const hasRef =
    isOrdinalReference(text) ||
    /\b(yang tadi|tadi|tersebut|yang sebelumnya|yang barusan|itu)\b/.test(m) ||
    /^(jumlahnya|qty|statusnya|requestor|requestornya|berapa|satuannya|satuan|realisasinya|budgetnya)/.test(
      m,
    );
  if (!hasRef && !isAttributeFollowUp(text)) return false;
  if (/(semua|seluruh|list|daftar|tampilkan ulang|ulangi)/.test(m)) return false;
  if (
    /(terbesar|terkecil|top\s*\d*|berdasarkan|paling besar|paling tinggi)/.test(m)
  ) {
    return false;
  }
  // Bare ordinal ("Yang kedua.") is a valid state follow-up
  if (isOrdinalReference(text) && !detectRequestedAttribute(text)) return true;
  return !!detectRequestedAttribute(text);
}

/** Follow-ups that must stay on Conversation State (no Guide / no dataset swap). */
export function isConversationStateFollowUp(text: string): boolean {
  return (
    isOrdinalReference(text) ||
    isAttributeFollowUp(text) ||
    isActiveReferenceDetailQuery(text) ||
    hasConversationalReference(text)
  );
}

export function resolveActiveReference(input: {
  text: string;
  activeReference?: string | null;
  activeObject?: string | null;
  lastAssistant?: string | null;
  datasetAnswer?: string | null;
}): ResolvedReference | null {
  const snapshot = input.datasetAnswer || input.lastAssistant || null;
  const wantsOrdinal = isOrdinalReference(input.text);
  const ordinal = wantsOrdinal
    ? extractReferenceOrdinal(input.text, snapshot)
    : 1;

  if (wantsOrdinal || !input.activeObject) {
    const fromSnap = extractActiveReferenceFromAnswer(snapshot, ordinal);
    if (fromSnap) {
      return { ...fromSnap, ordinal };
    }
  }

  if (input.activeObject || input.activeReference) {
    const label = (input.activeObject || input.activeReference)!;
    const codeMatch = label.match(/\b((?:SITE|SEG|FIN)-\d{4}-\d+|[A-Z0-9][A-Z0-9._-]*)\b/i);
    // Prefer matching line in snapshot for richer detail
    if (snapshot && codeMatch) {
      const lines = snapshot.split(/\n/);
      const hit = lines.find((l) =>
        new RegExp(`\\b${codeMatch[1]}\\b`, 'i').test(l),
      );
      if (hit) {
        return {
          label,
          detailLine: hit.replace(/^\s*\d+\.\s*/, '').trim(),
          code: codeMatch[1],
          ordinal,
        };
      }
    }
    return {
      label,
      detailLine: label,
      code: codeMatch?.[1],
      ordinal,
    };
  }

  const fallback = extractActiveReferenceFromAnswer(snapshot, 1);
  return fallback ? { ...fallback, ordinal: 1 } : null;
}

export function attributeNeedsLiveLookup(
  attr: ConversationAttribute,
  ref: ResolvedReference | null,
): boolean {
  if (!attr) return false;
  if (
    attr === 'material_budget' ||
    attr === 'jasa_budget' ||
    attr === 'remaining'
  ) {
    return true;
  }
  const line = normalizeId(ref?.detailLine || '');
  if (attr === 'realisasi') {
    return !/realisasi/.test(line);
  }
  if (attr === 'status') {
    // Hierarchy tags [SITE]/[SEGMENT] are NOT project status
    return !/\[(active|closed|archived)\]/.test(line) && !/status\s*:/.test(line);
  }
  if (attr === 'budget') {
    return !/(rp|budget)/.test(line);
  }
  return false;
}

export function buildActiveReferenceDetailAnswer(input: {
  text: string;
  activeReference: string | null;
  activeObject?: string | null;
  lastAssistant?: string | null;
  datasetAnswer?: string | null;
  activeTopic?: string | null;
  activeAttribute?: ConversationAttribute;
}): string | null {
  const attr =
    input.activeAttribute !== undefined
      ? input.activeAttribute
      : detectRequestedAttribute(input.text);
  const ref = resolveActiveReference({
    text: input.text,
    activeReference: input.activeReference,
    activeObject: input.activeObject,
    lastAssistant: input.lastAssistant,
    datasetAnswer: input.datasetAnswer,
  });
  if (!ref) return null;

  // Live-needed attributes: signal caller to fetch (return null → targeted tool)
  if (attributeNeedsLiveLookup(attr, ref) && ref.code) {
    return null;
  }

  const ordinalLabel =
    ref.ordinal <= 1 && !isOrdinalReference(input.text)
      ? 'Active Object'
      : ref.ordinal === 1
        ? 'item teratas / yang pertama'
        : ref.ordinal === countRankedItems(input.datasetAnswer || input.lastAssistant)
          ? 'item terakhir'
          : `item urutan ke-${ref.ordinal}`;

  const m = normalizeId(input.text);

  if (attr === 'satuan' || /(satuan(nya)?)/.test(m)) {
    const unit =
      ref.unit || (ref.qty || '').replace(/^[\d.,\s]+/, '').trim() || null;
    return [
      `Referensi ${ordinalLabel}: ${ref.label}`,
      unit ? `Satuannya: ${unit}.` : `Detail tersimpan: ${ref.detailLine}`,
      '',
      'Saya tidak mengulang daftar penuh — hanya atribut Active Object yang diminta.',
    ].join('\n');
  }

  if (attr === 'qty' || /(jumlah|berapa|qty|stoknya|stocknya)/.test(m)) {
    if (ref.qty) {
      return [
        `Yang dimaksud (${ordinalLabel}) dari hasil sebelumnya:`,
        `• ${ref.detailLine}`,
        '',
        `Jumlahnya: ${ref.qty.trim()}.`,
        '',
        'Kalau mau daftar lengkap lagi atau item lain, bilang saja.',
      ].join('\n');
    }
  }

  if (attr === 'status' || /status/.test(m)) {
    const statusFromField = /status\s*:\s*([^\n(]+)/i.exec(ref.detailLine)?.[1];
    const statusFromTag = ref.detailLine.match(
      /\[(ACTIVE|CLOSED|ARCHIVED)\]/i,
    );
    if (statusFromField || statusFromTag) {
      return [
        `Active Object (${ordinalLabel}): ${ref.label}`,
        `Status: ${(statusFromField || statusFromTag![1]).trim()}`,
        '',
        'Conversation State tetap pada object ini. Tanya atribut lain tanpa mengulang daftar.',
      ].join('\n');
    }
    // Snapshot lacks status — caller should live-lookup; fallback text:
    return [
      `Active Object (${ordinalLabel}): ${ref.label}`,
      `Detail dari daftar aktif: ${ref.detailLine}`,
      '',
      'Status lengkap belum ada di daftar ranking — sebutkan kode project untuk cek status live.',
    ].join('\n');
  }

  if (attr === 'realisasi' || /realisasi/.test(m)) {
    const real = ref.detailLine.match(/realisasi\s*([^)\]\n]+)/i);
    return [
      `Active Object (${ordinalLabel}): ${ref.label}`,
      real
        ? `Realisasi (dari daftar aktif): ${real[1].trim()}`
        : `Detail: ${ref.detailLine}`,
      '',
      'Saya tidak mengganti Active Dataset — hanya membaca atribut object yang sama.',
    ].join('\n');
  }

  if (attr === 'budget' || /(budget(nya)?|nominal)/.test(m)) {
    const bud = ref.detailLine.match(/(Rp\s*[\d.]+)/i);
    return [
      `Active Object (${ordinalLabel}): ${ref.label}`,
      bud ? `Budget (dari daftar aktif): ${bud[1]}` : `Detail: ${ref.detailLine}`,
    ].join('\n');
  }

  if (attr === 'name' || /^(apa|nama)/.test(m) || /\bapa\??$/.test(m)) {
    return [
      `Active Object (${ordinalLabel}): ${ref.label}`,
      ref.detailLine !== ref.label ? ref.detailLine : null,
      '',
      'Ini object yang sedang aktif di Conversation State.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (attr === 'requestor' || /requestor/.test(m)) {
    return [
      `Saya belum menyimpan field requestor khusus untuk “${ref.label}” di jawaban sebelumnya.`,
      'Sebutkan kode project/request-nya supaya saya cek data live.',
    ].join('\n');
  }

  // Bare ordinal / generic focus — lock Active Object, no full re-list
  return [
    `Saya fokus ke ${ordinalLabel} dari daftar aktif:`,
    `• ${ref.detailLine}`,
    '',
    'Active Object diperbarui. Silakan tanya atributnya (status, realisasi, material budget, dll) tanpa mengulang daftar.',
  ].join('\n');
}

export function hasConversationalReference(text: string): boolean {
  const m = normalizeId(text);
  return (
    /\b(yang tadi|tadi|tersebut|yang sebelumnya|project itu|yang barusan|yang pertama|yang kedua|yang ketiga|yang keempat|yang kelima|yang terakhir|yang ke-?\d+)\b/.test(
      m,
    ) ||
    /\b(barang|project|item|proyek)\s+(pertama|kedua|ketiga|keempat|terakhir|ke-?\d+)\b/.test(
      m,
    )
  );
}

/** Stable Active Dataset key — must not change without explicit user filter change. */
export function buildActiveDatasetKey(input: {
  topic: string | null;
  ranking?: string | null;
  hierarchy?: string | null;
  status?: string | null;
  query?: string | null;
}): string | null {
  if (!input.topic) return null;
  return [
    input.topic,
    input.ranking || 'none',
    input.hierarchy || 'all',
    input.status || 'default',
    (input.query || '').slice(0, 80),
  ].join('|');
}
