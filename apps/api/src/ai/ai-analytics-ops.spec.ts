import {
  buildDescribeAnswer,
  buildIntraObjectCompareAnswer,
  buildMultiMetricCompareAnswer,
  buildPremiseAnswer,
  buildRatioCompareAnswer,
  detectAnalyticalRequest,
  executeAnalyticalOperation,
  extractFinanceCodes,
  isFinanceInterpretationQuery,
  isObjectScopedReference,
  looksLikeOpaqueId,
  realizationPct,
  toOperand,
} from './ai-analytics-ops';

const fin001 = toOperand({
  code: 'FIN-2026-001',
  name: 'iForte Bandung 1',
  status: 'ACTIVE',
  hierarchyLevel: 'STANDALONE',
  totalBudget: 1_000_000_000,
  materialBudget: 500_000_000,
  jasaBudget: 500_000_000,
  materialSpent: 5_556_680,
  jasaSpent: 1_100_000,
});

const fin005 = toOperand({
  code: 'FIN-2026-005',
  name: 'Project Lima',
  status: 'ACTIVE',
  hierarchyLevel: 'STANDALONE',
  totalBudget: 3_000_000_000,
  materialBudget: 1_000_000_000,
  jasaBudget: 1_000_000_000,
  materialSpent: 0,
  jasaSpent: 0,
});

describe('PAI-DIQ-010/012 analytics ops', () => {
  it('scopes "project ini" as object reference, not ranking', () => {
    const q = 'Dari data project ini, bagaimana kondisi budget dan realisasinya?';
    expect(isObjectScopedReference(q)).toBe(true);
    expect(isFinanceInterpretationQuery(q)).toBe(true);
    expect(detectAnalyticalRequest(q)?.kind).toBe('describe');
  });

  it('DIQ-021 describe stays on one object and includes ratio', () => {
    const text = buildDescribeAnswer(fin001);
    expect(text).toMatch(/FIN-2026-001/);
    expect(text).toMatch(/bukan ranking global/);
    expect(text).toMatch(/0[,.]67|0\.67%/);
    expect(text).not.toMatch(/Top 10/);
  });

  it('DIQ-022 compares realization/budget percentage, not absolute realisasi', () => {
    const q =
      'Bandingkan FIN-2026-001 dengan FIN-2026-005. Project mana yang persentase realisasinya terhadap budget lebih besar?';
    expect(extractFinanceCodes(q)).toEqual(['FIN-2026-001', 'FIN-2026-005']);
    expect(detectAnalyticalRequest(q)?.kind).toBe('ratio_compare');
    const text = buildRatioCompareAnswer([fin001, fin005]);
    expect(text).toMatch(/Realisasi \/ Total Budget/i);
    expect(text).toMatch(/FIN-2026-001/);
    expect(text).toMatch(/0%/);
    expect(realizationPct(fin001)).toBeGreaterThan(realizationPct(fin005));
  });

  it('DIQ-023 intra-object compare preserves equality and difference', () => {
    const q =
      'Dari material budget dan jasa budgetnya, mana yang lebih besar dan berapa selisihnya?';
    expect(detectAnalyticalRequest(q)?.kind).toBe('intra_compare');
    const text = buildIntraObjectCompareAnswer(fin005);
    expect(text).toMatch(/sama besar/);
    expect(text).toMatch(/Rp\s*0|Rp0/);
  });

  it('DIQ-028 multi-metric compare reports budget AND realization', () => {
    const q =
      'Bandingkan FIN-2026-001 dan FIN-2026-005 dari budget dan realisasinya. Apa perbedaan utamanya berdasarkan data yang tersedia?';
    expect(detectAnalyticalRequest(q)?.kind).toBe('multi_metric_compare');
    const text = buildMultiMetricCompareAnswer([fin001, fin005]);
    expect(text).toMatch(/Budget DAN Realisasi/);
    expect(text).toMatch(/FIN-2026-005 memiliki Total Budget lebih besar/);
    expect(text).toMatch(/FIN-2026-001 memiliki Realisasi lebih besar/);
    expect(text).not.toMatch(/lebih baik/);
  });

  it('DIQ-029 does not infer Rp0 realization as project not started', () => {
    const text = buildPremiseAnswer(fin005);
    expect(text).toMatch(/tidak membuktikan bahwa project belum mulai/);
    expect(text).toMatch(/Observed financial state/);
  });

  it('treats CUID as opaque, not a business transaction number', () => {
    expect(looksLikeOpaqueId('cmrlxd6zi001eq0he23eexdra')).toBe(true);
    expect(looksLikeOpaqueId('RM-2026-0004')).toBe(false);
  });

  it('causal why stops at evidence boundary', () => {
    const out = executeAnalyticalOperation(
      { kind: 'causal_why', metrics: ['realization'] },
      [fin001],
      { entryType: 'BUDGET_INIT', amount: 1_000_000_000 },
    );
    expect(out.summary).toMatch(/Why1/);
    expect(out.summary).toMatch(/Why3/);
    expect(out.summary).toMatch(/Why4 = unknown/);
    expect(out.causal?.boundaryReached).toBe(true);
  });
});
