/**
 * PAI-DIQ-010 / 012 — map resolved operands to the requested analytical
 * operation. Retrieval/ranking stay elsewhere; this layer only executes
 * describe / compare / ratio / difference / multi-metric / causal bounds.
 */

import { normalizeId } from './ai-text';

function fmtIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

export type FinanceOperand = {
  id?: string;
  code: string;
  name: string;
  status?: string;
  hierarchyLevel?: string;
  totalBudget: number;
  materialBudget: number;
  jasaBudget: number;
  materialSpent: number;
  jasaSpent: number;
  isOverbudget?: boolean;
};

export type LedgerFact = {
  entryType: string;
  amount?: number;
  createdAt?: Date | string | null;
};

export type AnalyticalKind =
  | 'describe'
  | 'ratio_compare'
  | 'intra_compare'
  | 'multi_metric_compare'
  | 'absolute_compare'
  | 'causal_why'
  | 'hypothesis'
  | 'premise';

export type AnalyticalRequest = {
  kind: AnalyticalKind;
  metrics: Array<'budget' | 'realization' | 'material' | 'jasa' | 'remaining'>;
  hypothesis?: string | null;
};

const CODE_RE = /\b((?:SITE|SEG|FIN)-\d{4}-\d+)\b/gi;

export function extractFinanceCodes(text: string): string[] {
  const out: string[] = [];
  const tagged = text.match(/\[ACTIVE_OBJECT:((?:SITE|SEG|FIN)-\d{4}-\d+)\]/i);
  if (tagged?.[1]) out.push(tagged[1].toUpperCase());
  let m: RegExpExecArray | null;
  const re = new RegExp(CODE_RE.source, 'gi');
  while ((m = re.exec(text))) {
    const code = m[1].toUpperCase();
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export function isObjectScopedReference(text: string): boolean {
  const m = normalizeId(text);
  return (
    /\b(project|proyek|data)\s+(ini|itu|tersebut)\b/.test(m) ||
    /\bdari data\b/.test(m) ||
    /\bdata project (ini|itu|tersebut)\b/.test(m) ||
    /\bproject ini\b/.test(m) ||
    /\bproyek ini\b/.test(m)
  );
}

export function isExplicitRankingUtterance(text: string): boolean {
  const m = normalizeId(text);
  return /(top\s*\d*|terbesar|terkecil|ranking|paling besar|paling kecil|paling tinggi|paling rendah)/.test(
    m,
  );
}

/** "bagaimana kondisi budget" is live-data interpretation, not a Guide howto. */
export function isFinanceInterpretationQuery(text: string): boolean {
  const m = normalizeId(text);
  if (/(cara |tutorial|langkah|ajuin|ajukan|add stock|tambah barang)/.test(m)) {
    return false;
  }
  if (isExplicitRankingUtterance(text)) return false;
  const hasMetric =
    /(budget|anggaran|realisasi|material|jasa|sisa|persentase|selisih)/.test(m);
  const asksCondition =
    /(bagaimana|gimana|kondisi|hubungan|interpretasi|bandingkan|dibanding|mana yang|lebih besar|selisih)/.test(
      m,
    );
  return hasMetric && (asksCondition || isObjectScopedReference(text));
}

export function isCausalQuery(text: string): boolean {
  const m = normalizeId(text);
  if (/(kenapa|mengapa).*(kamu|pai)/.test(m)) return false;
  return (
    /(kenapa|mengapa|penyebab|akar masalah|5\s*why|five why)/.test(m) ||
    /(apakah karena|karena .*(berarti|jadi)|berarti .*belum)/.test(m)
  );
}

export function isCausalFollowUp(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(penyebab berikutnya|kenapa lagi|terus kenapa|lebih dalam lagi|why (berikutnya|lagi)|terus\??$)/.test(
      m,
    ) ||
    /^(terus\??|lalu\??|kenapa\??|mengapa\??|penyebabnya\??)$/.test(m)
  );
}

export function isPendingApprovalQuery(text: string): boolean {
  const m = normalizeId(text);
  return (
    /(pending\s*approval|menunggu approval|belum (di)?(approve|setujui)|yang pending)/.test(
      m,
    ) ||
    /(tampilkan|list|daftar).*(pending).*(approval|cash|dana)/.test(m) ||
    /(cash operation|pengajuan dana|approval dana).*(pending)/.test(m)
  );
}

export function detectAnalyticalRequest(text: string): AnalyticalRequest | null {
  const lines = text
    .split(/\n/)
    .map((l) =>
      l.replace(/^\(konteks( referensi)?:\s*/i, '').replace(/\)\s*$/, '').trim(),
    )
    .filter(Boolean);
  const candidates = [text, ...lines].filter(Boolean);
  for (const candidate of candidates) {
    const hit = detectAnalyticalRequestOn(candidate);
    if (hit) return hit;
  }
  return null;
}

function detectAnalyticalRequestOn(text: string): AnalyticalRequest | null {
  const m = normalizeId(text);
  if (isExplicitRankingUtterance(text) && !/(bandingkan|persentase|selisih)/.test(m)) {
    return null;
  }

  const metrics: AnalyticalRequest['metrics'] = [];
  if (/(material)/.test(m)) metrics.push('material');
  if (/(jasa|service)/.test(m)) metrics.push('jasa');
  if (/(realisasi|spent|terpakai)/.test(m)) metrics.push('realization');
  if (/(sisa|remaining)/.test(m)) metrics.push('remaining');
  if (/(budget|anggaran)/.test(m) && !metrics.includes('material') && !metrics.includes('jasa')) {
    metrics.push('budget');
  } else if (/(budget|anggaran)/.test(m) && metrics.includes('realization')) {
    if (!metrics.includes('budget')) metrics.unshift('budget');
  }

  const wantsRatio =
    /(persentase|percent|%|rasio|ratio|terhadap budget)/.test(m);
  const wantsDiff = /(selisih|beda(nya)?|perbedaan|difference)/.test(m);
  const wantsCompare =
    /(bandingkan|dibanding|versus|\bvs\b|mana yang (lebih|besar)|lebih besar)/.test(
      m,
    );
  const wantsDescribe =
    /(bagaimana|gimana|kondisi|hubungan).*(budget|realisasi)/.test(m) ||
    (isObjectScopedReference(text) &&
      /(budget|realisasi)/.test(m) &&
      !wantsCompare);
  const hypothesis =
    m.match(/apakah karena (.+?)[?.!]?$/)?.[1] ||
    (/(invoice|vendor|pm |lapangan|approval)/.test(m) &&
    /(karena|apakah)/.test(m)
      ? m
      : null);
  const premiseNotStarted =
    /(belum mulai|belum dikerjakan|belum jalan|not started)/.test(m) &&
    /(berarti|jadi|berarti project)/.test(m);

  if (isCausalQuery(text) && premiseNotStarted) {
    return { kind: 'premise', metrics, hypothesis };
  }
  if (isCausalQuery(text) && hypothesis) {
    return { kind: 'hypothesis', metrics, hypothesis };
  }
  if (isCausalQuery(text)) {
    return { kind: 'causal_why', metrics };
  }

  const codes = extractFinanceCodes(text);
  if (wantsRatio && (wantsCompare || codes.length >= 2)) {
    return { kind: 'ratio_compare', metrics: metrics.length ? metrics : ['realization', 'budget'] };
  }
  if (
    wantsCompare &&
    wantsDiff &&
    (metrics.includes('material') || metrics.includes('jasa')) &&
    codes.length <= 1
  ) {
    return { kind: 'intra_compare', metrics: ['material', 'jasa'] };
  }
  if (wantsCompare && metrics.includes('budget') && metrics.includes('realization')) {
    return { kind: 'multi_metric_compare', metrics: ['budget', 'realization'] };
  }
  if (wantsCompare && codes.length >= 2) {
    return { kind: 'absolute_compare', metrics: metrics.length ? metrics : ['realization'] };
  }
  if (wantsDescribe || (isObjectScopedReference(text) && metrics.length > 0)) {
    return { kind: 'describe', metrics: metrics.length ? metrics : ['budget', 'realization'] };
  }
  if (wantsDiff && (metrics.includes('material') || metrics.includes('jasa'))) {
    return { kind: 'intra_compare', metrics: ['material', 'jasa'] };
  }
  return null;
}

export function realizationOf(p: FinanceOperand): number {
  return Number(p.materialSpent || 0) + Number(p.jasaSpent || 0);
}

export function remainingOf(p: FinanceOperand): number {
  return Number(p.totalBudget || 0) - realizationOf(p);
}

export function realizationPct(p: FinanceOperand): number {
  const b = Number(p.totalBudget || 0);
  if (b <= 0) return 0;
  return (realizationOf(p) / b) * 100;
}

export function pctLabel(n: number): string {
  if (n === 0) return '0%';
  if (n < 0.01) return `${n.toFixed(4)}%`;
  if (n < 1) return `${n.toFixed(2)}%`;
  return `${n.toFixed(2)}%`;
}

function labelOf(p: FinanceOperand): string {
  return `${p.code} — ${p.name}`;
}

export function buildDescribeAnswer(p: FinanceOperand): string {
  const real = realizationOf(p);
  const rem = remainingOf(p);
  const pct = realizationPct(p);
  return [
    `Interpretasi object-scoped untuk ${labelOf(p)} (bukan ranking global):`,
    `• Total Budget = ${fmtIdr(Number(p.totalBudget))}`,
    `• Realisasi = ${fmtIdr(real)} (${pctLabel(pct)} dari budget)`,
    `• Sisa = ${fmtIdr(rem)}`,
    `• Material budget ${fmtIdr(Number(p.materialBudget))} | Jasa budget ${fmtIdr(Number(p.jasaBudget))}`,
    `• Material spent ${fmtIdr(Number(p.materialSpent))} | Jasa spent ${fmtIdr(Number(p.jasaSpent))}`,
    pct < 5
      ? 'Hanya sebagian kecil dari total budget yang sudah terealisasi berdasarkan data saat ini.'
      : `Tingkat realisasi terhadap budget saat ini ${pctLabel(pct)}.`,
  ].join('\n');
}

export function buildRatioCompareAnswer(rows: FinanceOperand[]): string {
  if (rows.length < 2) {
    return rows[0] ? buildDescribeAnswer(rows[0]) : 'Operand perbandingan belum lengkap.';
  }
  const scored = rows.map((p) => ({
    p,
    pct: realizationPct(p),
    real: realizationOf(p),
  }));
  const lines = scored.map(
    (s) =>
      `• ${s.p.code}: Realisasi ${fmtIdr(s.real)} / Budget ${fmtIdr(Number(s.p.totalBudget))} = ${pctLabel(s.pct)}  (operasi: Realisasi / Total Budget × 100%)`,
  );
  const winner = [...scored].sort((a, b) => b.pct - a.pct)[0];
  const tied = scored.filter((s) => s.pct === winner.pct);
  const conclusion =
    tied.length > 1
      ? `Persentase realisasi terhadap budget sama (${pctLabel(winner.pct)}).`
      : `${winner.p.code} memiliki persentase realisasi terhadap budget lebih besar (${pctLabel(winner.pct)}).`;
  return [
    'Perbandingan rasio yang diminta (bukan nominal Realisasi absolut):',
    ...lines,
    conclusion,
  ].join('\n');
}

export function buildIntraObjectCompareAnswer(p: FinanceOperand): string {
  const mat = Number(p.materialBudget || 0);
  const jasa = Number(p.jasaBudget || 0);
  const diff = Math.abs(mat - jasa);
  let who: string;
  if (mat === jasa) {
    who = `Material Budget dan Jasa Budget sama besar, masing-masing ${fmtIdr(mat)}, sehingga selisihnya ${fmtIdr(0)}.`;
  } else if (mat > jasa) {
    who = `Material Budget lebih besar (${fmtIdr(mat)}) dibanding Jasa Budget (${fmtIdr(jasa)}). Selisih = ${fmtIdr(diff)}.`;
  } else {
    who = `Jasa Budget lebih besar (${fmtIdr(jasa)}) dibanding Material Budget (${fmtIdr(mat)}). Selisih = ${fmtIdr(diff)}.`;
  }
  return [
    `Perbandingan intra-object pada ${labelOf(p)}:`,
    `• COMPARE(Material Budget, Jasa Budget)`,
    `• ABS(Material − Jasa) = ${fmtIdr(diff)}`,
    who,
  ].join('\n');
}

export function buildMultiMetricCompareAnswer(rows: FinanceOperand[]): string {
  if (rows.length < 2) {
    return rows[0] ? buildDescribeAnswer(rows[0]) : 'Operand perbandingan belum lengkap.';
  }
  const [a, b] = rows;
  const budgetWinner =
    Number(a.totalBudget) === Number(b.totalBudget)
      ? null
      : Number(a.totalBudget) > Number(b.totalBudget)
        ? a
        : b;
  const realWinner =
    realizationOf(a) === realizationOf(b)
      ? null
      : realizationOf(a) > realizationOf(b)
        ? a
        : b;
  const budgetLine = budgetWinner
    ? `${budgetWinner.code} memiliki Total Budget lebih besar (${fmtIdr(Number(budgetWinner.totalBudget))}).`
    : `Total Budget kedua project sama (${fmtIdr(Number(a.totalBudget))}).`;
  const realLine = realWinner
    ? `${realWinner.code} memiliki Realisasi lebih besar (${fmtIdr(realizationOf(realWinner))}) berdasarkan data saat ini.`
    : `Realisasi kedua project sama (${fmtIdr(realizationOf(a))}).`;
  return [
    `Perbandingan multi-metric (Budget DAN Realisasi) — tanpa penilaian performa:`,
    `• ${a.code}: Budget ${fmtIdr(Number(a.totalBudget))} | Realisasi ${fmtIdr(realizationOf(a))}`,
    `• ${b.code}: Budget ${fmtIdr(Number(b.totalBudget))} | Realisasi ${fmtIdr(realizationOf(b))}`,
    budgetLine,
    realLine,
  ].join('\n');
}

export function buildAbsoluteCompareAnswer(
  rows: FinanceOperand[],
  metric: AnalyticalRequest['metrics'][number] = 'realization',
): string {
  if (rows.length < 2) {
    return rows[0] ? buildDescribeAnswer(rows[0]) : 'Operand perbandingan belum lengkap.';
  }
  const val = (p: FinanceOperand) => {
    if (metric === 'budget') return Number(p.totalBudget);
    if (metric === 'material') return Number(p.materialBudget);
    if (metric === 'jasa') return Number(p.jasaBudget);
    if (metric === 'remaining') return remainingOf(p);
    return realizationOf(p);
  };
  const metricLabel =
    metric === 'budget'
      ? 'Total Budget'
      : metric === 'material'
        ? 'Material Budget'
        : metric === 'jasa'
          ? 'Jasa Budget'
          : metric === 'remaining'
            ? 'Sisa Budget'
            : 'Realisasi';
  const scored = rows.map((p) => ({ p, v: val(p) }));
  const winner = [...scored].sort((a, b) => b.v - a.v)[0];
  return [
    `Perbandingan ${metricLabel}:`,
    ...scored.map((s) => `• ${s.p.code}: ${fmtIdr(s.v)}`),
    scored.filter((s) => s.v === winner.v).length > 1
      ? `${metricLabel} sama besar.`
      : `${winner.p.code} lebih besar pada ${metricLabel} (${fmtIdr(winner.v)}).`,
  ].join('\n');
}

export function buildCausalWhyAnswer(
  p: FinanceOperand,
  ledger?: LedgerFact | null,
): { answer: string; depth: number; boundaryReached: boolean } {
  const real = realizationOf(p);
  const rem = remainingOf(p);
  const pct = realizationPct(p);
  const why1 = `Why1: Realisasi ${fmtIdr(real)} masih jauh di bawah Total Budget ${fmtIdr(Number(p.totalBudget))} (sisa ${fmtIdr(rem)}, ${pctLabel(pct)} terealisasi).`;
  const why2 = `Why2: Material spent ${fmtIdr(Number(p.materialSpent))} | Jasa spent ${fmtIdr(Number(p.jasaSpent))}${p.isOverbudget ? ' | flag overbudget = true' : ' | flag overbudget = tidak aktif'}.`;
  const ledgerLabel = ledger?.entryType || 'tidak ada baris ledger';
  const why3 = `Why3: ledger terakhir ${ledgerLabel}${ledger?.amount != null ? ` sebesar ${fmtIdr(Number(ledger.amount))}` : ''}. Ini fakta ledger, bukan otomatis akar penyebab operasional.`;
  const boundary = [
    'Why4 = unknown — bukti operasional penyebab utama tidak tersedia di data Finance Project saat ini.',
    'Why5 = unknown — permintaan 5-Why tidak menambah kedalaman jika evidencenya habis.',
    'Batas kausal tercapai: data menunjukkan kondisi keuangan, tetapi tidak menetapkan penyebab operasional (invoice, PM, lapangan, dsb).',
  ];
  return {
    answer: [
      `5-why PAI (hanya fakta DB; level tanpa data = unknown) — ${labelOf(p)}`,
      why1,
      why2,
      why3,
      ...boundary,
    ].join('\n'),
    depth: 3,
    boundaryReached: true,
  };
}

export function buildHypothesisAnswer(
  p: FinanceOperand,
  hypothesis: string | null,
): string {
  const real = realizationOf(p);
  return [
    `Fakta yang didukung data: ${p.code} saat ini memiliki Realisasi ${fmtIdr(real)}.`,
    `Hipotesis kausal pengguna${hypothesis ? ` (“${hypothesis.trim()}”)` : ''} tidak dapat dikonfirmasi dari evidence Finance yang tersedia.`,
    'PAI tidak mengadopsi penjelasan invoice/vendor/PM/lapangan kecuali ada bukti independen di database.',
  ].join('\n');
}

export function buildPremiseAnswer(p: FinanceOperand): string {
  const real = realizationOf(p);
  return [
    `Observasi: Realisasi ${p.code} = ${fmtIdr(real)}.`,
    'Realisasi Rp0 (atau rendah) hanya berarti tidak ada realisasi keuangan tercatat pada data yang tersedia.',
    'Itu tidak membuktikan bahwa project belum mulai dikerjakan — status operasional membutuhkan evidence independen (progress, log implementasi, visit, dsb).',
    `Status Finance yang tercatat: ${p.status || 'n/a'} (${p.hierarchyLevel || 'n/a'}). Observed financial state ≠ operational causality.`,
  ].join('\n');
}

export function buildCausalBoundaryHoldAnswer(objectLabel?: string | null): string {
  return [
    'Batas kausal sudah tercapai pada giliran sebelumnya.',
    objectLabel ? `Object: ${objectLabel}` : null,
    'Tidak ada Why berikutnya yang didukung evidence baru. Repeated questioning tidak menambah data.',
    'Penyebab lebih dalam tetap unknown sampai ada evidence baru, object berubah, atau scope analitik berubah.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function executeAnalyticalOperation(
  req: AnalyticalRequest,
  rows: FinanceOperand[],
  ledger?: LedgerFact | null,
): { summary: string; deterministic: true; causal?: { depth: number; boundaryReached: boolean } } {
  if (req.kind === 'describe' && rows[0]) {
    return { summary: buildDescribeAnswer(rows[0]), deterministic: true };
  }
  if (req.kind === 'ratio_compare') {
    return { summary: buildRatioCompareAnswer(rows), deterministic: true };
  }
  if (req.kind === 'intra_compare' && rows[0]) {
    return { summary: buildIntraObjectCompareAnswer(rows[0]), deterministic: true };
  }
  if (req.kind === 'multi_metric_compare') {
    return { summary: buildMultiMetricCompareAnswer(rows), deterministic: true };
  }
  if (req.kind === 'absolute_compare') {
    return {
      summary: buildAbsoluteCompareAnswer(rows, req.metrics[0] || 'realization'),
      deterministic: true,
    };
  }
  if (req.kind === 'hypothesis' && rows[0]) {
    return {
      summary: buildHypothesisAnswer(rows[0], req.hypothesis || null),
      deterministic: true,
      causal: { depth: 3, boundaryReached: true },
    };
  }
  if (req.kind === 'premise' && rows[0]) {
    return {
      summary: buildPremiseAnswer(rows[0]),
      deterministic: true,
      causal: { depth: 3, boundaryReached: true },
    };
  }
  if (req.kind === 'causal_why' && rows[0]) {
    const why = buildCausalWhyAnswer(rows[0], ledger);
    return {
      summary: why.answer,
      deterministic: true,
      causal: { depth: why.depth, boundaryReached: why.boundaryReached },
    };
  }
  return {
    summary: rows[0] ? buildDescribeAnswer(rows[0]) : 'Data object belum tersedia untuk operasi yang diminta.',
    deterministic: true,
  };
}

export function toOperand(row: {
  id?: string;
  code: string;
  name: string;
  status?: string;
  hierarchyLevel?: string;
  totalBudget: unknown;
  materialBudget?: unknown;
  jasaBudget?: unknown;
  materialSpent?: unknown;
  jasaSpent?: unknown;
  isOverbudget?: boolean;
}): FinanceOperand {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    hierarchyLevel: row.hierarchyLevel,
    totalBudget: Number(row.totalBudget || 0),
    materialBudget: Number(row.materialBudget || 0),
    jasaBudget: Number(row.jasaBudget || 0),
    materialSpent: Number(row.materialSpent || 0),
    jasaSpent: Number(row.jasaSpent || 0),
    isOverbudget: !!row.isOverbudget,
  };
}

export function looksLikeOpaqueId(value: string | null | undefined): boolean {
  if (!value) return true;
  return /^c[a-z0-9]{20,}$/i.test(value.trim());
}

export function businessTransactionLabel(input: {
  requestNumber?: string | null;
  activity?: string | null;
  category?: string | null;
  projectName?: string | null;
  financeCode?: string | null;
  financeName?: string | null;
  requester?: string | null;
  dateLabel?: string | null;
}): string {
  if (input.requestNumber && !looksLikeOpaqueId(input.requestNumber)) {
    return input.requestNumber;
  }
  const bits = [
    input.financeCode,
    input.activity || input.category,
    input.projectName,
    input.requester,
    input.dateLabel,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Transaksi tanpa kode bisnis (identifikasi dari project/aktivitas/nominal)';
}
