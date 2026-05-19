'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../store/authStore';
import { apiGetPaginated } from '../../../../lib/api';
import { formatRupiah, formatDateTimeID } from '../../../../lib/format';
import type { BudgetTransfer, BudgetTransferStatus } from '../../../../types/api.types';

import { TRANSFER_STATUS_LABELS } from '../../../../lib/budget-transfer-status';

const STATUS_TAB: { key: BudgetTransferStatus | 'ALL'; label: string }[] = [
  { key: 'PENDING_GM_APPROVAL', label: 'Pending' },
  { key: 'APPROVED', label: 'Disetujui' },
  { key: 'REJECTED', label: 'Ditolak' },
  { key: 'CANCELLED', label: 'Dibatalkan' },
  { key: 'ALL', label: 'Semua' },
];

export default function BudgetTransferListPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<BudgetTransferStatus | 'ALL'>('PENDING_GM_APPROVAL');
  const [rows, setRows] = useState<BudgetTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabInitialized, setTabInitialized] = useState(false);

  const isFinance = user?.role === 'FINANCE';

  useEffect(() => {
    if (!user?.role || tabInitialized) return;
    if (user.role === 'ADMIN') setTab('ALL');
    setTabInitialized(true);
  }, [user?.role, tabInitialized]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 50, page: 1 };
      if (tab !== 'ALL') params.status = tab;
      if (user?.role === 'FINANCE' && tab === 'PENDING_GM_APPROVAL' && user.id) {
        params.submittedById = user.id;
      }
      const res = await apiGetPaginated<BudgetTransfer>('/budget-transfers', params);
      setRows(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [tab, user?.role, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-3 py-8 space-y-6">
      <Link href="/finance-projects" className="inline-flex items-center gap-2 text-sm text-slate-600">
        ← Kembali ke dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-black text-slate-900">Transfer Alokasi Budget</h1>
        {isFinance ? (
          <Link
            href="/finance-projects/transfer/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[#0F1B2D] text-white px-4 py-2 text-sm font-bold justify-center"
          >
            <Plus className="w-4 h-4" />
            Transfer Baru
          </Link>
        ) : null}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-4">
        Transfer alokasi menggeser plafon antar project, bukan memindahkan realisasi yang sudah terjadi.
      </div>

      <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
        {STATUS_TAB.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              tab === t.key ? 'bg-white shadow' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-500">Memuat…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Tidak ada data.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/finance-projects/transfer/${r.id}`}
              className="block rounded-2xl border border-slate-100 bg-white p-4 shadow-sm hover:border-[#00D4B4]/40"
            >
              <div className="flex justify-between gap-2">
                <div className="font-bold text-slate-900">
                  {r.sourceProject?.code} ({r.sourceCategory}) → {r.targetProject?.code} ({r.targetCategory})
                </div>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-full ${TRANSFER_STATUS_LABELS[r.status].className}`}
                >
                  {TRANSFER_STATUS_LABELS[r.status].label}
                </span>
              </div>
              <div className="text-lg font-black mt-1">{formatRupiah(r.amount)}</div>
              <div className="text-xs text-slate-500 mt-2">
                {r.submittedBy?.name ?? r.submittedById} · {formatDateTimeID(r.createdAt)}
              </div>
              <div className="text-sm text-slate-600 mt-2 line-clamp-2">{r.reason}</div>
              <div className="text-right text-sm font-bold text-[#00D4B4] mt-2">Lihat detail →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
