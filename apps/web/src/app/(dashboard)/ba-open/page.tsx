'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGet, apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { Download, Send } from 'lucide-react';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse } from '../../../types/api.types';

const STATUS_STYLES: Record<string, string> = {
  GENERATED: 'bg-slate-100 text-slate-700',
  SENT:      'bg-emerald-100 text-emerald-700',
  ARCHIVED:  'bg-slate-100 text-slate-500',
};

type BaRow = {
  id: string;
  documentNumber: string;
  ispCustomer: string;
  rwCode: string;
  kelurahan: string;
  surveyorName?: string;
  generatedAt: string;
  status: string;
  pdfUrl?: string | null;
  visitRequest?: { requester?: { name?: string } };
};

function BaOpenPageInner() {
  const { user } = useAuthStore();
  const canSend = ['ADMIN', 'PM_SENIOR'].includes(user?.role ?? '');
  const { page, limit, setPage, setLimit } = usePagination(20);

  const [result, setResult] = useState<PaginatedResponse<BaRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [fiberType, setFiberType] = useState('');
  const [ispCustomer, setIspCustomer] = useState('');
  const [isps, setIsps] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
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
  }, [debouncedSearch, setPage]);

  useEffect(() => {
    (async () => {
      try {
        const list = await apiGet<{ id: string; name: string }[]>('/isp-customers');
        setIsps(Array.isArray(list) ? list : []);
      } catch {
        setIsps([]);
      }
    })();
  }, [user?.id]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGetPaginated<BaRow>('/ba-open', {
        page,
        limit,
        ...(statusFilter && { status: statusFilter }),
        ...(fiberType && { fiberType }),
        ...(ispCustomer && { ispCustomer }),
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      });
      setResult(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat BA Open');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, fiberType, ispCustomer, debouncedSearch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSend = async (id: string) => {
    try {
      const res = await apiFetch(`/ba-open/${id}/send-to-isp`, { method: 'POST' }, user?.id);
      if (!res.ok) throw new Error('Gagal kirim');
      toast.success('BA Open berhasil dikirim ke ISP');
      fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    }
  };

  const data = result?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-800">BA Open</h1>
        <p className="text-sm text-slate-500 mt-0.5">Berita Acara Kunjungan yang telah dibuat</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari nomor dokumen / cluster…"
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
          <option value="SENT">SENT</option>
          <option value="ARCHIVED">ARCHIVED</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-bold text-slate-500">ISP</span>
        <button
          type="button"
          onClick={() => { setIspCustomer(''); setPage(1); }}
          className={`px-3 py-1.5 rounded-full text-xs font-bold ${ispCustomer === '' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100'}`}
        >
          Semua
        </button>
        {isps.map((isp) => (
          <button
            key={isp.id}
            type="button"
            onClick={() => { setIspCustomer(isp.name); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold max-w-[140px] truncate ${
              ispCustomer === isp.name ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100'
            }`}
          >
            {isp.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-bold text-slate-500">Fiber</span>
        {(['', 'FTTH', 'FTTB', 'FTTT'] as const).map((ft) => (
          <button
            key={ft || 'all'}
            type="button"
            onClick={() => { setFiberType(ft); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              fiberType === ft ? 'bg-[#00D4B4] text-[#0F1B2D]' : 'bg-slate-100'
            }`}
          >
            {ft === '' ? 'Semua' : ft}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Nomor Dokumen', 'ISP', 'Kode RW', 'Kelurahan', 'Surveyor', 'Tgl Dibuat', 'Status', 'Aksi'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (<td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 animate-pulse rounded-md" /></td>))}</tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-slate-400">Belum ada BA Open yang dibuat.</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-bold text-slate-800 font-mono text-xs">{row.documentNumber}</td>
                  <td className="px-4 py-3 text-slate-600">{row.ispCustomer}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{row.rwCode}</td>
                  <td className="px-4 py-3 text-slate-600">{row.kelurahan}</td>
                  <td className="px-4 py-3 text-slate-600">{row.surveyorName ?? row.visitRequest?.requester?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(row.generatedAt).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${STATUS_STYLES[row.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.pdfUrl && (
                        <a href={row.pdfUrl} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" title="Download PDF">
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {canSend && row.status === 'GENERATED' && (
                        <button
                          type="button"
                          onClick={() => handleSend(row.id)}
                          className="p-1.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Kirim ke ISP"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result && result.meta.total > 0 && (
          <Pagination
            total={result.meta.total}
            page={result.meta.page}
            limit={result.meta.limit}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        )}
      </div>
    </div>
  );
}

export default function BaOpenPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <BaOpenPageInner />
    </Suspense>
  );
}
