/**
 * Response Strategy selection + meta / unknown-information answers (PAI P1 / RSN-004).
 */

import { normalizeId } from './ai-text';
import type { ResponseStrategy, RetrievalStrategy } from './ai-session';

export function mapResponseStrategy(
  intent: string,
  strategy?: RetrievalStrategy,
  refusal?: boolean,
): ResponseStrategy {
  if (refusal) return 'refusal';
  if (intent === 'meta') return 'meta_reasoning';
  if (intent === 'capability') return 'capability';
  if (intent === 'recovery' || strategy === 'recovery') return 'recovery';
  if (intent === 'clarify' || strategy === 'clarify') return 'clarification';
  if (intent === 'howto' || strategy === 'howto') return 'howto';
  if (intent === 'navigation') return 'navigation';
  if (intent === 'analytics') return 'operational_analytics';
  if (intent === 'data' || intent === 'comparison') return 'operational_data';
  if (intent === 'correction') return 'recovery';
  if (intent === 'off_topic') return 'refusal';
  return 'none';
}

export function isUnknownInformationInquiry(text: string): boolean {
  const m = normalizeId(text);
  if (
    /(kalau|jika|apabila|bila).*(datanya|data|informasi).*(memang )?(tidak|belum).*(ada|tersedia|ketemu|ditemukan)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /(kalau|jika|apabila).*(datanya|data).*(kosong|empty|blank)/.test(m) ||
    /(kalau|jika|apabila).*(kosong).*(data|hasil|retrieval)/.test(m)
  ) {
    return true;
  }
  if (
    /(kalau|jika|apabila).*(tidak|belum).*(ada|tersedia).*(data|informasi|hasil)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /(kalau|jika|apabila).*(kamu|pai|anda).*(tidak tahu|nggak tahu|gak tahu|tidak tau|ga tau)/.test(
      m,
    ) ||
    /^kalau (kamu|pai) tidak tahu/.test(m)
  ) {
    return true;
  }
  if (
    /(kalau|jika|apabila).*(akses(ku| saya| anda)?|hak akses).*(tidak|belum|kurang).*(cukup|ada|boleh)/.test(
      m,
    ) ||
    /(kalau|jika).*(tidak|belum).*(punya|memiliki).*(akses)/.test(m)
  ) {
    return true;
  }
  if (
    /(apa yang|bagaimana|gimana).*(kamu|pai).*(kalau|jika|apabila).*(data|informasi).*(tidak|belum|kosong)/.test(
      m,
    )
  ) {
    return true;
  }
  if (/^kalau datanya (memang )?tidak ada/.test(m)) return true;
  if (/^kalau datanya kosong/.test(m)) return true;
  if (/^kalau kamu (tidak|nggak|gak) tahu/.test(m)) return true;
  return false;
}

/** Causal / 5-why about the business — not “kenapa kamu (PAI) jawab…”. */
export function isBusinessDiagnosticQuery(text: string): boolean {
  if (isMetaReasoningInquiry(text)) return false;
  const m = normalizeId(text);
  return (
    /(kenapa|mengapa|mengapakah)/.test(m) ||
    /(\b5\s*-?\s*whys?\b|\bfive\s*whys?\b)/.test(m) ||
    /(akar masalah|root cause)/.test(m)
  );
}

export function buildBusinessDiagnosticAnswer(input: {
  code?: string | null;
  factSummary?: string | null;
}): string {
  if (input.factSummary) {
    return input.factSummary;
  }
  return [
    'PAI tidak punya riwayat penyebab (5-why, audit, komentar, atau timeline status). Saya tidak akan mengarang alasan kenapa angka atau status itu terjadi.',
    '',
    'Tool yang ada hanya menampilkan fakta live: status, total budget, material, jasa, realisasi, dan sisa.',
    '',
    input.code
      ? `Kode ${input.code} tidak ketemu di data live, jadi saya tidak bisa menambahkan fakta budget/realisasi.`
      : 'Sebutkan kode project (contoh SEG-2026-005) supaya saya lampirkan fakta live. Tanpa kode, saya tidak menjalankan ringkasan Finance / ranking sebagai pengganti jawaban “kenapa”.',
  ].join('\n');
}

export function isMetaReasoningInquiry(text: string): boolean {
  const m = normalizeId(text);
  if (isUnknownInformationInquiry(text)) return true;
  if (
    /(bagaimana|gimana).*(kamu|pai|anda).*(hitung|menghitung|dapat|ambil|cari|jawab|proses)/.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /(mengapa|kenapa).*(kamu|pai).*(jawab|bilang|kasih|tampilkan|pilih|memilih)/.test(
      m,
    )
  ) {
    return true;
  }
  if (/(kenapa|mengapa).*(kamu|pai).*(pilih|memilih).*(jawaban|itu)/.test(m)) {
    return true;
  }
  if (
    /(belum yakin|tidak yakin|kurang yakin|kalau.*yakin|tingkat keyakinan|confidence|kalau kamu ragu|kalau.*ragu)/.test(
      m,
    )
  ) {
    return true;
  }
  if (/(dari mana).*(angka|data|jawaban|budget)/.test(m)) return true;
  if (/(jelaskan).*(cara|proses).*(hitung|reasoning|ambil data)/.test(m))
    return true;
  return false;
}

export function buildMetaReasoningAnswer(input: {
  text: string;
  lastReasoningNote?: string | null;
  lastDataQuery?: string | null;
  activeTopic?: string | null;
}): string {
  const m = normalizeId(input.text);

  if (
    /(akses(ku| saya)?|hak akses).*(tidak|belum|kurang)|(tidak|belum).*(punya|memiliki).*(akses)/.test(
      m,
    )
  ) {
    return [
      'Kalau hak akses Anda tidak cukup untuk data yang diminta, saya akan bilang secara eksplisit bahwa akses terbatas — tanpa mengarang angka dan tanpa mengalihkan ke definisi modul atau Guide.',
      '',
      'Biasanya saya sarankan: minta role yang sesuai, atau buka menu terkait jika tersedia di sidebar Anda.',
      '',
      'Ini pertanyaan tentang keterbatasan akses, bukan permintaan data operasional baru.',
    ].join('\n');
  }

  if (
    /(tidak tahu|nggak tahu|gak tahu|tidak tau|ga tau|kalau kamu ragu|kalau.*ragu)/.test(
      m,
    ) &&
    /(kalau|jika|apabila|belum yakin|keyakinan)/.test(m)
  ) {
    return [
      'Kalau saya tidak tahu atau ragu, saya akan mengakuinya secara eksplisit — misalnya data kosong, knowledge belum tersedia, atau hasil pencarian gagal — alih-alih mengarang atau mengisi dengan definisi modul / Guide.',
      '',
      'Saya tidak akan “mengisi kekosongan” dengan FAQ generik. Saya akan minta filter/kode tambahan atau arahkan ke menu yang relevan.',
      '',
      'Ini pertanyaan tentang perilaku saya saat informasi tidak tersedia, bukan permintaan data operasional.',
    ].join('\n');
  }

  if (
    isUnknownInformationInquiry(input.text) ||
    /(datanya|data).*(kosong|tidak ada|belum tersedia)/.test(m)
  ) {
    return [
      'Kalau datanya kosong / memang tidak ada di database atau scope akses Anda, saya akan bilang secara eksplisit bahwa hasilnya kosong atau belum tersedia — tanpa mengarang angka, tanpa ganti ke modul lain, dan tanpa meminta “ACTIVE vs seluruh” kecuali filternya memang ambigu.',
      '',
      'Yang biasanya saya lakukan:',
      '• Sampaikan bahwa data tidak ditemukan / count 0 / field belum tersedia',
      '• Jelaskan batasan (akses role, filter status, atau fitur belum diekspos ke PAI)',
      '• Tawarkan langkah lanjut: ubah filter, sebutkan kode, atau buka menu terkait',
      '',
      'Ini pertanyaan tentang perilaku saya saat informasi absen — bukan permintaan data operasional baru, jadi saya tidak menjalankan retrieval ulang.',
    ].join('\n');
  }
  if (/(belum yakin|tidak yakin|kurang yakin|kalau.*yakin|keyakinan)/.test(m)) {
    return [
      'Kalau saya belum yakin, saya akan bilang secara eksplisit — misalnya data belum tersedia, akses terbatas, atau hasil pencarian kosong — alih-alih mengarang angka.',
      '',
      'Saya tidak akan mengganti jawaban dengan ringkasan modul lain hanya karena keyakinan rendah.',
      input.lastReasoningNote
        ? `\nUntuk jawaban sebelumnya: ${input.lastReasoningNote}`
        : '',
      '',
      'Kalau Anda ingin data operasional lagi, sebutkan metriknya (budget ACTIVE, stok terendah, dll).',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    'Saya menghitung / mengambil jawaban dari data live database PermaTrax (tool analytics) sesuai Active Module dan filter yang dipakai — bukan dari tebakan.',
    input.lastDataQuery
      ? `Pertanyaan operasional terakhir yang saya proses: “${input.lastDataQuery.trim()}”.`
      : null,
    input.lastReasoningNote
      ? `Cara saya mendapatkannya: ${input.lastReasoningNote}`
      : 'Biasanya: deteksi intent → pilih tool/modul aktif → query database → susun ringkasan.',
    input.activeTopic
      ? `Active Module saat itu: ${input.activeTopic}.`
      : null,
    '',
    'Saya tidak mengulang retrieval project detail kecuali Anda meminta data baru.',
  ]
    .filter(Boolean)
    .join('\n');
}
