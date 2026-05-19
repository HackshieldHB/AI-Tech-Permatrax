import type { BudgetTransferStatus } from '../types/api.types';

type LabelInfo = { label: string; className: string };

export const TRANSFER_STATUS_LABELS: Record<BudgetTransferStatus, LabelInfo> = {
  PENDING_GM_APPROVAL: {
    label: 'Menunggu persetujuan GM',
    className: 'bg-amber-100 text-amber-900',
  },
  APPROVED: { label: 'Disetujui', className: 'bg-emerald-100 text-emerald-900' },
  REJECTED: { label: 'Ditolak', className: 'bg-red-100 text-red-900' },
  CANCELLED: { label: 'Dibatalkan', className: 'bg-slate-100 text-slate-700' },
};
