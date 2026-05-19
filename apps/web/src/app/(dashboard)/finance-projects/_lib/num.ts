/** Parse API Decimal (string | number) safely. */
export function num(v: string | number | null | undefined): number {
  if (v == null || v === '') return 0;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
