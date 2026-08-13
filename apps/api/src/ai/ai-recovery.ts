/** Recovery refine + user-facing recovery copy (PAI-RSN-003). */

import { normalizeId } from './ai-text';

/**
 * Turn recovery clarification into an executable query.
 * Supports Finance hierarchy/status and Stock ranking switches.
 */
export function refineRecoveryQuery(
  text: string,
  activeTopic: string | null,
  lastDataQuery?: string | null,
  opts?: { lastAssistant?: string | null; activeIntent?: string | null },
): string | null {
  const m = normalizeId(text);

  // Stock ranking refine
  if (
    activeTopic === 'stock' ||
    /(stok|stock|barang)/.test(m) ||
    /(paling sedikit|paling banyak|terendah|tertinggi)/.test(m)
  ) {
    if (
      /(maksud|berdasarkan|bukan itu)/.test(m) ||
      /(paling sedikit|paling banyak|terendah|tertinggi)/.test(m)
    ) {
      if (/(paling banyak|tertinggi|terbesar)/.test(m)) {
        return 'Barang yang stoknya paling banyak';
      }
      if (/(paling sedikit|terendah|terkecil|sedikit)/.test(m)) {
        return 'Barang yang stoknya paling sedikit';
      }
    }
  }

  // Cash refine
  if (activeTopic === 'cash' || /(cash|dana|disburse|cair)/.test(m)) {
    if (/(maksud|bukan itu|berdasarkan)/.test(m)) {
      if (/(pending|approval|belum)/.test(m)) {
        return 'Berapa approval dana yang masih pending?';
      }
      if (/(terakhir|cair|disburse|keluar)/.test(m)) {
        return 'Kapan terakhir dana cair / disbursement?';
      }
    }
  }

  // Visit refine
  if (activeTopic === 'visit' || /visit/.test(m)) {
    if (/(maksud|bukan itu|requestor|pemohon)/.test(m)) {
      if (/(requestor|pemohon|siapa)/.test(m)) {
        return 'Siapa requestor visit request terbaru?';
      }
      return 'Berapa visit request saya yang masih open / status terbaru?';
    }
  }

  if (
    activeTopic !== 'finance' &&
    !/budget|finance|project|aktif|active|site|segment|standalone/.test(m)
  ) {
    return null;
  }

  const prior = normalizeId(lastDataQuery || '');
  const priorAnswer = normalizeId(opts?.lastAssistant || '');
  const wantTop =
    /(terbesar|top\s*\d*|ranking|paling besar)/.test(prior) ||
    /(terbesar|top\s*\d*|ranking|paling besar)/.test(m) ||
    /top\s*10.*budget terbesar|budget terbesar/.test(priorAnswer) ||
    opts?.activeIntent === 'analytics';
  const wantSmall =
    /(terkecil|paling kecil|paling rendah)/.test(prior) ||
    /(terkecil|paling kecil)/.test(m) ||
    /budget terkecil/.test(priorAnswer);

  const hierarchy =
    /\b(site)\b/.test(m) &&
    (/(berdasarkan|maksud|filter|level|hierarki|hanya)/.test(m) ||
      /(bukan itu|salah|recovery|koreksi)/.test(m) ||
      /^\s*(site|segment|standalone)\s*[.!]?\s*$/.test(m) ||
      /(aku|saya)\s+maksud/.test(m))
      ? 'SITE'
      : /\b(segment)\b/.test(m) &&
          (/(berdasarkan|maksud|filter|level|hierarki|hanya)/.test(m) ||
            /(bukan itu|salah)/.test(m) ||
            /^\s*(site|segment|standalone)\s*[.!]?\s*$/.test(m) ||
            /(aku|saya)\s+maksud/.test(m) ||
            /(terbesar|terkecil|top|budget)/.test(m))
        ? 'SEGMENT'
        : /\b(standalone)\b/.test(m) &&
            (/(berdasarkan|maksud|filter|level|hierarki|hanya)/.test(m) ||
              /(bukan itu|salah|aku maksud|saya maksud)/.test(m))
          ? 'STANDALONE'
          : null;

  const bareHierarchy = !hierarchy
    ? /\b(site)\b/.test(m) &&
      !/(site-\d|website)/.test(m) &&
      (/(maksud|bukan|berdasarkan)/.test(m) ||
        opts?.activeIntent === 'analytics')
      ? ('SITE' as const)
      : /\b(segment)\b/.test(m) &&
          (/(maksud|bukan|berdasarkan|terbesar)/.test(m) ||
            opts?.activeIntent === 'analytics')
        ? ('SEGMENT' as const)
        : null
    : null;
  const resolvedHierarchy = hierarchy || bareHierarchy;

  const isRefinePhrase =
    /^(maksudku|maksud saya|yang saya maksud|maksudnya|aku maksud|saya maksud)\b/.test(
      m,
    ) ||
    /(aku|saya)\s+maksud/.test(m) ||
    /\b(aktif|active|seluruh|semua|berdasarkan)\b/.test(m) ||
    !!resolvedHierarchy ||
    (/(bukan itu|salah nangkep)/.test(m) && !!resolvedHierarchy);

  if (!isRefinePhrase) return null;

  if (resolvedHierarchy) {
    const tag = `[HIERARCHY_${resolvedHierarchy}]`;
    if (wantTop) {
      return `Top 10 Finance Project budget terbesar berdasarkan ${resolvedHierarchy} ${tag} [SCOPE_ACTIVE]`;
    }
    if (wantSmall) {
      return `Top 10 Finance Project budget terkecil berdasarkan ${resolvedHierarchy} ${tag} [SCOPE_ACTIVE]`;
    }
    return `Berapa nominal total budget project aktif berdasarkan ${resolvedHierarchy} ${tag}`;
  }

  if (/\b(aktif|active)\b/.test(m) && /budget|project|proyek|finance/.test(m)) {
    return wantTop
      ? 'Top 10 Finance Project budget terbesar [SCOPE_ACTIVE]'
      : 'Berapa nominal total budget project aktif saat ini?';
  }
  if (/\b(aktif|active)\b/.test(m)) {
    return wantTop
      ? 'Top 10 Finance Project budget terbesar [SCOPE_ACTIVE]'
      : 'Berapa nominal total budget project aktif saat ini?';
  }
  if (/(seluruh|semua|non.?arsip)/.test(m)) {
    return wantTop
      ? 'Top 10 Finance Project budget terbesar [BROADER_RETRY]'
      : 'Finance Project ringkasan [BROADER_RETRY]';
  }
  if (/budget/.test(m)) {
    return 'Berapa nominal total budget project aktif saat ini?';
  }
  return null;
}

export function buildCorrectionAckWithRetry(): string {
  return [
    'Terima kasih atas informasinya.',
    'Saya mencoba menggunakan pencarian yang lebih luas karena Anda menyampaikan bahwa project terlihat di aplikasi.',
    '',
    'Berikut hasil pencarian terbaru:',
  ].join('\n');
}

export function buildCorrectionSameResult(): string {
  return [
    'Terima kasih atas informasinya.',
    'Saya sudah mencoba melakukan pencarian ulang dengan strategi berbeda, namun hasilnya masih berbeda dengan tampilan aplikasi / belum berubah.',
    '',
    'Kemungkinan terdapat:',
    '• perbedaan filter (ACTIVE vs Closed/Archived)',
    '• hak akses data',
    '• atau keterlambatan sinkronisasi',
    '',
    'Apabila memungkinkan, mohon sebutkan nama project atau kode project agar saya dapat memverifikasi lebih spesifik.',
  ].join('\n');
}

export function buildCorrectionRecoveryAnswer(input: {
  text: string;
  lastAssistant?: string | null;
  topicHint?: string | null;
}): string {
  const topic = input.topicHint || 'Finance Project';
  return [
    'Terima kasih atas informasinya.',
    '',
    `Kalau di menu ${topic} datanya terlihat berbeda dari hasil saya, kemungkinan filter/status atau hak akses berbeda.`,
    '',
    'Mau saya coba dengan pendekatan lain?',
    '• Ringkasan ACTIVE',
    '• Ringkasan lebih luas (non-ARCHIVED)',
    '• Cari nama/kode project tertentu',
  ].join('\n');
}

export function buildRecoveryAnswer(topicHint?: string | null): string {
  if (topicHint && /finance/i.test(topicHint)) {
    return [
      'Terima kasih atas koreksinya.',
      'Sepertinya saya salah memahami maksud pertanyaan Anda.',
      '',
      'Apakah yang dimaksud seluruh Finance Project atau hanya ACTIVE?',
      'Atau sebutkan nama/kode project yang Anda maksud.',
    ].join('\n');
  }
  if (topicHint && /stok|stock/i.test(topicHint)) {
    return [
      'Terima kasih atas koreksinya.',
      'Sepertinya saya salah memahami maksud pertanyaan stok Anda.',
      '',
      'Maksudnya stok paling sedikit, paling banyak, atau item/kode tertentu?',
    ].join('\n');
  }
  if (topicHint && /cash/i.test(topicHint)) {
    return [
      'Terima kasih atas koreksinya.',
      'Sepertinya saya salah memahami maksud Cash Operation Anda.',
      '',
      'Maksudnya pending approval dana, atau dana terakhir cair?',
    ].join('\n');
  }
  if (topicHint && /visit/i.test(topicHint)) {
    return [
      'Terima kasih atas koreksinya.',
      'Sepertinya saya salah memahami maksud Visit Request Anda.',
      '',
      'Maksudnya jumlah/status visit, atau requestor-nya?',
    ].join('\n');
  }
  return [
    'Terima kasih atas koreksinya.',
    'Sepertinya saya salah memahami maksud pertanyaan Anda.',
    '',
    'Boleh diperjelas lagi — modul mana (Finance, Cash Op, Stok, Procurement, dll) dan apa yang ingin dicek?',
  ].join('\n');
}

export function buildRecoveryFailedAnswer(): string {
  return [
    'Terima kasih atas masukannya.',
    'Saya sudah mencoba melakukan pendekatan lain, namun hasil yang saya peroleh masih belum sesuai.',
    'Kemungkinan terdapat keterbatasan akses data atau perbedaan filter.',
    '',
    'Apabila memungkinkan, mohon sebutkan nama project agar saya dapat melakukan verifikasi yang lebih spesifik.',
  ].join('\n');
}
