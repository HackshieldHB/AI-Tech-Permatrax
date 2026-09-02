/**
 * Honest, data-backed 5-why templates (PAI Phase 3).
 * Stop at the first unknown level. Never invent a story.
 */

import { fmtIdr } from './ai-nlu';

export type FinanceExplainPack = {
  code: string;
  name: string;
  status: string;
  hierarchyLevel: string;
  totalBudget: number;
  materialBudget: number;
  jasaBudget: number;
  materialSpent: number;
  jasaSpent: number;
  isOverbudget: boolean;
  poCustomerNumber: string | null;
  poApprovalStatus: string | null;
  parentCode: string | null;
  ledgerNotes: string[];
  cashPendingCount: number;
  cashLatestStatus: string | null;
};

export type WhyFocus = 'overbudget' | 'realization' | 'generic';

function ratioPct(part: number, whole: number): string {
  if (!whole) return 'n/a (budget 0)';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function detectWhyFocus(text: string): WhyFocus {
  const m = text.toLowerCase();
  if (/(over\s*budget|overbudget)/.test(m)) return 'overbudget';
  if (/(realisasi|spent|kecil|rendah|sedikit)/.test(m)) return 'realization';
  return 'generic';
}

export function buildFinanceWhyTemplate(
  pack: FinanceExplainPack,
  focus: WhyFocus = 'generic',
): string {
  const spent = pack.materialSpent + pack.jasaSpent;
  const remaining = pack.totalBudget - spent;
  const facts = [
    `${pack.code} — ${pack.name}`,
    `• Status: ${pack.status} (${pack.hierarchyLevel})`,
    pack.parentCode ? `• Parent: ${pack.parentCode}` : null,
    `• Total Budget: ${fmtIdr(pack.totalBudget)} | Realisasi: ${fmtIdr(spent)} | Sisa: ${fmtIdr(remaining)}`,
    `• Material: budget ${fmtIdr(pack.materialBudget)} / spent ${fmtIdr(pack.materialSpent)} (${ratioPct(pack.materialSpent, pack.materialBudget)})`,
    `• Jasa: budget ${fmtIdr(pack.jasaBudget)} / spent ${fmtIdr(pack.jasaSpent)} (${ratioPct(pack.jasaSpent, pack.jasaBudget)})`,
    pack.isOverbudget ? '• Flag overbudget: YA' : '• Flag overbudget: tidak',
    pack.poCustomerNumber
      ? `• PO Customer: ${pack.poCustomerNumber} (${pack.poApprovalStatus || 'NONE'})`
      : null,
  ].filter(Boolean) as string[];

  const why1 =
    focus === 'overbudget'
      ? pack.isOverbudget
        ? `Why1: Realisasi ${fmtIdr(spent)} melebihi / menandai overbudget terhadap Total Budget ${fmtIdr(pack.totalBudget)} (flag overbudget = YA).`
        : `Why1: Project ini TIDAK overbudget. Realisasi ${fmtIdr(spent)} vs Total Budget ${fmtIdr(pack.totalBudget)}.`
      : `Why1: Realisasi ${fmtIdr(spent)} = ${ratioPct(spent, pack.totalBudget)} dari Total Budget ${fmtIdr(pack.totalBudget)} (sisa ${fmtIdr(remaining)}).`;

  const why2 = `Why2: Split driver yang ada di DB — Material spent ${fmtIdr(pack.materialSpent)} dari budget ${fmtIdr(pack.materialBudget)}; Jasa spent ${fmtIdr(pack.jasaSpent)} dari budget ${fmtIdr(pack.jasaBudget)}.`;

  let why3: string;
  if (pack.ledgerNotes.length) {
    why3 = `Why3: Catatan ledger terakhir: ${pack.ledgerNotes.slice(0, 3).join(' | ')}.`;
  } else if (pack.cashPendingCount > 0) {
    why3 = `Why3: Ada ${pack.cashPendingCount} pengajuan dana terkait yang masih pending${pack.cashLatestStatus ? ` (status terakhir ${pack.cashLatestStatus})` : ''}.`;
  } else if (
    pack.poApprovalStatus &&
    pack.poApprovalStatus !== 'NONE' &&
    pack.poApprovalStatus !== 'APPROVED'
  ) {
    why3 = `Why3: PO Customer status = ${pack.poApprovalStatus}${pack.poCustomerNumber ? ` (${pack.poCustomerNumber})` : ''}.`;
  } else {
    why3 =
      'Why3: unknown — PAI tidak punya audit 5-why, komentar, invoice line, atau timeline status. Berhenti di sini; tidak mengarang Why4–5.';
  }

  return [
    '5-why PAI (hanya fakta DB; level tanpa data = unknown):',
    '',
    ...facts,
    '',
    why1,
    why2,
    why3,
  ].join('\n');
}

export function buildCashWhyTemplate(input: {
  pendingSummary: string | null;
  pendingCount: number;
}): string {
  const why1 = input.pendingCount
    ? `Why1: Ada ${input.pendingCount} pengajuan dana yang masih di rantai approval (belum cair).`
    : 'Why1: Tidak ada pengajuan dana pending di scope akses Anda.';
  return [
    '5-why PAI untuk pencairan (hanya status cash op):',
    '',
    why1,
    input.pendingSummary || 'Tidak ada baris pending.',
    '',
    'Why2: unknown — PAI tidak punya alasan hold/reject di luar status + approver saat ini. Berhenti; tidak mengarang Why3–5.',
  ].join('\n');
}

export function buildClusterWhyTemplate(input: {
  clusterCode: string | null;
  phase: string | null;
  status: string | null;
  daysSinceUpdate: number | null;
  holdNote: string | null;
}): string {
  if (!input.clusterCode) {
    return [
      '5-why PAI untuk cluster:',
      '',
      'Why1: unknown — tidak ada cluster yang cocok di scope akses Anda. Sebutkan cluster code.',
      'Why2: unknown — berhenti; tidak mengarang.',
    ].join('\n');
  }
  const why1 = `Why1: Cluster ${input.clusterCode} status ${input.status || 'unknown'}, fase ${input.phase || 'unknown'}${
    input.daysSinceUpdate != null
      ? `, terakhir update ${input.daysSinceUpdate} hari lalu`
      : ''
  }.`;
  const why2 = input.holdNote
    ? `Why2: Catatan hold/stage: ${input.holdNote}.`
    : 'Why2: unknown — tidak ada ON_HOLD reason / stage note di DB.';
  return [
    '5-why PAI untuk cluster (fase + status; bukan cerita lapangan):',
    '',
    why1,
    why2,
    'Why3: unknown — PAI tidak punya timeline lengkap tiap dokumen. Berhenti; tidak mengarang Why4–5.',
  ].join('\n');
}
