'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGet, apiGetPaginated, fixFileUrl } from '../../../lib/api'; // FIX: signed PDF URL + host rewrite
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse } from '../../../types/api.types';

type SjRow = {
  id: string;
  documentNumber: string;
  type: string;
  status: string;
  createdAt: string;
};

function SuratJalanPageInner() {
  const { user } = useAuthStore();
  const isAdminStock = user?.role === 'ADMIN_STOCK';
  const { page, limit, setPage, setLimit } = usePagination(50);
  const [tab, setTab] = useState<'all' | 'OUT' | 'IN'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debouncePageMount = useRef(false);
  const [rows, setRows] = useState<SjRow[]>([]);
  const [result, setResult] = useState<PaginatedResponse<SjRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<Record<string, unknown> | null>(null);
  const [recvItems, setRecvItems] = useState<{ orderItemId: string; receivedQty: number }[]>([]);
  const [recvNotes, setRecvNotes] = useState('');

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

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        limit,
      };
      if (tab === 'OUT') params.type = 'OUT';
      if (tab === 'IN') params.type = 'IN';
      if (statusFilter) params.status = statusFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const json = await apiGetPaginated<SjRow>('/surat-jalan', params);
      setResult(json);
      setRows(json.data ?? []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [user?.id, tab, page, limit, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const download = async (id: string) => {
    try {
      const result = await apiGet<{ url: string }>(`/surat-jalan/${id}/download-url`); // FIX: HMAC token link
      window.open(fixFileUrl(result.url), '_blank', 'noopener,noreferrer'); // FIX: redirect → /api/files/...
    } catch {
      toast.error('Gagal mendapat link unduhan'); // FIX
    }
  };

  const openConfirm = async (sj: SjRow) => {
    try {
      const res = await apiFetch(`/surat-jalan/${sj.id}`, {}, user?.id);
      if (!res.ok) return;
      const full = await res.json();
      setConfirm(full);
      const oi =
        full.order?.items?.map((it: { id: string; requestedQty: number }) => ({
          orderItemId: it.id,
          receivedQty: it.requestedQty,
        })) ?? [];
      setRecvItems(oi);
      setRecvNotes('');
    } catch {
      toast.error('Gagal memuat detail SJ');
    }
  };

  const submitConfirm = async () => {
    if (!confirm) return;
    try {
      const res = await apiFetch(`/surat-jalan/${confirm.id as string}/confirm-receipt`, {
        method: 'POST',
        body: JSON.stringify({ items: recvItems, notes: recvNotes || undefined }),
      }, user?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal');
      }
      toast.success('Konfirmasi disimpan');
      setConfirm(null);
      fetchList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div>
        <h2 className="text-2xl font-black text-slate-800">Surat Jalan</h2>
        <p className="text-sm text-slate-500 mt-1">Dokumen keluar & masuk barang</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari nomor SJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">Semua status</option>
          <option value="GENERATED">GENERATED</option>
          <option value="DISPATCHED">DISPATCHED</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div className="flex gap-2 border-b pb-2">
        {(['all', 'OUT', 'IN'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              tab === t ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100'
            }`}
          >
            {t === 'all' ? 'Semua' : t === 'OUT' ? 'Keluar (OUT)' : 'Masuk (IN)'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">No SJ</th>
              <th className="px-4 py-3 text-left font-semibold">Tipe</th>
              <th className="px-4 py-3 text-left font-semibold">Tgl</th>
              <th className="px-4 py-3 text-left font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">PDF</th>
              {isAdminStock && <th className="px-4 py-3 text-left font-semibold">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdminStock ? 6 : 5} className="px-4 py-10 text-center">Memuat…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={isAdminStock ? 6 : 5} className="px-4 py-10 text-center text-slate-500">Kosong</td></tr>
            ) : (
              rows.map((sj) => (
                <tr key={sj.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{sj.documentNumber}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sj.type === 'OUT' ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {sj.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(sj.createdAt).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3 text-xs">{sj.status}</td>
                  <td className="px-4 py-3">
                    <button type="button" className="text-[#00D4B4] inline-flex items-center gap-1 text-xs font-bold" onClick={() => download(sj.id)}>
                      <Download className="w-3.5 h-3.5" />
                      Unduh
                    </button>
                  </td>
                  {isAdminStock && (
                    <td className="px-4 py-3">
                      {sj.type === 'OUT' && sj.status === 'GENERATED' && (
                        <button
                          type="button"
                          className="text-xs font-bold text-[#00D4B4]"
                          onClick={() => openConfirm(sj)}
                        >
                          Konfirmasi Diterima
                        </button>
                      )}
                    </td>
                  )}
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

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-3">
            <h4 className="font-bold">Konfirmasi penerimaan lapangan</h4>
            <p className="text-xs text-slate-500">{String(confirm.documentNumber)}</p>
            <textarea className="w-full border rounded-xl px-3 py-2 text-sm" rows={2} placeholder="Catatan" value={recvNotes} onChange={(e) => setRecvNotes(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 rounded-xl border text-sm" onClick={() => setConfirm(null)}>Batal</button>
              <button type="button" className="px-4 py-2 rounded-xl bg-[#00D4B4] font-bold text-sm text-[#0F1B2D]" onClick={submitConfirm}>
                Konfirmasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuratJalanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <SuratJalanPageInner />
    </Suspense>
  );
}
