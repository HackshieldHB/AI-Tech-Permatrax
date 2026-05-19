'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Plus, Pencil, SlidersHorizontal,
  ArrowUp, ArrowDown, Minus, AlertTriangle,
} from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGet, apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';

const CATEGORY_FILTER = ['All', 'KABEL', 'PERANGKAT', 'AKSESORI', 'LAINNYA'] as const;

const CATEGORY_OPTIONS: { value: string; label: string; disabled?: boolean }[] = [
  { value: '', label: '-- Pilih Kategori --', disabled: true },
  { value: 'KABEL', label: '🔌 Kabel' },
  { value: 'PERANGKAT', label: '📡 Perangkat' },
  { value: 'AKSESORI', label: '🔩 Aksesori' },
  { value: 'LAINNYA', label: '📦 Lainnya' },
];

const CATEGORY_LABELS: Record<string, string> = {
  KABEL: 'Kabel',
  Kabel: 'Kabel',
  PERANGKAT: 'Perangkat',
  Perangkat: 'Perangkat',
  AKSESORI: 'Aksesori',
  Aksesori: 'Aksesori',
  LAINNYA: 'Lainnya',
  Lainnya: 'Lainnya',
};

function StockPageInner() {
  const { user } = useAuthStore();

  const canManage = user?.role === 'ADMIN_STOCK' || user?.role === 'GENERAL_MANAGER';

  const [summary, setSummary] = useState<{
    totalItems: number;
    totalStockQty: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalValue?: number;
  } | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [listMeta, setListMeta] = useState<{ total: number } | null>(null);
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [lowOnly, setLowOnly] = useState(false); // FIX: decouple pagination/filter state from URL params
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '', code: '', category: '', unit: 'Pcs', currentQty: 0, minStockQty: 0, description: '',
  });
  const [adjust, setAdjust] = useState<{ id: string; name: string; current: number } | null>(null);
  const [adjQty, setAdjQty] = useState(0);
  const [adjReason, setAdjReason] = useState('');
  const [editRow, setEditRow] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const fetchSummary = useCallback(async () => {
    try {
      const s = await apiGet<{
        totalItems: number;
        totalStockQty: number;
        lowStockCount: number;
        outOfStockCount: number;
        totalValue?: number;
      }>('/stock/summary');
      setSummary(s);
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const json = await apiGetPaginated('/stock', {
        page,
        limit,
        isActive: true,
        ...(search.trim() && { search: search.trim() }),
        ...(category !== 'All' && { category }),
        ...(lowOnly && { lowStock: true }),
      });
      setList(json.data ?? []);
      setListMeta({ total: json.meta.total });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat stok');
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, category, lowOnly]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const t = setTimeout(() => fetchList(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchList, search]);

  const openDetail = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    try {
      const res = await apiFetch(`/stock/${id}`, {}, user?.id);
      if (res.ok) setDetail(await res.json());
    } catch {
      toast.error('Gagal memuat riwayat');
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.category) {
      toast.error('Pilih kategori barang terlebih dahulu');
      return;
    }
    try {
      const res = await apiFetch('/stock', {
        method: 'POST',
        body: JSON.stringify({
          ...addForm,
          code: addForm.code.toUpperCase(),
          currentQty: Number(addForm.currentQty),
          minStockQty: Number(addForm.minStockQty),
        }),
      }, user?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Gagal menambah');
      }
      toast.success('Barang ditambahkan');
      setShowAdd(false);
      setAddForm({ name: '', code: '', category: '', unit: 'Pcs', currentQty: 0, minStockQty: 0, description: '' });
      fetchList();
      fetchSummary();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const submitAdjust = async () => {
    if (!adjust || !adjReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    try {
      const res = await apiFetch(`/stock/${adjust.id}/adjust`, {
        method: 'PATCH',
        body: JSON.stringify({ newQty: adjQty, reason: adjReason }),
      }, user?.id);
      if (!res.ok) throw new Error('Penyesuaian gagal');
      toast.success('Stok disesuaikan');
      setAdjust(null);
      setAdjReason('');
      fetchList();
      fetchSummary();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const saveEdit = async (id: string) => {
    try {
      const res = await apiFetch(`/stock/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name,
          category: editForm.category,
          unit: editForm.unit,
          minStockQty: Number(editForm.minStockQty),
          description: editForm.description,
        }),
      }, user?.id);
      if (!res.ok) throw new Error('Update gagal');
      toast.success('Disimpan');
      setEditRow(null);
      fetchList();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const lowAlerts = summary && summary.lowStockCount > 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Stok Barang</h2>
          <p className="text-sm text-slate-500 mt-1">Manajemen inventaris material</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00D4B4] text-[#0F1B2D] text-sm font-bold shadow-sm hover:opacity-95"
          >
            <Plus className="w-4 h-4" />
            Tambah Barang
          </button>
        )}
      </div>

      {lowAlerts && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span>{summary!.lowStockCount} barang di bawah stok minimum</span>
          </div>
          <button
            type="button"
            className="text-sm font-bold text-amber-800 underline"
            onClick={() => { setLowOnly(true); setPage(1); }}
          >
            Lihat
          </button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Jenis</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{summary.totalItems}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Unit Stok</p>
            <p className="text-3xl font-black text-slate-800 mt-1">{summary.totalStockQty.toLocaleString()}</p>
          </div>
          <div className={`rounded-2xl p-5 border shadow-sm ${summary.lowStockCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stok Rendah</p>
            <p className={`text-3xl font-black mt-1 ${summary.lowStockCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {summary.lowStockCount}
            </p>
          </div>
          <div className={`rounded-2xl p-5 border shadow-sm ${summary.outOfStockCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-100'}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stok Habis</p>
            <p className={`text-3xl font-black mt-1 ${summary.outOfStockCount > 0 ? 'text-red-700' : 'text-slate-800'}`}>
              {summary.outOfStockCount}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <input
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
            placeholder="Cari nama atau kode barang..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
            <input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} />
            Tampilkan stok rendah saja
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_FILTER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCategory(c); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                category === c ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c === 'All' ? 'Semua' : CATEGORY_LABELS[c] ?? c}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Kode</th>
                <th className="px-4 py-3 font-semibold">Nama</th>
                <th className="px-4 py-3 font-semibold">Kategori</th>
                <th className="px-4 py-3 font-semibold">Satuan</th>
                <th className="px-4 py-3 font-semibold">Stok</th>
                <th className="px-4 py-3 font-semibold">Min</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                {canManage && <th className="px-4 py-3 font-semibold">Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-12 text-center text-slate-500">Memuat…</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-12 text-center text-slate-500">Tidak ada data</td></tr>
              ) : (
                list.map((row) => {
                  const oos = row.currentQty === 0;
                  const low = row.isLowStock || row.currentQty <= row.minStockQty;
                  const tint = oos ? 'bg-red-50/80' : low ? 'bg-amber-50/50' : '';
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={`border-t border-slate-100 ${tint}`}>
                        <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                        <td className="px-4 py-3">
                          <button type="button" className="text-left font-medium text-slate-800 hover:text-[#00D4B4]" onClick={() => openDetail(row.id)}>
                            {editRow === row.id ? (
                              <input
                                className="w-full border rounded px-2 py-1"
                                value={editForm.name ?? row.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              />
                            ) : (
                              row.name
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {editRow === row.id ? (
                            <input
                              className="w-full border rounded px-2 py-1"
                              value={editForm.category ?? row.category}
                              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                            />
                          ) : (
                            CATEGORY_LABELS[String(row.category)] ?? row.category
                          )}
                        </td>
                        <td className="px-4 py-3">{row.unit}</td>
                        <td className="px-4 py-3 font-semibold">{row.currentQty}</td>
                        <td className="px-4 py-3">{row.minStockQty}</td>
                        <td className="px-4 py-3">
                          {oos ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800">Habis</span>
                          ) : low ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Stok Rendah</span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Tersedia</span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {editRow === row.id ? (
                                <button type="button" className="text-xs font-bold text-[#00D4B4]" onClick={() => saveEdit(row.id)}>Simpan</button>
                              ) : (
                                <button
                                  type="button"
                                  className="p-1.5 rounded-lg hover:bg-slate-100"
                                  onClick={() => { setEditRow(row.id); setEditForm({ name: row.name, category: row.category, unit: row.unit, minStockQty: row.minStockQty, description: row.description }); }}
                                >
                                  <Pencil className="w-4 h-4 text-slate-600" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="text-xs font-bold text-slate-700 flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50"
                                onClick={() => { setAdjust({ id: row.id, name: row.name, current: row.currentQty }); setAdjQty(row.currentQty); setAdjReason(''); }}
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                Sesuaikan
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {expanded === row.id && detail && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={canManage ? 8 : 7} className="px-4 py-4">
                            <p className="text-xs font-bold text-slate-500 mb-3">Riwayat mutasi (10 terakhir)</p>
                            <div className="space-y-2">
                              {(detail.stockLogs ?? []).map((log: any) => (
                                <div key={log.id} className="flex items-start gap-3 text-xs border-l-2 border-slate-200 pl-3 py-1">
                                  {log.qtyChange > 0 ? (
                                    <ArrowUp className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                  ) : log.qtyChange < 0 ? (
                                    <ArrowDown className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                                  ) : (
                                    <Minus className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                  )}
                                  <div>
                                    <span className={log.qtyChange >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                                      {log.qtyChange > 0 ? '+' : ''}{log.qtyChange} {row.unit}
                                    </span>
                                    <span className="text-slate-500 ml-2">{log.type}</span>
                                    <div className="text-slate-500 mt-0.5">
                                      {new Date(log.createdAt).toLocaleString('id-ID')} — {log.actor?.name ?? '?'}
                                      {log.reference && ` — ${log.reference}`}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {listMeta && listMeta.total > 0 && (
          <Pagination
            total={listMeta.total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-slate-800">Tambah Barang</h3>
              <button type="button" className="text-slate-500" onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <form onSubmit={submitAdd} className="space-y-4">
              {(['name', 'code', 'unit'] as const).map((f) => (
                <div key={f}>
                  <label className="text-xs font-bold text-slate-500 uppercase">{f}</label>
                  <input
                    required
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    value={(addForm as any)[f]}
                    onChange={(e) => setAddForm({ ...addForm, [f]: e.target.value })}
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Kategori *</label>
                <select
                  required
                  value={addForm.category}
                  onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none ${
                    !addForm.category ? 'border-red-300/80' : 'border-slate-200'
                  }`}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value || 'placeholder'} value={opt.value} disabled={opt.disabled}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {!addForm.category ? (
                  <p className="text-[11px] text-red-600 mt-1">Pilih kategori terlebih dahulu</p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Stok awal</label>
                  <input type="number" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={addForm.currentQty} onChange={(e) => setAddForm({ ...addForm, currentQty: +e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Stok min</label>
                  <input type="number" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={addForm.minStockQty} onChange={(e) => setAddForm({ ...addForm, minStockQty: +e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Deskripsi</label>
                <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={3} value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} />
              </div>
              <button type="submit" className="w-full py-3 rounded-xl bg-[#00D4B4] font-bold text-[#0F1B2D]">Simpan</button>
            </form>
          </div>
        </div>
      )}

      {adjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 mb-1">Sesuaikan stok</h3>
            <p className="text-sm text-slate-500 mb-4">{adjust.name}</p>
            <p className="text-sm mb-2">Stok saat ini: <strong>{adjust.current}</strong></p>
            <label className="text-xs font-bold text-slate-500">Stok baru</label>
            <input type="number" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm mb-3" value={adjQty} onChange={(e) => setAdjQty(+e.target.value)} />
            <label className="text-xs font-bold text-slate-500">Alasan (wajib)</label>
            <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm mb-4" rows={3} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" className="flex-1 py-2.5 rounded-xl border font-medium" onClick={() => setAdjust(null)}>Batal</button>
              <button type="button" className="flex-1 py-2.5 rounded-xl bg-[#00D4B4] font-bold text-[#0F1B2D]" onClick={submitAdjust}>Konfirmasi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StockPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: '2rem', color: 'var(--color-text-secondary)' }}>Memuat...</div>
      }
    >
      <StockPageInner />
    </Suspense>
  );
}
