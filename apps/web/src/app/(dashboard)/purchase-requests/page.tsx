'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNotificationStore } from '../../../store/notificationStore';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGet, apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import { PR_STATUS_LABELS } from '../../../types/api.types';
import type { PaginatedResponse } from '../../../types/api.types';

type PrRow = {
  id: string;
  requestNumber: string;
  status: string;
  requestedBy?: string;
  createdAt: string;
  totalAmount?: unknown;
  requester?: { name?: string };
  items?: unknown[];
};

function PurchaseRequestsPageInner() {
  const { user } = useAuthStore();
  const resetUnreadPR = useNotificationStore((s) => s.resetUnreadPR);
  const [tab, setTab] = useState<'PENDING' | 'IN_REVIEW' | 'RECEIVED' | 'REJECTED'>('PENDING');
  const { page, limit, setPage, setLimit } = usePagination(50);
  const [rows, setRows] = useState<PrRow[]>([]);
  const [result, setResult] = useState<PaginatedResponse<PrRow> | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<PrRow | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debouncePageMount = useRef(false);

  const isFinance = user?.role === 'FINANCE';

  useEffect(() => {
    resetUnreadPR();
  }, [resetUnreadPR]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!debouncePageMount.current) {
      debouncePageMount.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, setPage]);

  const fetchInboxCount = useCallback(async () => {
    if (!isFinance && user?.role !== 'GENERAL_MANAGER') return;
    try {
      const j = await apiGet<{ count: number }>('/purchase-requests/inbox-count');
      setPendingCount(j.count ?? 0);
    } catch {
      setPendingCount(0);
    }
  }, [isFinance, user?.role]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        limit,
      };
      if (tab === 'PENDING') params.status = 'PENDING';
      else if (tab === 'IN_REVIEW') params.status = 'IN_REVIEW';
      else if (tab === 'RECEIVED') params.status = 'RECEIVED';
      else if (tab === 'REJECTED') params.status = 'REJECTED';
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const json = await apiGetPaginated<PrRow>('/purchase-requests', params);
      setResult(json);
      setRows(json.data ?? []);
      await fetchInboxCount();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [user?.id, tab, page, limit, debouncedSearch, fetchInboxCount]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openPanel = async (pr: PrRow) => {
    setPanel(pr);
    setNotes((pr as { financeNotes?: string }).financeNotes ?? '');
    const p: Record<string, number> = {};
    (pr.items as { id: string; unitPrice?: number | null }[] | undefined)?.forEach((i) => {
      p[i.id] = i.unitPrice != null ? Number(i.unitPrice) : 0;
    });
    setPrices(p);
  };

  const patchStatus = async (status: string) => {
    if (!panel) return;
    if (status === 'REJECTED' && !notes.trim()) {
      toast.error('Catatan wajib untuk menolak');
      return;
    }
    try {
      const res = await apiFetch(`/purchase-requests/${panel.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes }),
      }, user?.id);
      if (!res.ok) throw new Error('Gagal update');
      toast.success('Status diperbarui');
      setPanel(null);
      fetchList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  const savePrices = async () => {
    if (!panel) return;
    const items = Object.entries(prices).map(([itemId, unitPrice]) => ({ itemId, unitPrice }));
    try {
      const res = await apiFetch(`/purchase-requests/${panel.id}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      }, user?.id);
      if (!res.ok) throw new Error('Gagal simpan harga');
      toast.success('Harga disimpan');
      fetchList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="space-y-6 max-w-[1100px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">Permintaan Pembelian</h2>
          {isFinance && pendingCount > 0 && (
            <span className="inline-flex mt-2 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-black">
              {pendingCount} menunggu
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari nomor PR…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {(['PENDING', 'IN_REVIEW', 'RECEIVED', 'REJECTED'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              tab === t ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100'
            }`}
          >
            {t === 'PENDING' ? 'Inbox' : t === 'IN_REVIEW' ? 'Diproses' : t === 'RECEIVED' ? 'Selesai' : 'Ditolak'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">No PR</th>
              <th className="px-4 py-3 text-left font-semibold">Diminta</th>
              <th className="px-4 py-3 text-left font-semibold">Item</th>
              <th className="px-4 py-3 text-left font-semibold">Total</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Tgl</th>
              <th className="px-4 py-3 text-left font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Memuat…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Kosong</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{r.requestNumber}</td>
                  <td className="px-4 py-3">{r.requester?.name ?? r.requestedBy}</td>
                  <td className="px-4 py-3">{r.items?.length ?? 0}</td>
                  <td className="px-4 py-3">
                    {r.totalAmount != null ? `Rp ${Number(r.totalAmount).toLocaleString('id-ID')}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700">
                    {PR_STATUS_LABELS[r.status as keyof typeof PR_STATUS_LABELS] ?? r.status}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-xs font-bold text-[#00D4B4]"
                      onClick={() => openPanel(r)}
                    >
                      {isFinance && tab === 'PENDING' ? 'Proses' : 'Detail'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {result && result.meta.total > 0 && (
          <Pagination
            total={result.meta.total}
            page={page} // FIX: controlled by pagination hook state
            limit={limit} // FIX: controlled by pagination hook state
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        )}
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-lg bg-white h-full shadow-2xl overflow-y-auto p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-lg font-bold">{panel.requestNumber}</h3>
                <p className="text-sm text-slate-500">{panel.requester?.name}</p>
              </div>
              <button type="button" className="text-slate-400" onClick={() => setPanel(null)}>✕</button>
            </div>

            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Nama</th>
                  <th className="py-1">Qty</th>
                  <th className="py-1">Harga</th>
                </tr>
              </thead>
              <tbody>
                {(panel.items as { id: string; itemName: string; requestedQty: number; unitPrice?: number | null }[] | undefined)?.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="py-2">{it.itemName}</td>
                    <td className="py-2">{it.requestedQty}</td>
                    <td className="py-2">
                      {isFinance ? (
                        <input
                          type="number"
                          className="w-24 border rounded px-1 py-0.5"
                          value={prices[it.id] ?? 0}
                          onChange={(e) => setPrices({ ...prices, [it.id]: +e.target.value })}
                        />
                      ) : (
                        it.unitPrice ?? '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isFinance && (
              <button type="button" className="text-sm font-bold text-[#00D4B4]" onClick={savePrices}>
                Simpan harga
              </button>
            )}

            <div>
              <label className="text-xs font-bold text-slate-500">Catatan Finance</label>
              <textarea className="mt-1 w-full border rounded-xl px-3 py-2 text-sm" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {isFinance && (
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <button type="button" className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold" onClick={() => patchStatus('APPROVED')}>
                  Setujui
                </button>
                <button type="button" className="px-3 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold" onClick={() => patchStatus('ORDERED')}>
                  Tandai Dipesan
                </button>
                <button type="button" className="px-3 py-2 rounded-xl bg-[#00D4B4] text-[#0F1B2D] text-xs font-bold" onClick={() => patchStatus('RECEIVED')}>
                  Tandai Diterima
                </button>
                <button type="button" className="px-3 py-2 rounded-xl border border-red-300 text-red-700 text-xs font-bold" onClick={() => patchStatus('REJECTED')}>
                  Tolak
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PurchaseRequestsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <PurchaseRequestsPageInner />
    </Suspense>
  );
}
