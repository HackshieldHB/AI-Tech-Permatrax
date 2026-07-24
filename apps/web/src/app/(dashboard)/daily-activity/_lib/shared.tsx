import React from 'react';

export type DailyActivityWorkStatus = 'ON_PROGRESS' | 'ON_HOLD' | 'DONE';

export const EVIDENCE_ACCEPT = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.zip';

export type DailyActivity = {
  id: string;
  timestamp: string;
  siteName: string | null;
  scopeOfWork: string;
  workStatus: DailyActivityWorkStatus;
  evidenceUrl: string | null;
  targetDoneAt: string | null;
  remarks: string | null;
  lastReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  actor: { id: string; name: string; email: string };
  updatedBy: { id: string; name: string; email: string } | null;
  financeProject: { id: string; code: string; name: string } | null;
  ftttProject: { id: string; projectName: string | null; ftttCompany: string } | null;
  _count?: { evidences: number; history: number };
};

/** "Lihat Detail" only appears once the activity carries something worth reviewing:
 * it has been updated after creation, has legacy/multi-file evidence, or has history. */
export function hasActivityDetail(a: DailyActivity): boolean {
  if (a.evidenceUrl) return true;
  if ((a._count?.evidences ?? 0) > 0) return true;
  if ((a._count?.history ?? 0) > 0) return true;
  const created = new Date(a.createdAt).getTime();
  const updated = new Date(a.updatedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created > 60_000; // more than 1 minute apart = a real update happened
}

export const STATUS_LABELS: Record<DailyActivityWorkStatus, { label: string; className: string }> = {
  ON_PROGRESS: { label: 'On Progress', className: 'bg-blue-50 text-blue-700' },
  ON_HOLD: { label: 'On Hold', className: 'bg-amber-50 text-amber-800' },
  DONE: { label: 'Done', className: 'bg-emerald-50 text-emerald-700' },
};

export function StatusBadge({ status }: { status: DailyActivityWorkStatus }) {
  const cfg = STATUS_LABELS[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
