import type { CashOperationRequest, CashOpApprovalStep } from '../types/api.types';

const WIB_TIMEZONE = 'Asia/Jakarta';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Next calendar day (UTC date arithmetic) from y-m-d parts.
 */
function addOneCalendarDay(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const ms = Date.UTC(y, m - 1, d + 1);
  return {
    y: new Date(ms).getUTCFullYear(),
    m: new Date(ms).getUTCMonth() + 1,
    d: new Date(ms).getUTCDate(),
  };
}

/**
 * Realisasi window opens at 00:00 WIB on the calendar day after periodeTo's date in WIB.
 * Selaras dengan `computeRealisasiOpenAtUtc` di API (`wib-realisasi-window.util.spec.ts`); Indonesia tanpa DST.
 */
export function computeRealisasiOpenAt(periodeTo: string | null): Date | null {
  if (!periodeTo) return null;
  const parsed = new Date(periodeTo);
  if (Number.isNaN(parsed.getTime())) return null;
  const wibDateStr = parsed.toLocaleDateString('en-CA', { timeZone: WIB_TIMEZONE });
  const [y, mo, day] = wibDateStr.split('-').map(Number);
  const next = addOneCalendarDay(y, mo, day);
  const iso = `${next.y}-${pad2(next.m)}-${pad2(next.d)}T00:00:00+07:00`;
  return new Date(iso);
}

export function isRealisasiOpen(cashOp: CashOperationRequest, now: Date = new Date()): boolean {
  if (cashOp.type !== 'CASH_ADVANCE') return false;
  const isApprovedOrDisbursed = cashOp.status === 'APPROVED' || cashOp.status === 'DISBURSED' || cashOp.status === 'REALISASI_IN_PROGRESS';
  if (!isApprovedOrDisbursed) return false;

  if (!cashOp.approvedAt) return false;
  const approvedAt = new Date(cashOp.approvedAt);
  return now.getTime() >= approvedAt.getTime();
}

export function formatRealisasiOpenAt(periodeTo: string | null): string {
  const openAt = computeRealisasiOpenAt(periodeTo);
  if (!openAt) return '—';
  return (
    openAt.toLocaleString('id-ID', {
      timeZone: WIB_TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB'
  );
}

export function formatRupiah(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('id-ID');
}

export function formatDateId(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('id-ID', { timeZone: WIB_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Ceiling for current approval step: latest approved amount from prior steps, else request amount.
 */
export function computeApprovalCeiling(
  approvalSteps: CashOpApprovalStep[],
  currentStepOrder: number,
  requestAmount: string | number,
): string {
  const previousApproved = approvalSteps
    .filter((s) => s.status === 'APPROVED' && s.stepOrder < currentStepOrder)
    .sort((a, b) => b.stepOrder - a.stepOrder)[0];

  if (previousApproved?.approvedAmount != null && previousApproved.approvedAmount !== '') {
    return String(previousApproved.approvedAmount);
  }
  return String(requestAmount);
}
