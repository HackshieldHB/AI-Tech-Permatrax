export type BakpDocumentCategory = 'KOMPENSASI' | 'KOORDINASI';

export type BakpDocumentDefinition = {
  key: string;
  label: string;
  mandatory: boolean;
  category: BakpDocumentCategory;
};

export const BAKP_KOMPENSASI_DOCS: BakpDocumentDefinition[] = [
  { key: 'mom', label: 'MOM', mandatory: true, category: 'KOMPENSASI' },
  { key: 'baOpen', label: 'BA OPEN', mandatory: true, category: 'KOMPENSASI' },
  { key: 'baSurvey', label: 'BA Survey', mandatory: true, category: 'KOMPENSASI' },
  { key: 'baTtdRt', label: 'BA TTD RT', mandatory: true, category: 'KOMPENSASI' },
  { key: 'fcBukuTabungan', label: 'FC Buku Tabungan', mandatory: true, category: 'KOMPENSASI' },
  { key: 'sip', label: 'SIP', mandatory: true, category: 'KOMPENSASI' },
  { key: 'ktpRtRw', label: 'KTP RT RW', mandatory: true, category: 'KOMPENSASI' },
  { key: 'pks', label: 'PKS', mandatory: true, category: 'KOMPENSASI' },
  { key: 'kwitansi', label: 'Kwitansi', mandatory: true, category: 'KOMPENSASI' },
  { key: 'evidencePayment', label: 'Evidence Payment & Bukti Transfer', mandatory: true, category: 'KOMPENSASI' },
  { key: 'skInternalIlt', label: 'SK Internal ILT, PO/SPK', mandatory: true, category: 'KOMPENSASI' },
];

export const BAKP_KOORDINASI_DOCS: BakpDocumentDefinition[] = [
  { key: 'baOpen3Pihak', label: 'BA Open TTD 3 Pihak', mandatory: false, category: 'KOORDINASI' },
  { key: 'kwitansiKoord', label: 'Kwitansi', mandatory: false, category: 'KOORDINASI' },
  { key: 'fotoEvidence', label: 'Foto Evidence', mandatory: false, category: 'KOORDINASI' },
  { key: 'evidencePaymentKoord', label: 'Evidence Payment', mandatory: false, category: 'KOORDINASI' },
  { key: 'skInternalIltKoord', label: 'SK Internal ILT', mandatory: false, category: 'KOORDINASI' },
  { key: 'poSpkKoord', label: 'PO/SPK', mandatory: false, category: 'KOORDINASI' },
];

export const BAKP_ALL_DOCS: BakpDocumentDefinition[] = [...BAKP_KOMPENSASI_DOCS, ...BAKP_KOORDINASI_DOCS];

export const BAKP_MANDATORY_KEYS = new Set(BAKP_KOMPENSASI_DOCS.map((doc) => doc.key));
