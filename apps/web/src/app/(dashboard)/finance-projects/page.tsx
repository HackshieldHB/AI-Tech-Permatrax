'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiGetPaginated } from '../../../lib/api';
import { apiDownload } from '../../../lib/api';
import { formatRupiah, formatPercentage } from '../../../lib/format';
import type { FinanceProjectListItem, FinanceProjectStatus } from '../../../types/api.types';
import { num } from './_lib/num';
import { canManageFinance, canExportFinanceReport } from '../../../lib/finance-roles';
import { useAuthStore } from '../../../store/authStore';

type Tab = 'ACTIVE' | 'CLOSED' | 'ARCHIVED' | 'ALL';

// JLM: Terpakai = Realisasi (sinkron dengan halaman Detail). FTTT memakai
// totalSpent dari Transaction Log; fallback ke material+jasa untuk data lama.
function spentOverall(p: FinanceProjectListItem): number {
  return p.totalSpent != null ? num(p.totalSpent) : num(p.materialSpent) + num(p.jasaSpent);
}

function remainingOverall(p: FinanceProjectListItem): number {
  return p.totalRemaining != null
    ? num(p.totalRemaining)
    : num(p.materialRemaining) + num(p.jasaRemaining);
}

function utilOverall(p: FinanceProjectListItem): number {
  const total = num(p.totalBudget);
  if (total <= 0) return 0;
  return spentOverall(p) / total;
}

function utilBarColor(ratio: number): string {
  if (ratio > 1) return '#EF4444';
  if (ratio >= 0.8) return '#F97316';
  if (ratio >= 0.5) return '#EAB308';
  return '#22C55E';
}

export default function FinanceProjectsDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const manage = canManageFinance(user?.role);
  const canExport = canExportFinanceReport(user?.role);
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<FinanceProjectListItem[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  // Integra V1: expandable Segment rows show their Sites inline
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sitesByParent, setSitesByParent] = useState<Record<string, FinanceProjectListItem[]>>({});
  const [loadingSites, setLoadingSites] = useState<Record<string, boolean>>({});

  const toggleExpand = useCallback(async (segmentId: string) => {
    const willOpen = !expanded[segmentId];
    setExpanded((cur) => ({ ...cur, [segmentId]: willOpen }));
    if (willOpen && !sitesByParent[segmentId]) {
      setLoadingSites((cur) => ({ ...cur, [segmentId]: true }));
      try {
        const res = await apiGetPaginated<FinanceProjectListItem>('/finance-projects', {
          parentId: segmentId,
          limit: 100,
        });
        setSitesByParent((cur) => ({ ...cur, [segmentId]: res.data }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Gagal memuat Site');
      } finally {
        setLoadingSites((cur) => ({ ...cur, [segmentId]: false }));
      }
    }
  }, [expanded, sitesByParent]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = {
        limit: 100,
        page: 1,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      };
      if (tab === 'ALL') {
        params.includeArchived = true;
      } else if (tab === 'ARCHIVED') {
        params.includeArchived = true;
        params.status = 'ARCHIVED';
      } else {
        params.status = tab as FinanceProjectStatus;
      }
      if (search.trim()) params.search = search.trim();
      const res = await apiGetPaginated<FinanceProjectListItem>('/finance-projects', params);
      setProjects(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCards = useMemo(() => projects, [projects]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Dashboard Finance Project</h1>
          <p className="text-sm text-slate-500 mt-1">Monitoring budget per proyek</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage ? (
            <Link
              href="/finance-projects/new"
              className="inline-flex items-center gap-2 rounded-xl bg-[#0F1B2D] text-white px-4 py-2 text-sm font-bold"
            >
              <Plus className="w-4 h-4" />
              Tambah Project
            </Link>
          ) : null}
          {manage ? (
            <Link
              href="/finance-projects/transfer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800"
            >
              Transfer Alokasi
            </Link>
          ) : null}
          {canExport ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800"
            >
              Export Laporan
              <ChevronDown className="w-4 h-4" />
            </button>
            {exportOpen ? (
              <div className="absolute right-0 mt-1 z-30 w-48 rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={async () => {
                    setExportOpen(false);
                    try {
                      await apiDownload('/finance-reports/summary/excel');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Export gagal');
                    }
                  }}
                >
                  Semua (Excel)
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={async () => {
                    setExportOpen(false);
                    try {
                      await apiDownload('/finance-reports/summary/pdf');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Export gagal');
                    }
                  }}
                >
                  Semua (PDF)
                </button>
              </div>
            ) : null}
          </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
          {(['ACTIVE', 'CLOSED', 'ARCHIVED', 'ALL'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                tab === t ? 'bg-white shadow text-slate-900' : 'text-slate-600'
              }`}
            >
              {t === 'ALL' ? 'Semua' : t === 'ACTIVE' ? 'Aktif' : t === 'CLOSED' ? 'Ditutup' : 'Diarsipkan'}
            </button>
          ))}
        </div>
        <input
          className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          placeholder="Cari kode / nama…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load();
          }}
        />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-slate-800 text-white px-4 py-2 text-sm font-bold"
        >
          Cari
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : filteredCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
          Belum ada project. Klik Tambah Project untuk memulai.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCards.map((p) => {
            const isGen = p.isDefaultUncategorized;
            const isFttt = p.projectType === 'FTTT';
            const isSegment = p.hierarchyLevel === 'SEGMENT';
            const total = num(p.totalBudget);
            const rem = remainingOverall(p);
            const ratio = isGen ? 0 : utilOverall(p);
            const barPct = Math.min(100, ratio * 100);
            const remRatio = total > 0 ? rem / total : 0;
            const sites = sitesByParent[p.id] ?? [];
            const isExpanded = !!expanded[p.id];
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-100 bg-white shadow-sm p-5 flex flex-col gap-3"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                      {isSegment ? <Folder className="w-3.5 h-3.5 text-amber-500" /> : null}
                      {p.code}
                      {isSegment ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase">
                          Segment
                        </span>
                      ) : null}
                    </div>
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Status: {p.status}
                      {isSegment ? ` · ${p.childCount ?? 0} Site` : ''}
                    </div>
                  </div>
                  {p.isOverbudget ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                      OVERBUDGET
                    </span>
                  ) : null}
                </div>
                <div>
                  <div className="text-xs text-slate-500">
                    {isGen ? 'Belum dialokasi' : 'Total'}
                  </div>
                  <div className="text-lg font-black text-slate-900">
                    {isGen ? 'Belum dialokasi' : formatRupiah(total)}
                  </div>
                </div>
                {!isGen ? (
                  <>
                    <div>
                      <div className="text-xs text-slate-500">Sisa · terpakai</div>
                      <div className="text-sm font-bold text-slate-800">
                        {formatRupiah(rem)} ({formatPercentage(remRatio, 0)})
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${barPct}%`,
                            backgroundColor: utilBarColor(ratio),
                          }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {formatPercentage(ratio, 0)} terpakai
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {/* Integra V3: list P&L snapshot for Finance/GM */}
                      {manage && (isFttt || isSegment) ? (
                        <>
                          <div className="rounded-lg p-2 bg-slate-50 col-span-2">
                            {/* Integra V5: list shows Estimasi = PO − RAB (not PO − Actual) */}
                            <div className="text-slate-500">PO Customer · RAB · Estimasi P/L</div>
                            <div className="font-bold text-slate-800 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>{formatRupiah(num(p.poCustomerAmount ?? p.poCustomer))}</span>
                              <span className="text-slate-400">·</span>
                              <span>{formatRupiah(p.totalRab ?? num(p.totalBudget))}</span>
                              <span className="text-slate-400">·</span>
                              <span style={{ color: (p.estimatedMargin ?? 0) >= 0 ? '#1a7f37' : '#cf222e' }}>
                                {p.estimatedMargin == null && p.poCustomerAmount == null && p.poCustomer == null
                                  ? '—'
                                  : formatRupiah(
                                      p.estimatedMargin ??
                                        (num(p.poCustomerAmount ?? p.poCustomer) - (p.totalRab ?? num(p.totalBudget))),
                                    )}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : null}
                      {/* Integra V2: Segment cards show BUDGET summary (sum of Sites) instead of realisasi/spent */}
                      {isFttt ? (
                        <div
                          className={
                            isSegment
                              ? 'rounded-lg p-2 bg-slate-50'
                              : `rounded-lg p-2 ${
                                  num(p.budgetPerizinan) > 0 &&
                                  num(p.perizinanSpent) / Math.max(num(p.budgetPerizinan), 1) >= 0.8
                                    ? 'bg-orange-50 text-orange-900'
                                    : 'bg-slate-50'
                                }`
                          }
                        >
                          <div className="text-slate-500">Perizinan</div>
                          <div className="font-bold">{formatRupiah(isSegment ? num(p.budgetPerizinan) : num(p.perizinanSpent))}</div>
                        </div>
                      ) : null}
                      <div
                        className={
                          isSegment
                            ? 'rounded-lg p-2 bg-slate-50'
                            : `rounded-lg p-2 ${
                                num(p.materialBudget) > 0 &&
                                num(p.materialSpent) / Math.max(num(p.materialBudget), 1) >= 0.8
                                  ? 'bg-orange-50 text-orange-900'
                                  : 'bg-slate-50'
                              }`
                        }
                      >
                        <div className="text-slate-500">Material</div>
                        <div className="font-bold">{formatRupiah(isSegment ? num(p.materialBudget) : num(p.materialSpent))}</div>
                      </div>
                      <div
                        className={
                          isSegment
                            ? 'rounded-lg p-2 bg-slate-50'
                            : `rounded-lg p-2 ${
                                num(p.jasaBudget) > 0 &&
                                num(p.jasaSpent) / Math.max(num(p.jasaBudget), 1) >= 0.8
                                  ? 'bg-orange-50 text-orange-900'
                                  : 'bg-slate-50'
                              }`
                        }
                      >
                        <div className="text-slate-500">Jasa</div>
                        <div className="font-bold">{formatRupiah(isSegment ? num(p.jasaBudget) : num(p.jasaSpent))}</div>
                      </div>
                      {isFttt ? (
                        <div
                          className={
                            isSegment
                              ? 'rounded-lg p-2 bg-slate-50'
                              : `rounded-lg p-2 ${
                                  num(p.budgetLainLain) > 0 &&
                                  num(p.lainLainSpent) / Math.max(num(p.budgetLainLain), 1) >= 0.8
                                    ? 'bg-orange-50 text-orange-900'
                                    : 'bg-slate-50'
                                }`
                          }
                        >
                          <div className="text-slate-500">Lain-lain</div>
                          <div className="font-bold">{formatRupiah(isSegment ? num(p.budgetLainLain) : num(p.lainLainSpent))}</div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">
                    Project GENERAL untuk transaksi yang belum ditugaskan. Progress tidak ditampilkan.
                  </p>
                )}
                {isSegment ? (
                  <button
                    type="button"
                    onClick={() => void toggleExpand(p.id)}
                    className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-[#00D4B4]"
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {isExpanded ? 'Sembunyikan Sites' : `Lihat Sites (${p.childCount ?? 0})`}
                  </button>
                ) : null}

                {isSegment && isExpanded ? (
                  <div className="flex flex-col gap-2 rounded-xl bg-slate-50 border border-slate-100 p-2">
                    {loadingSites[p.id] ? (
                      <div className="text-xs text-slate-500 px-2 py-1">Memuat sites…</div>
                    ) : sites.length === 0 ? (
                      <div className="text-xs text-slate-500 px-2 py-1">Belum ada Site.</div>
                    ) : (
                      sites.map((s) => (
                        <Link
                          key={s.id}
                          href={`/finance-projects/${s.id}`}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white border border-slate-100 px-3 py-2 hover:border-[#00D4B4]"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] font-bold text-slate-500">{s.code}</div>
                            <div className="text-xs font-bold text-slate-900 truncate">{s.name}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-slate-800">{formatRupiah(num(s.totalBudget))}</div>
                            <div className="text-[10px] text-slate-500">{s.status}</div>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                ) : null}

                <Link
                  href={`/finance-projects/${p.id}`}
                  className="mt-auto text-center rounded-xl border border-slate-200 py-2 text-sm font-bold text-[#00D4B4] hover:bg-slate-50"
                >
                  Lihat Detail
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
