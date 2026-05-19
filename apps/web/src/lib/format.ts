/** Shared IDR / date formatting for finance and reports. */

export function formatRupiah(value: string | number, opts?: { withSymbol?: boolean }): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(num)) return '—';
  const formatted = num.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return opts?.withSymbol === false ? formatted : `Rp ${formatted}`;
}

export function formatPercentage(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDateID(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTimeID(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const date = formatDateID(dateStr);
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}
