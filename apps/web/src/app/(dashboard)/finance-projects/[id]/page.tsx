'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Settings,
  PieChart as PieIcon,
  Folder,
  Download,
  Upload,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../store/authStore';
import { apiGet, apiGetPaginated, apiPatch, apiPut, apiPost, apiDownload, apiPostForm } from '../../../../lib/api';
import { formatRupiah, formatDateTimeID, formatDateID } from '../../../../lib/format';
import type {
  BudgetLedger,
  FinanceProjectDetail,
  FinanceProjectListItem,
} from '../../../../types/api.types';
import { num } from '../_lib/num';
import { ForecastPanel } from './ForecastPanel';
import { SCurveChart } from './SCurveChart';
import { FtttFinanceMonitor } from './FtttFinanceMonitor';
import { FinancialPerformance } from './FinancialPerformance';
import { canManageFinance } from '../../../../lib/finance-roles';

const PIE_COLORS = ['#10B981', '#6366F1', '#94A3B8'];

type Tab = 'overview' | 'transactions' | 'scurve' | 'forecast' | 'adjustments';

const ENTRY_LABELS: Record<string, string> = {
  BUDGET_INIT: 'Inisialisasi',
  BUDGET_ADJUSTMENT: 'Penyesuaian',
  DEDUCT_MATERIAL: 'Potongan Material',
  DEDUCT_JASA: 'Potongan Jasa',
  REFUND_MATERIAL: 'Refund Material',
  REFUND_JASA: 'Refund Jasa',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
};

const META_BUDGET_LABELS: Record<string, string> = {
  totalBudget: 'Total budget',
  materialBudget: 'Budget material',
  jasaBudget: 'Budget jasa',
  materialSpent: 'Realisasi material (saat penyesuaian)',
  jasaSpent: 'Realisasi jasa (saat penyesuaian)',
};

function formatMetaCurrency(val: unknown): string {
  if (val == null || val === '') return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  return formatRupiah(n);
}

function AdjustmentSnapshotDiff({ metadata }: { metadata: Record<string, unknown> }) {
  const prev = metadata.previous;
  const next = metadata.next;
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return null;
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const order = ['totalBudget', 'materialBudget', 'jasaBudget', 'materialSpent', 'jasaSpent'];
  const keys = order.filter((k) => k in p || k in n);
  if (keys.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden text-sm">
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-px bg-slate-200">
        <div className="bg-slate-100 px-2 py-1.5 font-semibold text-xs text-slate-600">Field</div>
        <div className="bg-slate-100 px-2 py-1.5 font-semibold text-xs text-slate-600">Sebelum</div>
        <div className="bg-slate-100 px-2 py-1.5 font-semibold text-xs text-slate-600">Sesudah</div>
        {keys.map((k) => {
          const pv = p[k];
          const nv = n[k];
          const changed = String(pv ?? '') !== String(nv ?? '');
          return (
            <React.Fragment key={k}>
              <div className={`bg-white px-2 py-1.5 text-xs ${changed ? 'font-semibold text-amber-900' : ''}`}>
                {META_BUDGET_LABELS[k] ?? k}
              </div>
              <div className={`bg-white px-2 py-1.5 text-xs tabular-nums ${changed ? 'bg-amber-50' : ''}`}>
                {formatMetaCurrency(pv)}
              </div>
              <div className={`bg-white px-2 py-1.5 text-xs tabular-nums ${changed ? 'bg-emerald-50' : ''}`}>
                {formatMetaCurrency(nv)}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function AdjustmentMetadataExpand({ entry }: { entry: BudgetLedger }) {
  const m = entry.metadata;
  if (!m || typeof m !== 'object') return null;
  const meta = m as Record<string, unknown>;

  if (meta.previous && meta.next) {
    return (
      <div className="mt-2 space-y-2">
        {typeof meta.reason === 'string' && meta.reason.trim() ? (
          <p className="text-xs text-slate-600">
            <span className="font-semibold">Alasan:</span> {meta.reason}
          </p>
        ) : null}
        <AdjustmentSnapshotDiff metadata={meta} />
      </div>
    );
  }

  if ('totalBudget' in meta) {
    return (
      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Total budget</span>
          <span className="font-medium tabular-nums">{formatMetaCurrency(meta.totalBudget)}</span>
        </div>
        {'materialBudget' in meta ? (
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Budget material</span>
            <span className="font-medium tabular-nums">{formatMetaCurrency(meta.materialBudget)}</span>
          </div>
        ) : null}
        {'jasaBudget' in meta ? (
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Budget jasa</span>
            <span className="font-medium tabular-nums">{formatMetaCurrency(meta.jasaBudget)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <pre className="text-[11px] bg-slate-50 rounded-lg p-2 mt-2 overflow-x-auto max-h-40">
      {JSON.stringify(entry.metadata, null, 2)}
    </pre>
  );
}

export default function FinanceProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user } = useAuthStore();
  const manage = canManageFinance(user?.role);
  const canEditTimeline = manage || user?.role === 'PM_FTTT' || user?.role === 'GENERAL_MANAGER';

  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<FinanceProjectDetail | null>(null);
  const [adjustments, setAdjustments] = useState<BudgetLedger[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledger, setLedger] = useState<{ rows: BudgetLedger[]; total: number }>({ rows: [], total: 0 });
  const [ledgerFilterType, setLedgerFilterType] = useState('');
  const [ledgerCat, setLedgerCat] = useState('');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [loading, setLoading] = useState(true);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [budgetTotal, setBudgetTotal] = useState('');
  const [budgetMat, setBudgetMat] = useState('');
  const [budgetJas, setBudgetJas] = useState('');
  const [budgetReason, setBudgetReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedAdjustmentId, setExpandedAdjustmentId] = useState<string | null>(null);
  // JLM: FTTT S-Curve baseline timeline (milestones) editor
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [savingTimeline, setSavingTimeline] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [msRows, setMsRows] = useState<{ targetDate: string; plannedBudget: string; plannedProgressPct: string }[]>([]);
  const [hasBaselinePlan, setHasBaselinePlan] = useState(false);
  // Integra V1: Segment → Site management + Set Plan Awal via Excel template
  const [siteName, setSiteName] = useState('');
  const [sitePerizinan, setSitePerizinan] = useState('');
  const [siteMaterial, setSiteMaterial] = useState('');
  const [siteJasa, setSiteJasa] = useState('');
  const [creatingSite, setCreatingSite] = useState(false);
  const [uploadingPlan, setUploadingPlan] = useState(false);

  const formatBudgetInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('id-ID');
  };
  const parseBudgetInput = (display: string) => Number(display.replace(/\D/g, '')) || 0;

  const openTimeline = useCallback(async () => {
    setTimelineOpen(true);
    try {
      const res = await apiGet<{
        milestones: { targetDate: string; plannedBudget: string | number; plannedProgressPct: string | number }[];
        hasBaseline: boolean;
        hasRevision: boolean;
      } | { targetDate: string; plannedBudget: string | number; plannedProgressPct: string | number }[]>(`/finance-projects/${id}/timeline`);
      const rows = Array.isArray(res) ? res : (res.milestones ?? []);
      const baseline = Array.isArray(res) ? rows.length > 0 : !!res.hasBaseline;
      setHasBaselinePlan(baseline);
      setMsRows(rows.length
        ? rows.map((r) => ({
            targetDate: String(r.targetDate).slice(0, 10),
            plannedBudget: Number(r.plannedBudget) ? Number(r.plannedBudget).toLocaleString('id-ID') : '',
            plannedProgressPct: String(Number(r.plannedProgressPct)),
          }))
        : [{ targetDate: '', plannedBudget: '', plannedProgressPct: '' }]);
    } catch {
      setHasBaselinePlan(false);
      setMsRows([{ targetDate: '', plannedBudget: '', plannedProgressPct: '' }]);
    }
  }, [id]);

  const saveTimeline = async () => {
    const milestones = msRows
      .filter((r) => r.targetDate)
      .map((r) => ({
        targetDate: new Date(r.targetDate + 'T12:00:00').toISOString(),
        plannedBudget: parseBudgetInput(r.plannedBudget),
        plannedProgressPct: Math.min(100, Number(r.plannedProgressPct) || 0),
      }));
    setSavingTimeline(true);
    try {
      const res = await apiPut<{ hasBaseline?: boolean }>(`/finance-projects/${id}/timeline`, { milestones });
      toast.success(hasBaselinePlan ? 'Perubahan Planning tersimpan' : 'Plan Awal tersimpan sebagai baseline');
      setHasBaselinePlan(true);
      setTimelineOpen(false);
      setReloadKey((k) => k + 1);
      void res;
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Gagal menyimpan'); }
    finally { setSavingTimeline(false); }
  };

  const handleCreateSite = async () => {
    if (!siteName.trim()) { toast.error('Nama Site wajib diisi'); return; }
    setCreatingSite(true);
    try {
      await apiPost(`/finance-projects/${id}/sites`, {
        name: siteName.trim(),
        budgetPerizinan: Number(sitePerizinan) || 0,
        materialBudget: Number(siteMaterial) || 0,
        jasaBudget: Number(siteJasa) || 0,
      });
      toast.success('Site berhasil dibuat');
      setSiteName(''); setSitePerizinan(''); setSiteMaterial(''); setSiteJasa('');
      await loadDetail();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat Site');
    } finally {
      setCreatingSite(false);
    }
  };

  const handleDownloadPlanTemplate = async () => {
    try {
      await apiDownload(`/finance-projects/${id}/plan-template`, 'template-set-plan-awal.xlsx');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunduh template');
    }
  };

  const handleUploadPlan = async (file: File) => {
    setUploadingPlan(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiPostForm(`/finance-projects/${id}/plan-import`, fd);
      toast.success('Set Plan Awal berhasil diunggah');
      setHasBaselinePlan(true);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengunggah — periksa format sesuai template');
    } finally {
      setUploadingPlan(false);
    }
  };

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<FinanceProjectDetail>(`/finance-projects/${id}`);
      setDetail(d);
      if (d.projectType === 'FTTT') {
        try {
          const tl = await apiGet<{ hasBaseline?: boolean; milestones?: unknown[] } | unknown[]>(`/finance-projects/${id}/timeline`);
          if (Array.isArray(tl)) setHasBaselinePlan(tl.length > 0);
          else setHasBaselinePlan(!!tl.hasBaseline || (Array.isArray(tl.milestones) && tl.milestones.length > 0));
        } catch { /* ignore */ }
      }
      setEditName(d.name);
      setEditDesc(d.description ?? '');
      setBudgetTotal(String(num(d.totalBudget)));
      setBudgetMat(d.materialBudget != null ? String(num(d.materialBudget)) : '');
      setBudgetJas(d.jasaBudget != null ? String(num(d.jasaBudget)) : '');
      const adj = await apiGet<BudgetLedger[]>(`/finance-projects/${id}/adjustments`);
      setAdjustments(adj);
    } catch {
      toast.error('Gagal memuat proyek');
      router.push('/finance-projects');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  const loadLedger = useCallback(async () => {
    try {
      const params: Record<string, string | number> = {
        page: ledgerPage,
        limit: 50,
        ...(ledgerFilterType ? { entryType: ledgerFilterType } : {}),
        ...(ledgerCat ? { category: ledgerCat } : {}),
        ...(ledgerFrom ? { from: new Date(`${ledgerFrom}T00:00:00.000Z`).toISOString() } : {}),
        ...(ledgerTo ? { to: new Date(`${ledgerTo}T23:59:59.999Z`).toISOString() } : {}),
      };
      const res = await apiGetPaginated<BudgetLedger>(`/finance-projects/${id}/ledger`, params);
      setLedger({ rows: res.data, total: res.meta.total });
    } catch {
      toast.error('Gagal memuat ledger');
    }
  }, [id, ledgerPage, ledgerFilterType, ledgerCat, ledgerFrom, ledgerTo]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setLedgerPage(1);
  }, [ledgerFilterType, ledgerCat, ledgerFrom, ledgerTo]);

  useEffect(() => {
    if (tab === 'transactions') void loadLedger();
  }, [tab, loadLedger]);

  // JLM: Terpakai = Realisasi penuh (FTTT: semua kategori dari Transaction Log),
  // sinkron dengan Dashboard; fallback material+jasa untuk respons API lama
  const spentTotal = detail
    ? detail.totalSpent != null
      ? num(detail.totalSpent)
      : num(detail.materialSpent) + num(detail.jasaSpent)
    : 0;
  const totalB = detail ? num(detail.totalBudget) : 0;
  const remTotal = detail
    ? detail.totalRemaining != null
      ? num(detail.totalRemaining)
      : (detail.materialRemaining ?? 0) + (detail.jasaRemaining ?? 0)
    : 0;
  const util = totalB > 0 ? spentTotal / totalB : 0;

  const pieData = useMemo(() => {
    if (!detail) return [];
    return [
      { name: 'Realisasi Material', value: num(detail.materialSpent) },
      { name: 'Realisasi Jasa', value: num(detail.jasaSpent) },
      { name: 'Sisa', value: Math.max(0, remTotal) },
    ].filter((x) => x.value > 0 || x.name === 'Sisa');
  }, [detail, remTotal]);

  const ledgerForForecast = useMemo(
    () => [...(detail?.recentLedgerEntries ?? []), ...ledger.rows],
    [detail, ledger.rows],
  );

  const newBudgetTotalNum = Number(budgetTotal) || 0;
  const budgetTotalBelowSpent =
    !!detail &&
    !detail.isDefaultUncategorized &&
    newBudgetTotalNum > 0 &&
    newBudgetTotalNum < spentTotal;

  if (loading || !detail) {
    return <div className="p-8 text-slate-500">Memuat…</div>;
  }

  const isGen = detail.isDefaultUncategorized;
  // JLM: FTTT finance projects show FTTT monitoring (no Forecast tab) + baseline timeline
  const isFttt = detail.projectType === 'FTTT';
  // Integra V1: Segment (parent, Lain-Lain only) / Site (child, Perizinan+Material+Jasa)
  const isSegment = detail.hierarchyLevel === 'SEGMENT';
  const isSite = detail.hierarchyLevel === 'SITE';
  const sites: FinanceProjectListItem[] = detail.sites ?? [];

  return (
    <div className="max-w-6xl mx-auto px-3 pb-12 space-y-6">
      <Link
        href="/finance-projects"
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-[#00D4B4]"
      >
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-black text-slate-900">
              {detail.code} · {detail.name}
            </h1>
            {isSegment ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 uppercase">
                <Folder className="w-3 h-3" /> Segment
              </span>
            ) : null}
            {isSite ? (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 uppercase">
                Site
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {detail.status} · Dibuat {formatDateID(detail.createdAt)}
          </p>
          {isSite && detail.parent ? (
            <p className="text-sm text-slate-600 mt-1">
              Bagian dari Segment:{' '}
              <Link href={`/finance-projects/${detail.parent.id}`} className="font-bold text-[#00D4B4] hover:underline">
                {detail.parent.code} · {detail.parent.name}
              </Link>
            </p>
          ) : null}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
            <div>
              <div className="text-xs text-slate-500">{isSegment ? 'Budget Lain-Lain' : 'Total Budget'}</div>
              <div className="font-bold">{isGen ? '—' : formatRupiah(isSegment ? num(detail.budgetLainLain) : totalB)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Sisa</div>
              <div className="font-bold">{formatRupiah(remTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Terpakai</div>
              <div className="font-bold">{formatRupiah(spentTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Utilisasi</div>
              <div className="font-bold">{isGen ? '—' : `${(util * 100).toFixed(0)}%`}</div>
            </div>
          </div>
          {isSite ? (
            <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Budget Perizinan</div>
                <div className="font-bold">{formatRupiah(num(detail.budgetPerizinan))}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Budget Material</div>
                <div className="font-bold">{formatRupiah(num(detail.materialBudget))}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Budget Jasa</div>
                <div className="font-bold">{formatRupiah(num(detail.jasaBudget))}</div>
              </div>
            </div>
          ) : null}
          {!isGen ? (
            <div className="h-2 rounded-full bg-slate-100 mt-3 max-w-md">
              <div
                className="h-full rounded-full bg-[#00D4B4]"
                style={{ width: `${Math.min(100, util * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* JLM: Finance sets the S-Curve Planning baseline (milestones) for linked FTTT projects */}
          {isFttt && canEditTimeline ? (
            <button
              type="button"
              onClick={() => void openTimeline()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0F1B2D] text-white px-3 py-2 text-sm font-bold"
            >
              {hasBaselinePlan ? '✏️ Edit Planning' : '📌 Set Plan Awal'}
            </button>
          ) : null}
          {/* Integra V1: Excel template download + Set Plan Awal bulk import.
              Upload is only offered before a baseline exists — once Set Plan Awal
              is done, Planning changes go through "Edit Planning" instead. */}
          {isFttt && canEditTimeline ? (
            <>
              <button
                type="button"
                onClick={() => void handleDownloadPlanTemplate()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
              >
                <Download className="w-4 h-4" /> Template Set Plan Awal
              </button>
              {!hasBaselinePlan ? (
                <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 cursor-pointer">
                  <Upload className="w-4 h-4" /> {uploadingPlan ? 'Mengunggah…' : 'Upload Set Plan Awal'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    disabled={uploadingPlan}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadPlan(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              ) : null}
            </>
          ) : null}
          {manage ? (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold"
            >
              <Settings className="w-4 h-4" />
              Pengaturan
            </button>
          ) : null}
        </div>
      </header>

      {isSegment ? (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 space-y-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Folder className="w-4 h-4 text-amber-500" /> Sites di bawah Segment ini ({sites.length})
          </h3>
          {sites.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada Site. Tambahkan Site menggunakan form di bawah.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-2">Kode</th>
                    <th className="p-2">Nama</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 text-right">Total Budget</th>
                    <th className="p-2 text-right">Terpakai</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr
                      key={s.id}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => router.push(`/finance-projects/${s.id}`)}
                    >
                      <td className="p-2 font-bold text-[#00D4B4]">{s.code}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2">{s.status}</td>
                      <td className="p-2 text-right tabular-nums">{formatRupiah(num(s.totalBudget))}</td>
                      <td className="p-2 text-right tabular-nums">{formatRupiah(num(s.totalSpent))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {manage ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase">Tambah Site</p>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Nama Site *"
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Budget Perizinan"
                  value={sitePerizinan}
                  onChange={(e) => setSitePerizinan(e.target.value.replace(/\D/g, ''))}
                />
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Budget Material"
                  value={siteMaterial}
                  onChange={(e) => setSiteMaterial(e.target.value.replace(/\D/g, ''))}
                />
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Budget Jasa"
                  value={siteJasa}
                  onChange={(e) => setSiteJasa(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <button
                type="button"
                disabled={creatingSite}
                onClick={() => void handleCreateSite()}
                className="rounded-xl bg-[#0F1B2D] text-white px-4 py-2 text-sm font-bold disabled:opacity-50"
              >
                {creatingSite ? 'Menyimpan…' : '+ Tambah Site'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-slate-100">
        {(
          (isFttt
            ? [
                ['overview', 'Overview'],
                ['transactions', 'Transaksi'],
                ['scurve', 'Kurva S'],
                ['adjustments', 'Riwayat Penyesuaian'],
              ]
            : [
                ['overview', 'Overview'],
                ['transactions', 'Transaksi'],
                ['scurve', 'Kurva S'],
                ['forecast', 'Forecast'],
                ['adjustments', 'Riwayat Penyesuaian'],
              ]) as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px ${
              tab === k ? 'border-[#00D4B4] text-[#00D4B4]' : 'border-transparent text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Integra V3: P&L — Finance + GM only */}
      {canManageFinance(user?.role) && tab === 'overview' ? (
        <FinancialPerformance
          detail={detail}
          canEdit={user?.role === 'FINANCE'}
          isGm={user?.role === 'GENERAL_MANAGER'}
          onRefresh={() => void loadDetail()}
        />
      ) : null}

      {/* JLM: FTTT projects render FTTT monitoring for overview/transaksi/kurva-s */}
      {isFttt && (tab === 'overview' || tab === 'transactions' || tab === 'scurve') ? (
        <FtttFinanceMonitor financeProjectId={id} tab={tab as 'overview' | 'transactions' | 'scurve'} reloadKey={reloadKey} />
      ) : null}

      {!isFttt && tab === 'overview' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <PieIcon className="w-4 h-4" /> Realisasi vs sisa
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(1)}%`}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatRupiah(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Material</div>
                <div className="h-2 rounded bg-slate-100 mt-1">
                  <div
                    className="h-2 rounded bg-emerald-500"
                    style={{
                      width: `${
                        num(detail.materialBudget) > 0
                          ? Math.min(100, (num(detail.materialSpent) / num(detail.materialBudget)) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Jasa</div>
                <div className="h-2 rounded bg-slate-100 mt-1">
                  <div
                    className="h-2 rounded bg-indigo-500"
                    style={{
                      width: `${
                        num(detail.jasaBudget) > 0
                          ? Math.min(100, (num(detail.jasaSpent) / num(detail.jasaBudget)) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 p-4 space-y-2 text-sm">
            <div className="font-bold text-slate-800">Aktivitas ledger</div>
            <div>Total transaksi: {detail.activityStats.totalTransactions}</div>
            <div>Pengurangan (deduct): {detail.activityStats.deductCount}</div>
            <div>Refund: {detail.activityStats.refundCount}</div>
            <div>Transfer (baris ledger): {detail.activityStats.transferCount}</div>
            <div className="text-xs text-slate-600">
              Aktivitas terakhir:{' '}
              {detail.activityStats.lastActivityAt
                ? `${formatDateTimeID(detail.activityStats.lastActivityAt)} · ${ENTRY_LABELS[detail.activityStats.lastActivityType ?? ''] ?? detail.activityStats.lastActivityType ?? '—'}`
                : '—'}
            </div>
            <div>
              Pending transfer: {detail.pendingTransferCount}
              {detail.pendingTransferCount > 0 ? (
                <Link href="/finance-projects/transfer" className="ml-2 text-[#00D4B4] font-bold">
                  Lihat
                </Link>
              ) : null}
            </div>
            <div className="pt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs font-bold px-3 py-1.5 rounded-lg border"
                onClick={async () => {
                  try {
                    await apiDownload(`/finance-reports/project/${id}/excel`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Export gagal');
                  }
                }}
              >
                Export Excel
              </button>
              <button
                type="button"
                className="text-xs font-bold px-3 py-1.5 rounded-lg border"
                onClick={async () => {
                  try {
                    await apiDownload(`/finance-reports/project/${id}/pdf`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Export gagal');
                  }
                }}
              >
                Export PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!isFttt && tab === 'transactions' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-lg border border-slate-200 text-sm px-2 py-1"
              value={ledgerFilterType}
              onChange={(e) => setLedgerFilterType(e.target.value)}
            >
              <option value="">Semua tipe</option>
              {Object.keys(ENTRY_LABELS).map((k) => (
                <option key={k} value={k}>
                  {ENTRY_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-slate-200 text-sm px-2 py-1"
              value={ledgerCat}
              onChange={(e) => setLedgerCat(e.target.value)}
            >
              <option value="">Semua kategori</option>
              <option value="MATERIAL">Material</option>
              <option value="JASA">Jasa</option>
            </select>
            <input
              type="date"
              className="rounded-lg border border-slate-200 text-sm px-2 py-1"
              value={ledgerFrom}
              onChange={(e) => setLedgerFrom(e.target.value)}
            />
            <input
              type="date"
              className="rounded-lg border border-slate-200 text-sm px-2 py-1"
              value={ledgerTo}
              onChange={(e) => setLedgerTo(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-2">Tanggal</th>
                  <th className="p-2">Tipe</th>
                  <th className="p-2">Kat</th>
                  <th className="p-2">Jumlah</th>
                  <th className="p-2">Sumber</th>
                  <th className="p-2">Catatan</th>
                  <th className="p-2">Dibuat oleh</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => {
                      if (r.sourceType === 'ORDER' && r.sourceId) router.push(`/orders/${r.sourceId}`);
                      if (r.sourceType === 'CASH_OP' && r.sourceId) router.push(`/cash-operation/${r.sourceId}`);
                    }}
                  >
                    <td className="p-2 whitespace-nowrap">{formatDateTimeID(r.createdAt)}</td>
                    <td className="p-2">{ENTRY_LABELS[r.entryType] ?? r.entryType}</td>
                    <td className="p-2">{r.category ?? '—'}</td>
                    <td className="p-2">{formatRupiah(num(r.amount))}</td>
                    <td className="p-2 text-xs">
                      {r.sourceType ?? '—'} {r.sourceId ? r.sourceId.slice(0, 8) : ''}
                    </td>
                    <td className="p-2 max-w-[140px] truncate" title={r.notes ?? ''}>
                      {r.notes ?? '—'}
                    </td>
                    <td className="p-2 text-xs whitespace-nowrap">
                      {r.createdBy?.name ?? r.createdBy?.email ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-sm">
            <button
              type="button"
              disabled={ledgerPage <= 1}
              className="font-bold disabled:opacity-40"
              onClick={() => setLedgerPage((p) => Math.max(1, p - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={ledgerPage * 50 >= ledger.total}
              className="font-bold disabled:opacity-40"
              onClick={() => setLedgerPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}

      {!isFttt && tab === 'scurve' ? (
        <SCurveChart projectId={id} manage={manage} />
      ) : null}

      {tab === 'forecast' ? (
        <ForecastPanel projectId={id} ledgerSample={ledgerForForecast} totalBudget={totalB} />
      ) : null}

      {tab === 'adjustments' ? (
        <div className="space-y-4 border-l-2 border-slate-200 ml-3 pl-4">
          {adjustments.map((a) => (
            <div key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-[#00D4B4]" />
              <div className="text-xs text-slate-500">{formatDateTimeID(a.createdAt)}</div>
              <div className="font-bold">{ENTRY_LABELS[a.entryType] ?? a.entryType}</div>
              <div className="text-sm">{formatRupiah(num(a.amount))}</div>
              {a.metadata && typeof a.metadata === 'object' ? (
                <>
                  <button
                    type="button"
                    className="mt-1 text-xs font-semibold text-[#0F1B2D] underline"
                    onClick={() => setExpandedAdjustmentId((cur) => (cur === a.id ? null : a.id))}
                  >
                    {expandedAdjustmentId === a.id ? 'Sembunyikan detail' : 'Tampilkan detail snapshot'}
                  </button>
                  {expandedAdjustmentId === a.id ? <AdjustmentMetadataExpand entry={a} /> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* JLM: Atur Timeline — S-Curve baseline milestones (Finance) */}
      {timelineOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-lg">{hasBaselinePlan ? 'Edit Planning — Kurva S' : 'Set Plan Awal — Kurva S'}</h3>
              <button type="button" onClick={() => setTimelineOpen(false)} className="text-slate-400 text-lg">✕</button>
            </div>
            <p className="text-xs text-slate-500">
              {hasBaselinePlan
                ? <>Edit ini menyimpan garis <b>Perubahan Planning</b>. <b>Planning Awal</b> tetap tidak berubah.</>
                : <>Simpan sebagai <b>Plan Awal (baseline)</b>. Garis Perubahan Planning baru muncul setelah Edit Planning.</>}
              {' '}<b>Actual</b> hanya dari Transaction Log yang sudah punya Tanggal Dana Keluar.
            </p>
            <div className="space-y-2">
              <div className="grid grid-cols-[1.2fr_1.4fr_1fr_auto] gap-2 text-[11px] font-bold text-slate-500 uppercase px-1">
                <span>Target Tanggal</span><span>Planned Budget</span><span>Progress %</span><span></span>
              </div>
              {msRows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1.2fr_1.4fr_1fr_auto] gap-2 items-center">
                  <input type="date" value={r.targetDate} onChange={(e) => { const n = [...msRows]; n[i] = { ...n[i], targetDate: e.target.value }; setMsRows(n); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  <input type="text" inputMode="numeric" placeholder="1.000.000" value={r.plannedBudget} onChange={(e) => { const n = [...msRows]; n[i] = { ...n[i], plannedBudget: formatBudgetInput(e.target.value) }; setMsRows(n); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  <input type="number" placeholder="0-100" value={r.plannedProgressPct} onChange={(e) => { const n = [...msRows]; n[i] = { ...n[i], plannedProgressPct: e.target.value }; setMsRows(n); }} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                  <button type="button" onClick={() => setMsRows(msRows.filter((_, x) => x !== i))} className="text-red-500 text-sm px-2">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setMsRows([...msRows, { targetDate: '', plannedBudget: '', plannedProgressPct: '' }])} className="text-xs font-bold text-[#00B89E]">+ Tambah Milestone</button>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" disabled={savingTimeline} onClick={() => void saveTimeline()} className="flex-1 bg-[#0F1B2D] text-white font-bold py-2 rounded-xl text-sm disabled:opacity-50">{savingTimeline ? 'Menyimpan…' : (hasBaselinePlan ? 'Simpan Perubahan Planning' : 'Simpan Plan Awal')}</button>
              <button type="button" onClick={() => setTimelineOpen(false)} className="flex-1 bg-white border py-2 rounded-xl text-sm">Batal</button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-lg">Pengaturan Proyek</h3>
              <button type="button" className="text-slate-500" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>
            {isGen ? (
              <>
                <p className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
                  Project GENERAL/UNCATEGORIZED dikelola sistem dan tidak dapat diubah (nama, deskripsi, budget,
                  penutupan).
                </p>
                <button
                  type="button"
                  className="w-full rounded-xl border border-slate-200 py-2 text-sm font-bold"
                  onClick={() => setSettingsOpen(false)}
                >
                  Tutup
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-bold text-slate-500">Nama</label>
                  <input
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Deskripsi</label>
                  <textarea
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm min-h-[60px]"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                </div>
                <div className="border-t pt-3 space-y-2">
                  <div className="font-bold text-sm">Budget</div>
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Total"
                    value={budgetTotal}
                    onChange={(e) => setBudgetTotal(e.target.value.replace(/\D/g, ''))}
                  />
                  {budgetTotalBelowSpent ? (
                    <p className="text-xs text-red-600">
                      Total budget tidak boleh lebih kecil dari realisasi ({formatRupiah(spentTotal)}).
                    </p>
                  ) : null}
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Material"
                    value={budgetMat}
                    onChange={(e) => setBudgetMat(e.target.value.replace(/\D/g, ''))}
                  />
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Jasa"
                    value={budgetJas}
                    onChange={(e) => setBudgetJas(e.target.value.replace(/\D/g, ''))}
                  />
                  <input
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Alasan penyesuaian"
                    value={budgetReason}
                    onChange={(e) => setBudgetReason(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-xl border py-2 text-sm font-bold"
                    onClick={async () => {
                      if (budgetTotalBelowSpent) return;
                      setSaving(true);
                      try {
                        await apiPatch(`/finance-projects/${id}/budget`, {
                          totalBudget: Number(budgetTotal) || 0,
                          materialBudget: budgetMat ? Number(budgetMat) : null,
                          jasaBudget: budgetJas ? Number(budgetJas) : null,
                          reason: budgetReason || undefined,
                        });
                        toast.success('Budget diperbarui');
                        await loadDetail();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Gagal');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving || budgetTotalBelowSpent}
                  >
                    Simpan budget
                  </button>
                </div>
                <div className="flex flex-col gap-2 border-t pt-3">
                  <button
                    type="button"
                    className="rounded-xl bg-slate-800 text-white py-2 text-sm font-bold"
                    onClick={async () => {
                      if (detail.status !== 'ACTIVE') {
                        toast.error('Hanya proyek aktif yang bisa ditutup');
                        return;
                      }
                      setSaving(true);
                      try {
                        await apiPatch(`/finance-projects/${id}`, { status: 'CLOSED' });
                        toast.success('Proyek ditutup');
                        await loadDetail();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Gagal');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving || detail.status !== 'ACTIVE'}
                  >
                    Tutup Project
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-red-200 text-red-700 py-2 text-sm font-bold"
                    onClick={async () => {
                      if (detail.status !== 'CLOSED') {
                        toast.error('Arsip hanya dari status CLOSED');
                        return;
                      }
                      setSaving(true);
                      try {
                        await apiPatch(`/finance-projects/${id}`, { status: 'ARCHIVED' });
                        toast.success('Proyek diarsipkan');
                        await loadDetail();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Gagal');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving || detail.status !== 'CLOSED'}
                  >
                    Arsipkan
                  </button>
                </div>
                <button
                  type="button"
                  className="w-full rounded-xl bg-[#0F1B2D] text-white py-2 text-sm font-bold"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await apiPatch(`/finance-projects/${id}`, {
                        name: editName.trim(),
                        description: editDesc.trim() || null,
                      });
                      toast.success('Disimpan');
                      await loadDetail();
                      setSettingsOpen(false);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Gagal');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  Simpan perubahan
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
