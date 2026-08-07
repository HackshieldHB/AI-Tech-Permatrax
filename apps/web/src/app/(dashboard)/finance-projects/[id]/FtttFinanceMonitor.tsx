'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { apiGet, fixFileUrl } from '../../../../lib/api';
import { apiFetch } from '../../../../lib/auth';
import { formatRupiah } from '../../../../lib/format';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../store/authStore';

type Cat = 'PERIZINAN' | 'MATERIAL' | 'JASA' | 'LAIN_LAIN';
const CAT_LABEL: Record<Cat, string> = { PERIZINAN: 'Perizinan', MATERIAL: 'Material', JASA: 'Jasa', LAIN_LAIN: 'Lain-Lain' };

interface MonitoringData {
  linked: boolean;
  totalBudget?: number;
  totalSpent?: number;
  remaining?: number;
  ftttProject?: { id: string; name: string | null; currentPhase: string };
  byCategory?: { category: Cat; budget: number; spent: number; remaining: number }[];
  costCurve?: Record<string, number | string | null>[];
  progressCurve?: Record<string, number | string | null>[];
  costCurveWeekly?: Record<string, number | string | null>[];
  progressCurveWeekly?: Record<string, number | string | null>[];
  hasRevision?: boolean;
  transactions?: {
    id: string; category: Cat; aktivitas: string; uom: string | null;
    qty: string | number; price: string | number; total: string | number; remarks: string;
    createdAt: string; disbursedAt?: string | null;
    hasTransferProof?: boolean;
    transferProofUrl?: string | null;
    transferProofs?: { id: string; fileUrl: string; originalFileName?: string | null }[];
    createdBy: { name: string } | null;
    disbursedBy?: { name: string } | null;
  }[];
}

function MiniCurve({ title, data, dataWeekly, keys, money }: {
  title: string;
  data: Record<string, number | string | null>[];
  dataWeekly?: Record<string, number | string | null>[];
  keys: [string, string, string][];
  money?: boolean;
}) {
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('weekly');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const shown = period === 'weekly' && dataWeekly && dataWeekly.length > 0 ? dataWeekly : data;
  const pxPerTick = period === 'weekly' ? 88 : 96;
  const chartHeight = 288;
  const contentW = Math.max(1, shown.length * pxPerTick + 72);
  const chartWidth = Math.max(containerW || contentW, contentW);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => setContainerW(Math.floor(el.clientWidth));
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h4 className="font-bold text-slate-800 text-sm">{title}</h4>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as 'monthly' | 'weekly')}
          className="text-xs font-bold rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700"
          aria-label="Filter periode"
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div
        ref={scrollRef}
        className="w-full overflow-x-auto overflow-y-hidden"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div style={{ width: chartWidth, height: chartHeight }}>
          <ComposedChart width={chartWidth} height={chartHeight} data={shown}
            margin={{ left: 8, right: 24, top: 8, bottom: period === 'weekly' ? 16 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={period === 'weekly' ? 9 : 11} tickLine={false} axisLine={false}
              interval={0} angle={period === 'weekly' ? -35 : 0} textAnchor={period === 'weekly' ? 'end' : 'middle'}
              height={period === 'weekly' ? 56 : 30} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} width={48}
              tickFormatter={(v) => money ? `${Math.round(Number(v) / 1e6)}M` : `${v}%`} />
            <Tooltip formatter={(v: number) => money ? formatRupiah(v) : `${v}%`} />
            <Legend verticalAlign="top" height={36} />
            {keys.map(([k, label, color]) => (
              <Line key={k} type="monotone" dataKey={k} name={label} stroke={color} strokeWidth={2.5}
                connectNulls={false} dot={{ r: period === 'weekly' ? 2 : 3, fill: color }} />
            ))}
          </ComposedChart>
        </div>
      </div>
    </div>
  );
}

export function FtttFinanceMonitor({ financeProjectId, tab, reloadKey = 0 }: { financeProjectId: string; tab: 'overview' | 'transactions' | 'scurve'; reloadKey?: number }) {
  const { user } = useAuthStore();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [disburseId, setDisburseId] = useState<string | null>(null);
  const [disburseDate, setDisburseDate] = useState('');
  const [disburseFiles, setDisburseFiles] = useState<File[]>([]);
  const [disbursing, setDisbursing] = useState(false);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<MonitoringData>(`/fttt-projects/by-finance/${financeProjectId}/monitoring`)
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setData({ linked: false }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [financeProjectId, reloadKey, localReload]);

  const handleDisburse = async (txId: string) => {
    if (!disburseDate) { toast.error('Isi Tanggal Dana Keluar'); return; }
    if (disburseFiles.length < 1) { toast.error('Upload Bukti Transfer wajib minimal 1 file'); return; }
    const today = new Date();
    const max = new Date(today); max.setDate(max.getDate() + 14);
    const maxStr = max.toISOString().slice(0, 10);
    if (disburseDate > maxStr) { toast.error('Tanggal Dana Keluar maksimal 14 hari dari hari ini'); return; }
    setDisbursing(true);
    try {
      const fd = new FormData();
      fd.append('disbursedAt', disburseDate);
      disburseFiles.forEach((f) => fd.append('files', f));
      const res = await apiFetch(`/fttt-projects/transactions/${txId}/disburse`, { method: 'PUT', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dana Keluar tersimpan — budget diperbarui secara real-time');
      setDisburseId(null); setDisburseDate(''); setDisburseFiles([]);
      setLocalReload((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setDisbursing(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Memuat data FTTT…</div>;
  if (!data || !data.linked) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Belum ada Project FTTT yang terhubung dengan Finance Project ini. Hubungkan saat membuat Project di menu FTTT Projects.
      </div>
    );
  }

  const num = (v: unknown) => Number(v) || 0;
  const rab = num(data.totalBudget);

  if (tab === 'overview') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-xs font-bold text-slate-500 uppercase">Total Budget (RAB)</p>
            <p className="text-xl font-black text-slate-900">{formatRupiah(rab)}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-xs font-bold text-slate-500 uppercase">Realisasi</p>
            <p className="text-xl font-black text-slate-900">{formatRupiah(num(data.totalSpent))}</p>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-xs font-bold text-slate-500 uppercase">Sisa</p>
            <p className={`text-xl font-black ${num(data.remaining) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatRupiah(num(data.remaining))}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <h4 className="font-bold text-slate-800 text-sm mb-3">Budget per Kategori</h4>
          <div className="space-y-3">
            {(data.byCategory ?? []).map((b) => {
              const pct = b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0;
              return (
                <div key={b.category}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{CAT_LABEL[b.category]}</span>
                    <span className="tabular-nums">{formatRupiah(b.spent)} <span className="text-slate-400">/ {formatRupiah(b.budget)}</span></span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded mt-1">
                    <div className={`h-full rounded ${b.remaining < 0 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'transactions') {
    const txns = data.transactions ?? [];
    return (
      <div className="rounded-2xl border border-slate-100 bg-white overflow-x-auto">
        <p className="px-3 pt-3 text-xs text-slate-500">
          Budget berkurang segera setelah Tanggal Dana Keluar + Bukti Transfer disubmit.
        </p>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-3 py-2">Timestamp</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Kategori</th><th className="px-3 py-2">Aktivitas</th>
              <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Bobot%</th><th className="px-3 py-2">Remarks</th><th className="px-3 py-2">Oleh</th><th className="px-3 py-2">Dana Keluar</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">Belum ada transaksi.</td></tr>
            ) : txns.map((t) => {
              const total = num(t.total);
              const bobot = rab > 0 ? (total / rab) * 100 : 0;
              const hasDate = !!t.disbursedAt;
              const realized = hasDate;
              return (
                <tr key={t.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(t.createdAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${realized ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {realized ? 'Dana Keluar' : 'Menunggu'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{CAT_LABEL[t.category]}</td>
                  <td className="px-3 py-2">{t.aktivitas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(t.qty)} {t.uom ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(num(t.price))}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{formatRupiah(total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{bobot.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{t.remarks}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{t.createdBy?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {hasDate ? (
                      <span className="whitespace-nowrap text-emerald-700">
                        {new Date(t.disbursedAt!).toLocaleDateString('id-ID')}
                        {(t.transferProofs?.length
                          ? t.transferProofs
                          : t.transferProofUrl
                            ? [{ id: 'legacy', fileUrl: t.transferProofUrl, originalFileName: 'Bukti' }]
                            : []
                        ).map((p, idx) => (
                          <span key={p.id}>
                            {' · '}
                            <a href={fixFileUrl(p.fileUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                              {p.originalFileName || `Bukti ${idx + 1}`}
                            </a>
                          </span>
                        ))}
                      </span>
                    ) : disburseId === t.id ? (
                      <div className="flex flex-col gap-1 min-w-[180px]">
                        <input type="date" value={disburseDate}
                          max={(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })()}
                          onChange={(e) => {
                            const v = e.target.value;
                            const max = new Date(); max.setDate(max.getDate() + 14);
                            const maxStr = max.toISOString().slice(0, 10);
                            if (v && v > maxStr) { toast.error('Tanggal Dana Keluar maksimal 14 hari dari hari ini'); return; }
                            setDisburseDate(v);
                          }}
                          className="text-xs border rounded px-1 py-0.5" />
                        <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                          onChange={(e) => {
                            const picked = Array.from(e.target.files ?? []);
                            if (!picked.length) return;
                            setDisburseFiles((prev) => {
                              const names = new Set(prev.map((f) => `${f.name}:${f.size}`));
                              const next = [...prev];
                              for (const f of picked) {
                                const key = `${f.name}:${f.size}`;
                                if (!names.has(key)) next.push(f);
                              }
                              return next;
                            });
                            e.target.value = '';
                          }}
                          className="text-xs" />
                        {disburseFiles.map((f, idx) => (
                          <div key={`${f.name}-${idx}`} className="flex items-center gap-2 text-[10px] text-slate-600">
                            <span>📎 {f.name}</span>
                            <button type="button" className="text-red-600" onClick={() => setDisburseFiles((prev) => prev.filter((_, i) => i !== idx))}>Hapus</button>
                          </div>
                        ))}
                        <button type="button" disabled={disbursing} onClick={() => void handleDisburse(t.id)}
                          className="text-xs font-bold bg-emerald-600 text-white rounded px-2 py-0.5">
                          {disbursing ? '…' : 'Submit'}
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setDisburseId(t.id); setDisburseDate(new Date().toISOString().slice(0, 10)); setDisburseFiles([]); }}
                        className="text-xs font-bold text-blue-600 hover:underline">
                        + Tanggal
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const showRevision = !!data.hasRevision;
  return (
    <div className="space-y-6">
      <MiniCurve title="Kurva S Biaya (Cost)" data={data.costCurve ?? []} dataWeekly={data.costCurveWeekly}
        keys={showRevision
          ? [['baselineCost', 'Planning Awal', '#94A3B8'], ['plannedCost', 'Perubahan Planning', '#F59E0B'], ['actualCost', 'Actual', '#00B89E']]
          : [['baselineCost', 'Planning Awal', '#94A3B8'], ['actualCost', 'Actual', '#00B89E']]} money />
      <MiniCurve title="Kurva S Progress (Schedule)" data={data.progressCurve ?? []} dataWeekly={data.progressCurveWeekly}
        keys={showRevision
          ? [['baselineProgress', 'Planning Awal %', '#94A3B8'], ['plannedProgress', 'Perubahan Planning %', '#F59E0B'], ['actualProgress', 'Actual %', '#0969DA']]
          : [['baselineProgress', 'Planning Awal %', '#94A3B8'], ['actualProgress', 'Actual %', '#0969DA']]} />
    </div>
  );
}
