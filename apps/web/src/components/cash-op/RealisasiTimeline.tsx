'use client';

import type { CashOpRealisasiStep } from '../../types/api.types';
import { formatDateId } from '../../lib/cash-op-utils';

const ROLE_UI: Record<string, string> = {
  FINANCE: 'Finance',
  GENERAL_MANAGER: 'General Manager',
};

const STATUS_ID: Record<string, string> = {
  PENDING: 'Menunggu keputusan',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  SKIPPED: 'Dilewati',
};

export function RealisasiTimeline({ steps }: { steps: CashOpRealisasiStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-slate-500">Belum ada riwayat persetujuan realisasi.</p>;
  }

  return (
    <div className="space-y-3">
      {steps.map((s) => {
        const dot =
          s.status === 'APPROVED' ? 'bg-emerald-500' : s.status === 'REJECTED' ? 'bg-red-500' : 'bg-amber-400';
        return (
          <div key={s.id} className="flex gap-3">
            <div className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800">
                {ROLE_UI[s.approverRole] ?? s.approverRole.replace(/_/g, ' ')}
              </p>
              <p className="text-xs text-slate-500">{STATUS_ID[s.status] ?? s.status}</p>
              {s.approver?.name ? <p className="text-xs text-slate-500">{s.approver.name}</p> : null}
              {s.approvedAt ? (
                <p className="text-xs text-slate-400">{formatDateId(s.approvedAt)}</p>
              ) : null}
              {s.notes ? <p className="text-xs text-slate-600 mt-1">{s.notes}</p> : null}
              {s.rejectionReason ? (
                <p className="text-xs text-red-600 mt-1">Alasan: {s.rejectionReason}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
