'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiFetch } from '../../../lib/auth';
import { apiGetPaginated } from '../../../lib/api';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import { notify } from '../../../lib/toast';
import type { PaginatedResponse } from '../../../types/api.types';
import { CleanListImportPanel } from '../../../components/CleanListImportPanel';
import { apiGet } from '../../../lib/api';
import { isSurveyorRole } from '../../../lib/roles';

// NEW: Status badge styling map
const STATUS_STYLES: Record<string, string> = {
  AVAILABLE:           'bg-emerald-100 text-emerald-700 border border-emerald-200',
  IN_PROGRESS:         'bg-amber-100 text-amber-700 border border-amber-200',
  HAS_EXISTING_FIBER:  'bg-red-100 text-red-700 border border-red-200',
  COMPLETED:           'bg-slate-100 text-slate-700 border border-slate-200',
  REJECTED:            'bg-slate-100 text-slate-500 border border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE:           'Tersedia',
  IN_PROGRESS:         'Proses',
  HAS_EXISTING_FIBER:  'Existing Fiber',
  COMPLETED:           'Selesai',
  REJECTED:            'Ditolak',
};

const FIBER_COLORS: Record<string, string> = {
  FTTH: 'bg-sky-100 text-sky-700',
  FTTB: 'bg-violet-100 text-violet-700',
  FTTT: 'bg-orange-100 text-orange-700',
};

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-3xl font-black ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function CleanListPageInner() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canImport =
    user?.role === 'ADMIN' ||
    user?.role === 'GENERAL_MANAGER' ||
    user?.role === 'PM_FTTH' ||
    user?.role === 'PM_FTTB' ||
    user?.role === 'PM_FTTT' ||
    user?.role === 'PM_SENIOR'; // FIX: PM roles and Admin can import clean list (not GM-only)
  const { page, limit, setPage, setLimit } = usePagination(20);

  const [result, setResult] = useState<PaginatedResponse<Record<string, unknown>> | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fiberFilter, setFiberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [dashStats, setDashStats] = useState<any>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, setPage]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | undefined> = {
        page,
        limit,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (fiberFilter) params.fiberType = fiberFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await apiGetPaginated<Record<string, unknown>>('/clean-list', params);
      setResult(data);
    } catch (e: unknown) {
      notify.apiError(e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, fiberFilter, statusFilter]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await apiFetch('/clean-list/summary/isp', {}, user?.id);
      if (res.ok) setSummary(await res.json());
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    apiGet('/clean-list/dashboard-stats').then(setDashStats).catch(() => null);
  }, []);

  const rows = result?.data ?? [];
  const meta = result?.meta;
  const total = meta?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Clean List</h1>
          <p className="text-sm text-slate-500 mt-0.5">Data cluster ISP untuk rollout fiber</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              fetchData();
              fetchSummary();
            }}
            className="w-9 h-9 rounded-xl border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canImport && (
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#00D4B4] text-white rounded-[10px] font-semibold text-sm hover:bg-[#00BFA3] transition-colors shadow-[0_4px_12px_rgba(0,212,180,0.25)]"
            >
              <span aria-hidden>⬆️</span>
              Import Clean List
            </button>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard label="Total Cluster" value={summary.total} color="text-slate-800" />
          <SummaryCard label="Tersedia" value={summary.available} color="text-emerald-600" />
          <SummaryCard label="Dalam Proses" value={summary.inProgress} color="text-amber-600" />
          <SummaryCard label="Existing Fiber" value={summary.hasExistingFiber} color="text-red-600" />
        </div>
      )}

      {dashStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total Sites" value={dashStats.summary?.totalSites ?? 0} color="text-slate-800" />
          <SummaryCard label="HP Plan Total" value={dashStats.homepasses?.totalPlanned ?? 0} color="text-teal-600" />
          <SummaryCard label="HP Aktual" value={dashStats.homepasses?.totalActual ?? 0} color="text-primary" />
          <SummaryCard label="Achievement %" value={dashStats.homepasses?.achievementRate ?? 0} color="text-purple-600" />
        </div>
      )}

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari RW, kelurahan..."
            className="w-full pl-9 pr-4 h-9 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-[#00D4B4] transition-colors"
          />
        </div>
        <div className="flex gap-1.5">
          {['', 'FTTH', 'FTTB', 'FTTT'].map((ft) => (
            <button
              key={ft || 'all'}
              type="button"
              onClick={() => {
                setFiberFilter(ft);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                fiberFilter === ft
                  ? 'bg-[#0F1B2D] text-white border-transparent'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {ft || 'Semua'}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-xl border border-slate-200 text-sm text-slate-600 px-3 focus:outline-none focus:border-[#00D4B4]"
        >
          <option value="">Semua Status</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['No', 'Kode RW', 'Kelurahan', 'Kecamatan', 'ISP', 'Fiber', 'HP', 'Status', 'Existing', 'Aksi'].map(
                  (h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-100 animate-pulse rounded-md" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-slate-400">
                    {canImport ? (
                      <div className="space-y-3">
                        <p className="font-semibold">Belum ada data. Import clean list pertama.</p>
                        <button
                          type="button"
                          onClick={() => setShowImport(true)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#00D4B4] text-white rounded-[10px] font-semibold text-sm shadow-[0_4px_12px_rgba(0,212,180,0.25)]"
                        >
                          <span aria-hidden>⬆️</span>
                          Import Clean List
                        </button>
                      </div>
                    ) : (
                      <p>Belum ada data clean list.</p>
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row: Record<string, unknown>, idx: number) => (
                  <tr key={String(row.id)} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 font-medium">{(page - 1) * limit + idx + 1}</td>
                    <td className="px-4 py-3 font-bold text-slate-800">{String(row.rwCode)}</td>
                    <td className="px-4 py-3 text-slate-700">{String(row.kelurahan)}</td>
                    <td className="px-4 py-3 text-slate-600">{String(row.kecamatan)}</td>
                    <td className="px-4 py-3 text-slate-600 font-medium">{String(row.ispCustomer)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          FIBER_COLORS[String(row.fiberType)] ?? ''
                        }`}
                      >
                        {String(row.fiberType)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{String(row.homepasCount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                          STATUS_STYLES[String(row.status)] ?? ''
                        }`}
                      >
                        {STATUS_LABELS[String(row.status)] ?? String(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.hasExistingFiber && (
                        <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-lg">
                          {String(row.existingOperator ?? 'Ya')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'AVAILABLE' && isSurveyorRole(user?.role) && (
                        <button
                          type="button"
                          onClick={() => {
                            // FIX: client-side navigate to new visit request with pre-selected cluster (avoid full reload / wrong redirects)
                            router.push(`/visit-requests/new?cleanListId=${String(row.id)}`);
                          }}
                          className="px-3 py-1.5 bg-[#00D4B4] text-[#0F1B2D] rounded-lg text-xs font-black hover:bg-[#00BFA3] transition-colors"
                        >
                          Request Visit
                        </button>
                      )}
                      {row.status === 'HAS_EXISTING_FIBER' && (
                        <button
                          type="button"
                          onClick={() => {
                            window.location.href = `/map?cluster=${String(row.id)}`;
                          }}
                          className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors"
                        >
                          Lihat di Peta
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {meta && total > 0 && (
          <Pagination
            total={meta.total}
            page={page} // FIX: controlled by pagination hook state
            limit={limit} // FIX: controlled by pagination hook state
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        )}
      </div>

      <CleanListImportPanel
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={({ created, skipped }) => {
          setShowImport(false);
          fetchData();
          apiGet('/clean-list/dashboard-stats').then(setDashStats).catch(() => null);
          notify.success(`Import selesai: ${created} data baru, ${skipped} diperbarui`);
        }}
      />
    </div>
  );
}

export default function CleanListPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat...</div>}>
      <CleanListPageInner />
    </Suspense>
  );
}
