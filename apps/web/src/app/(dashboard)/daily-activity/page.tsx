'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Search, RefreshCw, Pencil, Eye, Paperclip, X } from 'lucide-react';
import { apiGetPaginated, apiPatch, apiPostForm } from '../../../lib/api';
import { formatDateID, formatDateTimeID } from '../../../lib/format';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import { useAuthStore } from '../../../store/authStore';
import {
  EVIDENCE_ACCEPT,
  hasActivityDetail,
  STATUS_LABELS,
  StatusBadge,
  type DailyActivity,
  type DailyActivityWorkStatus,
} from './_lib/shared';

function isOverdue(activity: DailyActivity): boolean {
  if (activity.workStatus === 'DONE' || !activity.targetDoneAt) return false;
  return new Date(activity.targetDoneAt).getTime() < Date.now();
}

// ─── Update modal ───────────────────────────────────────────────────────────
function UpdateModal({
  activity,
  onClose,
  onSaved,
}: {
  activity: DailyActivity;
  onClose: () => void;
  onSaved: (updated: DailyActivity) => void;
}) {
  const [workStatus, setWorkStatus] = useState<DailyActivityWorkStatus>(activity.workStatus);
  const [targetDoneAt, setTargetDoneAt] = useState(
    activity.targetDoneAt ? activity.targetDoneAt.slice(0, 10) : '',
  );
  const [remarks, setRemarks] = useState(activity.remarks ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(activity.evidenceUrl ?? '');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsTargetDoneAt = workStatus === 'ON_PROGRESS' || workStatus === 'ON_HOLD';
  const needsRemarks = workStatus === 'ON_HOLD';

  const removeFile = (idx: number) => {
    setEvidenceFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (needsTargetDoneAt && !targetDoneAt) {
      toast.error('Target selesai wajib diisi untuk status ini');
      return;
    }
    if (needsRemarks && !remarks.trim()) {
      toast.error('Keterangan wajib diisi untuk status On Hold');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiPatch<DailyActivity>(`/daily-activities/${activity.id}`, {
        workStatus,
        targetDoneAt: workStatus === 'DONE' ? null : targetDoneAt ? new Date(targetDoneAt).toISOString() : null,
        remarks: remarks.trim() || null,
        evidenceUrl: evidenceUrl.trim() || null,
      });

      let finalActivity: DailyActivity = updated;
      if (evidenceFiles.length > 0) {
        const formData = new FormData();
        evidenceFiles.forEach((f) => formData.append('files', f));
        const withEvidence = await apiPostForm<{
          evidenceUrl: string | null;
          _count?: { evidences: number; history: number };
        }>(`/daily-activities/${activity.id}/evidence`, formData);
        finalActivity = { ...updated, evidenceUrl: withEvidence.evidenceUrl, _count: withEvidence._count };
      }

      toast.success('Daily activity diperbarui');
      onSaved(finalActivity);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memperbarui aktivitas');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
        <div>
          <h4 className="font-bold text-slate-900">Update Status Aktivitas</h4>
          <p className="text-xs text-slate-500 mt-1">{activity.scopeOfWork}</p>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">Status</label>
          <select
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            value={workStatus}
            onChange={(e) => setWorkStatus(e.target.value as DailyActivityWorkStatus)}
          >
            <option value="ON_PROGRESS">On Progress</option>
            <option value="ON_HOLD">On Hold</option>
            <option value="DONE">Done</option>
          </select>
        </div>

        {needsTargetDoneAt && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">Target Selesai</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              value={targetDoneAt}
              onChange={(e) => setTargetDoneAt(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">
            Keterangan {needsRemarks ? <span className="text-red-500">*wajib untuk On Hold</span> : '(opsional)'}
          </label>
          <textarea
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Alasan on hold / catatan progres..."
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">URL Evidence (opsional, legacy)</label>
          <input
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">Bukti Pekerjaan (opsional, multi-file)</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={EVIDENCE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setEvidenceFiles((prev) => [...prev, ...picked]);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            <Paperclip className="w-3.5 h-3.5" />
            Pilih file (jpg/png/pdf/doc/docx/xls/xlsx/zip)
          </button>
          {evidenceFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {evidenceFiles.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
                >
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="text-slate-400 hover:text-red-600"
                    aria-label="Hapus file"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button type="button" className="px-4 py-2 rounded-xl border text-sm font-bold text-slate-700" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-[#00D4B4] font-bold text-sm text-[#0F1B2D] disabled:opacity-50"
            onClick={() => void submit()}
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function DailyActivityPage() {
  const { user } = useAuthStore();
  const { page, limit, setPage } = usePagination(20);
  const [activities, setActivities] = useState<DailyActivity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | DailyActivityWorkStatus>('ALL');
  const [editing, setEditing] = useState<DailyActivity | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit };
      if (search.trim()) params.search = search.trim();
      if (statusFilter !== 'ALL') params.workStatus = statusFilter;
      const res = await apiGetPaginated<DailyActivity>('/daily-activities', params);
      setActivities(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat daily activity');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = (_activity: DailyActivity) => {
    // Integra V9: match DAILY_ACTIVITY_MANAGE — all project team roles can Update Status
    const manageRoles = ['GENERAL_MANAGER', 'ADMIN', 'PM_SENIOR', 'PM_FTTT', 'FINANCE', 'SURVEYOR_FTTT'];
    return !!user && manageRoles.includes(user.role);
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Daily Activity</h1>
          <p className="text-sm text-slate-500 mt-1">Log aktivitas harian &amp; monitoring status pekerjaan</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm"
            placeholder="Cari site, scope of work, atau nama actor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                void load();
              }
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
          {(['ALL', 'ON_PROGRESS', 'ON_HOLD', 'DONE'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                statusFilter === s ? 'bg-white shadow text-slate-900' : 'text-slate-600'
              }`}
            >
              {s === 'ALL' ? 'Semua' : STATUS_LABELS[s].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
          Belum ada daily activity.
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                <th className="px-4 py-3">Waktu</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Site / Proyek</th>
                <th className="px-4 py-3">Scope of Work</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Target Selesai</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => {
                const overdue = isOverdue(a);
                // Integra V9: Actor = last status updater when present (not only original creator)
                const displayActor = a.updatedBy ?? a.actor;
                return (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                      {formatDateTimeID(a.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{displayActor?.name}</div>
                      <div className="text-xs text-slate-400">{displayActor?.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{a.siteName || '-'}</div>
                      <div className="text-xs text-slate-400">
                        {a.financeProject?.name || a.ftttProject?.projectName || ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-xs">{a.scopeOfWork}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.workStatus} />
                      {overdue && (
                        <div className="mt-1 text-[10px] font-bold text-red-600">TERLAMBAT</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {formatDateID(a.targetDoneAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {canManage(a) && (
                          <button
                            type="button"
                            onClick={() => setEditing(a)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Update
                          </button>
                        )}
                        {hasActivityDetail(a) && (
                          <Link
                            href={`/daily-activity/${a.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Lihat Detail
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <Pagination total={total} page={page} limit={limit} onPageChange={setPage} />
      </div>

      {editing && (
        <UpdateModal
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setActivities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          }}
        />
      )}
    </div>
  );
}
