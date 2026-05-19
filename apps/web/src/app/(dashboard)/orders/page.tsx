'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, Download, Eye, Send } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse } from '../../../types/api.types';

// FIX: tabs — legacy pipeline + alur approval (status query = comma-separated)
const STATUS_TAB: { key: string; label: string; filter?: string }[] = [
  { key: 'all', label: 'Semua' },
  {
    key: 'approval',
    label: 'Alur approval',
    filter:
      'PENDING_ADMIN_STOCK,PENDING_PURCHASING_INPUT,PENDING_OPS_APPROVAL,REJECTED_BY_OPS,PENDING_GM_APPROVAL,REJECTED_BY_GM,PENDING_PAYMENT_RECEIPT,PENDING_FINANCE,PURCHASED,PENDING_VERIFICATION',
  },
  { key: 'wait', label: 'Menunggu (stok)', filter: 'SUBMITTED' },
  { key: 'sj', label: 'Surat Jalan Siap', filter: 'STOCK_AVAILABLE' },
  { key: 'pr', label: 'Butuh Pembelian', filter: 'NO_STOCK,PARTIAL_STOCK' },
  { key: 'done', label: 'Selesai', filter: 'FULFILLED' },
];

// FIX: badge daftar — termasuk status legacy/schema tambahan
const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: 'bg-slate-100 text-slate-700', label: 'Draft' },
  SUBMITTED: { cls: 'bg-amber-100 text-amber-800', label: 'Diproses…' },
  STOCK_AVAILABLE: { cls: 'bg-emerald-100 text-emerald-800', label: 'Surat Jalan Siap' },
  PARTIAL_STOCK: { cls: 'bg-sky-100 text-sky-800', label: 'Sebagian — SJ + PR' },
  NO_STOCK: { cls: 'bg-red-100 text-red-800', label: 'Pembelian Diperlukan' },
  PENDING_ADMIN_STOCK: { cls: 'bg-slate-100 text-slate-900', label: 'Menunggu Admin Stok' },
  PENDING_PURCHASING_INPUT: { cls: 'bg-teal-100 text-teal-900', label: 'Menunggu Purchasing' },
  PENDING_OPS_APPROVAL: { cls: 'bg-amber-100 text-amber-900', label: 'Menunggu Ops' },
  REJECTED_BY_OPS: { cls: 'bg-red-100 text-red-900', label: 'Ditolak Ops (legacy)' },
  PENDING_GM_APPROVAL: { cls: 'bg-violet-100 text-violet-900', label: 'Menunggu GM' },
  REJECTED_BY_GM: { cls: 'bg-red-100 text-red-900', label: 'Ditolak GM (legacy)' },
  PENDING_PAYMENT_RECEIPT: { cls: 'bg-cyan-100 text-cyan-900', label: 'Menunggu pembayaran' },
  PENDING_FINANCE: { cls: 'bg-cyan-100 text-cyan-900', label: 'Menunggu Finance (legacy)' },
  PURCHASED: { cls: 'bg-amber-100 text-amber-900', label: 'Sudah Dibeli' },
  PENDING_VERIFICATION: { cls: 'bg-orange-100 text-orange-900', label: 'Verifikasi Barang' },
  FULFILLED: { cls: 'bg-teal-100 text-teal-800', label: 'Selesai' },
  CANCELLED: { cls: 'bg-slate-200 text-slate-600', label: 'Dibatalkan' },
  PROCESSING: { cls: 'bg-slate-50 text-slate-800', label: 'Diproses' },
  COMPLETED: { cls: 'bg-teal-50 text-teal-800', label: 'Completed' },
};

type OrderRow = {
  id: string;
  orderNumber: string;
  fiberType: string;
  projectRef?: string | null;
  orderTrigger?: string | null;
  status: string;
  createdAt: string;
  items?: unknown[];
  requestedItems?: unknown[] | null;
  creator?: { name?: string | null; role?: string | null };
  suratJalan?: { pdfUrl?: string | null; documentNumber?: string | null };
  opsRejectionReason?: string | null;
  gmRejectionReason?: string | null;
  revisionCount?: number | null;
};

// FIX: revisi — Admin Stok mengisi ulang setelah tolak Ops/GM
function getListStatusBadge(order: OrderRow): {
  label: string;
  cls?: string;
  style?: React.CSSProperties;
} {
  const isRevision =
    order.status === 'PENDING_ADMIN_STOCK' && !!(order.opsRejectionReason || order.gmRejectionReason);
  if (isRevision) {
    return {
      label: `↺ Revisi ke-${order.revisionCount || 1}`,
      style: {
        color: '#EF4444',
        background: '#EF444412',
        border: '1px solid #EF444440',
      },
    };
  }
  const st = STATUS_BADGE[order.status] ?? STATUS_BADGE.DRAFT;
  return { label: st.label, cls: st.cls };
}

// FIX: correct needsAction logic per role
function needsAction(order: { status: string }, role: string | undefined): boolean {
  if (!role) return false;
  switch (role) {
    case 'ADMIN_STOCK':
      return (
        order.status === 'PENDING_ADMIN_STOCK' ||
        order.status === 'DRAFT' || // FIX: katalog PM — Admin isi harga
        order.status === 'NO_STOCK' || // FIX: butuh harga sebelum ke Ops
        order.status === 'PARTIAL_STOCK' || // FIX
        order.status === 'PURCHASED' ||
        order.status === 'PENDING_VERIFICATION'
      );
    case 'OPERATIONAL_MANAGER':
      return order.status === 'PENDING_OPS_APPROVAL';
    case 'GENERAL_MANAGER':
      return order.status === 'PENDING_GM_APPROVAL';
    case 'PURCHASING':
      return order.status === 'PENDING_PURCHASING_INPUT';
    case 'FINANCE':
      return order.status === 'PENDING_PAYMENT_RECEIPT' || order.status === 'PENDING_FINANCE';
    default:
      return false;
  }
}

function itemCount(row: OrderRow): number {
  const req = row.requestedItems;
  if (Array.isArray(req) && req.length > 0) return req.length;
  return row.items?.length ?? 0;
}

function OrdersPageInner() {
  const { user } = useAuthStore();
  const canCreate = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN_STOCK'].includes(user?.role ?? '');
  const isPM = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'].includes(user?.role ?? '');

  const { page, limit, setPage, setLimit } = usePagination(20);
  const [tab, setTab] = useState('all');
  const [fiberType, setFiberType] = useState<string>('');
  const [orderTrigger, setOrderTrigger] = useState<'all' | 'PROJECT_REQUEST' | 'STOCK_RESTOCK'>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [result, setResult] = useState<PaginatedResponse<OrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const debouncePageMount = useRef(false);

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
  }, [debouncedSearch, orderTrigger, setPage]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        limit,
      };
      const t = STATUS_TAB.find((x) => x.key === tab);
      if (t?.filter) params.status = t.filter;
      if (fiberType) params.fiberType = fiberType;
      if (orderTrigger !== 'all') params.orderTrigger = orderTrigger;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const json = await apiGetPaginated<OrderRow>('/orders', params);
      setResult(json);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat order');
    } finally {
      setLoading(false);
    }
  }, [tab, page, limit, debouncedSearch, fiberType, orderTrigger]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const submitDraft = async (id: string) => {
    try {
      const res = await apiFetch(`/orders/${id}/submit`, { method: 'POST' }, user?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || 'Submit gagal');
      }
      toast.success('Order disubmit');
      fetchList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  const data = result?.data ?? [];

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Order Barang</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola order barang dan permintaan pembelian stok</p>
        </div>
        {canCreate && (
          <Link
            href="/orders/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#00D4B4] text-[#0F1B2D] text-sm font-bold shadow-sm"
          >
            <ShoppingCart className="w-4 h-4" />
            + Buat Order
          </Link>
        )}
      </div>

      {isPM && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          Alur: PM buat order → Admin Stok input harga → Ops Manager approve → GM approve → Finance beli → Admin Stok
          konfirmasi barang tiba
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari no order / proyek…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(['', 'FTTH', 'FTTB', 'FTTT'] as const).map((ft) => (
          <button
            key={ft || 'all'}
            type="button"
            onClick={() => {
              setFiberType(ft);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              fiberType === ft ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {ft === '' ? 'Semua fiber' : ft}
          </button>
        ))}
        {(
          [
            { key: 'all' as const, label: 'Semua alur' },
            { key: 'PROJECT_REQUEST' as const, label: 'Proyek' },
            { key: 'STOCK_RESTOCK' as const, label: 'Restock gudang' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => {
              setOrderTrigger(opt.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              orderTrigger === opt.key ? 'bg-teal-800 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {STATUS_TAB.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => {
              setTab(x.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              tab === x.key ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">No Order</th>
                <th className="px-4 py-3 text-left font-semibold">Fiber</th>
                <th className="px-4 py-3 text-left font-semibold">Proyek</th>
                <th className="px-4 py-3 text-left font-semibold">Pemohon</th>
                <th className="px-4 py-3 text-left font-semibold">Items</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Surat Jalan</th>
                <th className="px-4 py-3 text-left font-semibold">Tgl</th>
                <th className="px-4 py-3 text-left font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Memuat…
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Belum ada order
                  </td>
                </tr>
              ) : (
                data.map((row) => {
                  const badge = getListStatusBadge(row);
                  const sj = row.suratJalan;
                  const action = needsAction(row, user?.role);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          {row.orderNumber}
                          {row.orderTrigger === 'STOCK_RESTOCK' ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-teal-100 text-teal-900 border border-teal-200">
                              Restock
                            </span>
                          ) : null}
                          {action ? (
                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                              ⚡ Perlu Tindakan
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.fiberType}</td>
                      <td className="px-4 py-3 max-w-[120px] truncate">{row.projectRef ?? '—'}</td>
                      <td className="px-4 py-3 max-w-[100px] truncate text-xs">{row.creator?.name ?? '—'}</td>
                      <td className="px-4 py-3">{itemCount(row)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            badge.cls
                              ? `text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`
                              : 'text-[10px] font-bold px-2 py-0.5 rounded-full'
                          }
                          style={badge.style}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {sj?.pdfUrl ? (
                          <a
                            href={sj.pdfUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#00D4B4] inline-flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.createdAt ? new Date(row.createdAt).toLocaleDateString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/orders/${row.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-slate-700">
                            <Eye className="w-3.5 h-3.5" />
                            Detail
                          </Link>
                          {row.status === 'DRAFT' && canCreate && (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#00D4B4]"
                              onClick={() => submitDraft(row.id)}
                            >
                              <Send className="w-3.5 h-3.5" />
                              Submit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {result && result.meta.total > 0 && (
          <Pagination
            total={result.meta.total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        )}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <OrdersPageInner />
    </Suspense>
  );
}
