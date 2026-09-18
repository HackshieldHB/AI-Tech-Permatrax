/** PAI Phase 0 — visible product contract (can / cannot / unknown). */

export const PAI_CAPABILITY_CAN_ITEMS = [
  'Fakta live: Finance Project, Stok, Cash Operation, Visit Request, Purchase Request (jumlah, ranking, cari kode/nama, filter status/SITE/SEGMENT, PIC).',
  '5-why terbatas: angka DB (budget vs realisasi, material/jasa, status cash/cluster) lalu berhenti di unknown.',
  'Cara pakai / letak menu jika ada di knowledge, sesuai Active Module.',
];

export const PAI_CAPABILITY_CANNOT_ITEMS = [
  'Akar masalah cerita / 5-why lengkap (audit, komentar, invoice line, timeline BA) — PAI tidak mengarang Why4–5.',
  'Opini hukum atau data di luar role Anda.',
  'PII (email, telepon, NIK) dan angka yang tidak ada di tool/database.',
];

export const PAI_CAPABILITY_UNKNOWN =
  'Kalau tidak tahu: tolak 1–2 kalimat + arahkan ke menu modul — bukan dump Guide.';

export function buildPaiCapabilityCard(): string {
  return [
    'Kartu kemampuan PAI',
    '',
    'Bisa:',
    ...PAI_CAPABILITY_CAN_ITEMS.map((l) => `• ${l}`),
    '',
    'Tidak bisa:',
    ...PAI_CAPABILITY_CANNOT_ITEMS.map((l) => `• ${l}`),
    '',
    PAI_CAPABILITY_UNKNOWN,
  ].join('\n');
}
