/** Trim FAQ answers to the asked intent without changing seed knowledge. */

import { normalizeId } from './ai-text';
import {
  isBusinessRoleResponsibilityQuery,
  isRoleCapabilityQuery,
} from './ai-nlu';

const GUARDRAIL =
  /(jangan menukar|bukan daftar|bukan pencarian|bukan lookup|bukan ranking|bukan validator|ini aturan|ini definisi konsep|ini panduan role|saya tidak akan|kode project\/cluster hanya|bukan informasi yang dibutuhkan)/i;

const NAV_UNASKED =
  /(mulai dari menu|path\s*:|path \/|\/permit-clusters|\/clean-list|\/finance-projects|untuk daftar tahap|tanya “tahapan)/i;

function splitSentences(content: string): string[] {
  return content
    .replace(/\s+/g, ' ')
    .split(/(?<=\.)\s+(?=[A-Z“"A-Z])|(?<=\.)\s+(?=[A-ZÀ-ž])/)
    .flatMap((p) => p.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function isNavQuestion(query: string): boolean {
  const m = normalizeId(query);
  return /(dimana|di mana|\bletak\b|menu mana|buka dimana|path)/.test(m);
}

function isComparisonQuestion(query: string): boolean {
  const m = normalizeId(query);
  return /(apa bedanya|perbedaan|vs\b|versus|dibanding)/.test(m);
}

function isPurposeOnlyQuestion(query: string): boolean {
  const m = normalizeId(query);
  if (/\bapa itu\b|\bitu apa\b/.test(m)) return false;
  return /(buat apa|digunakan untuk apa|\buntuk apa\b)/.test(m);
}

function stripGuardrails(sentences: string[], query: string): string[] {
  const navOk = isNavQuestion(query);
  return sentences.filter((s) => {
    if (GUARDRAIL.test(s)) return false;
    if (!navOk && NAV_UNASKED.test(s)) return false;
    return true;
  });
}

function firstClause(sentence: string): string {
  const cut = sentence.split(/\s*;\s*/)[0].trim();
  return cut.replace(/\s+—\s+mulai dari[^.]*/i, '').trim();
}

function extractRoleCapability(content: string, query: string): string | null {
  const m = normalizeId(query);
  const role = /\bsurveyor\b/.test(m)
    ? 'surveyor'
    : /\bfinance\b/.test(m)
      ? 'finance'
      : /\badmin stok\b/.test(m)
        ? 'admin stok'
        : /\badmin\b/.test(m)
          ? 'admin'
          : /\bpm\b/.test(m)
            ? 'pm'
            : null;
  if (!role) return null;
  const re = new RegExp(
    `(${role}(?:\\s+dapat)?)\\s*:\\s*(.+?)(?=\\s+(?:Admin Stok|Admin|PM|Surveyor|GM|Finance)\\s*:|$)`,
    'i',
  );
  const hit = content.match(re);
  if (!hit) return null;
  const body = hit[2]
    .replace(/\s*Mulai dari[\s\S]*/i, '')
    .replace(/\s*Ini panduan[\s\S]*/i, '')
    .replace(/\s*—\s*mulai dari[\s\S]*/i, '')
    .trim();
  const label = hit[1].trim();
  const sentence = `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${body}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function scopeWhoAnswer(query: string, content: string): string | null {
  const m = normalizeId(query);
  const comparesRoles =
    /(bedanya|perbedaan)/.test(m) &&
    /(admin|pm|finance).*(admin|pm|finance)/.test(m);
  if (comparesRoles) return null;
  if (/validasi/.test(m) && /bakp/.test(m) && /(upload|unggah)/.test(m)) {
    return 'Admin bertanggung jawab mengunggah/melengkapi dokumen BAKP, sedangkan validasi BAKP dilakukan oleh PM.';
  }
  if (/validasi/.test(m) && /bakp/.test(m)) {
    return 'Validasi BAKP dilakukan oleh PM.';
  }
  if (/(upload|unggah)/.test(m) && /bakp/.test(m)) {
    return 'Admin bertanggung jawab mengunggah/melengkapi BAKP.';
  }
  const pic = splitSentences(content).find((s) =>
    /pic|penanggung jawab|pm project/i.test(s),
  );
  if (pic && /(pic|perizinan\s*pu)/.test(m)) {
    return firstClause(pic.replace(/\s*Ini aturan[\s\S]*/i, ''));
  }
  return null;
}

function scopeComparison(query: string, sentences: string[]): string[] {
  const m = normalizeId(query);
  if (/(hld|lld|apd|abd)/.test(m)) {
    return sentences.filter(
      (s) =>
        /(apd|hld|abd|lld)/i.test(s) &&
        !/^SIP\s*:/i.test(s) &&
        !/designer upload/i.test(s) &&
        !/pm membuat apd/i.test(s) &&
        !/\bDRM\b/i.test(s),
    );
  }
  if (/(ba open|bakp|\bbak\b)/.test(m)) {
    return sentences
      .filter((s) => /^(BA Open|BAK|BAKP)\s*:/i.test(s) || /BA Open adalah/i.test(s))
      .map((s) => firstClause(s));
  }
  return sentences;
}

function scopeDefinition(query: string, sentences: string[]): string[] {
  const purposeOnly = isPurposeOnlyQuestion(query);
  const purpose = sentences.filter((s) =>
    /(dipakai untuk|digunakan untuk|digunakan khusus|untuk mengelola)/i.test(s),
  );
  const definition = sentences.filter((s) =>
    /(apa itu|merupakan|adalah tahap|adalah pipeline|adalah )/i.test(s),
  );
  if (purposeOnly && purpose.length) return purpose.slice(0, 2);
  const merged = [...definition, ...purpose].filter(
    (s, i, arr) => arr.indexOf(s) === i,
  );
  return (merged.length ? merged : sentences).slice(0, 2);
}

/** Keep only the knowledge needed to answer the asked intent. */
export function scopeKnowledgeAnswer(query: string, content: string): string {
  if (!content?.trim()) return content;
  const sentences = stripGuardrails(splitSentences(content), query);
  if (!sentences.length) return content.trim();

  if (isBusinessRoleResponsibilityQuery(query) && !isComparisonQuestion(query)) {
    const who = scopeWhoAnswer(query, content);
    if (who) return who.trim();
  }

  if (isRoleCapabilityQuery(query) && !isNavQuestion(query)) {
    const cap = extractRoleCapability(content, query);
    if (cap) return cap;
  }

  if (isComparisonQuestion(query)) {
    const cmp = scopeComparison(query, sentences);
    if (cmp.length) return cmp.join(' ');
  }

  if (
    /\bapa itu\b|\bitu apa\b|buat apa|digunakan untuk apa|pengertian|definisi/.test(
      normalizeId(query),
    )
  ) {
    return scopeDefinition(query, sentences).join(' ');
  }

  return sentences.join(' ');
}
