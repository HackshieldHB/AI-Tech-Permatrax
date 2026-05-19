'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '../../../store/authStore';
import { apiGet, apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { Search, ChevronRight } from 'lucide-react';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import {
  PermitPhase,
  PHASE_GROUPS,
  PHASE_ORDER,
  PHASE_SHORT_LABELS,
} from '../../../types/api.types';

function PermitClustersPageInner() {
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { page, limit, setPage, setLimit } = usePagination(50);
  const [phaseStats, setPhaseStats] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<any[]>([]);
  const [listMeta, setListMeta] = useState<{ total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [phaseFilter, setPhaseFilter] = useState<PermitPhase | null>(null);
  const [phaseGroupFilter, setPhaseGroupFilter] = useState<PermitPhase[] | null>(null);
  const [fiber, setFiber] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const s = searchParams.get('status');
    if (s === 'COMPLETED' || s === 'IN_PROGRESS' || s === 'ON_HOLD') {
      setStatus(s);
    }
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      try {
        const statsJson = await apiGet<{ byPhase: Record<string, number> }>('/permit-clusters/stats');
        setPhaseStats(statsJson.byPhase ?? {});
      } catch {
        setPhaseStats({});
      }

      const list = await apiGetPaginated('/permit-clusters', {
        page,
        limit,
        ...(phaseFilter && { currentPhase: phaseFilter }),
        ...(fiber && { fiberType: fiber }),
        ...(status && { status }),
        ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
      });
      setRows(list.data);
      setListMeta({ total: list.meta.total });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [user, phaseFilter, fiber, status, debouncedSearch, page, limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [phaseFilter, phaseGroupFilter, fiber, status, debouncedSearch, setPage]);

  const filteredRows = useMemo(() => {
    if (!phaseGroupFilter) return rows;
    return rows.filter((r) => phaseGroupFilter.includes(r.currentPhase));
  }, [rows, phaseGroupFilter]);

  // NEW: table phase badge styling from macro group
  function getPhaseBadgeStyle(phase: PermitPhase): React.CSSProperties {
    const group = PHASE_GROUPS.find((g) => g.phases.includes(phase));
    return {
      background: group ? `${group.color}18` : '#6B728018',
      color: group ? group.color : '#6B7280',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      display: 'inline-block',
    };
  }

  // NEW: phase progress for 20-phase lifecycle
  const progressOf = (phase: PermitPhase) => {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    const pct = phaseIndex < 0 ? 0 : Math.round((phaseIndex / (PHASE_ORDER.length - 1)) * 100);
    return { pct, phaseIndex };
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Pipeline Perizinan</h1>
        <p className="text-slate-500 text-sm mt-1">Tracking progress dokumen per cluster</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
        {PHASE_GROUPS.map((group) => {
          const count = group.phases.reduce((sum, p) => sum + (phaseStats[p] || 0), 0);
          const isActive = phaseGroupFilter?.join('|') === group.phases.join('|');
          return (
            <div
              key={group.label}
              onClick={() => {
                setPhaseFilter(null); // MODIFIED: group filter and single phase filter are mutually exclusive
                setPhaseGroupFilter(isActive ? null : [...group.phases]);
              }}
              style={{
                background: count > 0 ? group.bgColor : 'var(--color-background-secondary)',
                border: `0.5px solid ${count > 0 ? `${group.color}40` : 'var(--color-border-tertiary)'}`,
                borderRadius: 'var(--border-radius-lg)',
                padding: '12px 16px',
                cursor: 'pointer',
                transition: 'all 150ms',
                boxShadow: isActive ? `0 0 0 2px ${group.color}22` : 'none',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 500, color: count > 0 ? group.color : 'var(--color-text-secondary)' }}>
                {count}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {group.label}
              </div>
              <div style={{ fontSize: 10, color: count > 0 ? group.color : 'var(--color-text-secondary)', marginTop: 2 }}>
                {group.phases.length} fase
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center bg-white rounded-2xl border border-slate-200 p-4">
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari kode cluster / ISP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F1B2D] text-white text-sm font-bold"
        >
          <Search className="w-4 h-4" />
          Cari
        </button>
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={fiber}
          onChange={(e) => setFiber(e.target.value)}
        >
          <option value="">Semua fiber</option>
          <option value="FTTH">FTTH</option>
          <option value="FTTB">FTTB</option>
          <option value="FTTT">FTTT</option>
        </select>
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Semua status</option>
          <option value="IN_PROGRESS">Berjalan</option>
          <option value="ON_HOLD">Hold</option>
          <option value="COMPLETED">Selesai</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-3 font-bold">Cluster</th>
              <th className="px-4 py-3 font-bold">ISP</th>
              <th className="px-4 py-3 font-bold">Fiber</th>
              <th className="px-4 py-3 font-bold">PM</th>
              <th className="px-4 py-3 font-bold">Fase</th>
              <th className="px-4 py-3 font-bold">Progress</th>
              <th className="px-4 py-3 font-bold">Update</th>
              <th className="px-4 py-3 font-bold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Memuat…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Tidak ada data
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const pr = progressOf(r.currentPhase as PermitPhase);
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {r.clusterCode}
                        {(r.baOpen?.existingFiber || r.visitRequest?.cleanList?.hasExistingFiber) && (
                          <span
                            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900"
                            title="Survey menemukan fiber existing di lokasi"
                          >
                            Fiber Existing
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.ispCustomer}</td>
                    <td className="px-4 py-3">{r.fiberType}</td>
                    <td className="px-4 py-3">{r.assignedPm?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span style={getPhaseBadgeStyle(r.currentPhase as PermitPhase)}>
                        {PHASE_SHORT_LABELS[r.currentPhase as PermitPhase] || r.currentPhase}
                      </span>
                    </td>
                    <td className="px-4 py-3 min-w-[140px]">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pr.pct}%`,
                              background: r.currentPhase === 'PERMIT_DONE' ? '#22C55E' : '#00D4B4',
                              borderRadius: 2,
                              transition: 'width 300ms',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', minWidth: 30 }}>
                          {pr.pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {new Date(r.updatedAt).toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/permit-clusters/${r.id}`}
                        className="inline-flex items-center gap-1 text-[#00D4B4] font-bold hover:underline"
                      >
                        Lihat Detail
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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
    </div>
  );
}

export default function PermitClustersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat...</div>}>
      <PermitClustersPageInner />
    </Suspense>
  );
}
