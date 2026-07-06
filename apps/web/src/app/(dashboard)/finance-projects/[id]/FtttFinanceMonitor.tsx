'use client';

import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { apiGet } from '../../../../lib/api';
import { formatRupiah } from '../../../../lib/format';

type Cat = 'PERIZINAN' | 'MATERIAL' | 'JASA' | 'LAIN_LAIN';
const CAT_LABEL: Record<Cat, string> = { PERIZINAN: 'Perizinan', MATERIAL: 'Material', JASA: 'Jasa', LAIN_LAIN: 'Lain-Lain' };

interface MonitoringData {
  linked: boolean;
  totalBudget?: number;
  totalSpent?: number;
  remaining?: number;
  ftttProject?: { id: string; name: string | null; currentPhase: string };
  byCategory?: { category: Cat; budget: number; spent: number; remaining: number }[];
  costCurve?: Record<string, number | string>[];
  progressCurve?: Record<string, number | string>[];
  // JLM: weekly breakdown for the Kurva S period filter (Weekly/Monthly)
  costCurveWeekly?: Record<string, number | string>[];
  progressCurveWeekly?: Record<string, number | string>[];
  transactions?: {
    id: string; category: Cat; aktivitas: string; uom: string | null;
    qty: string | number; price: string | number; total: string | number; remarks: string;
    createdAt: string; createdBy: { name: string } | null;
  }[];
}

// JLM: each card has its own Weekly/Monthly period filter (default Monthly).
// The filter only changes the display granularity — data comes precomputed
// from the API for both periods, over the same project date range.
function MiniCurve({ title, data, dataWeekly, keys, money }: { title: string; data: Record<string, number | string>[]; dataWeekly?: Record<string, number | string>[]; keys: [string, string, string][]; money?: boolean }) {
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const shown = period === 'weekly' && dataWeekly && dataWeekly.length > 0 ? dataWeekly : data;
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
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={shown}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={period === 'weekly' ? 9 : 11} tickLine={false} axisLine={false}
              interval="preserveStartEnd" angle={period === 'weekly' ? -30 : 0} height={period === 'weekly' ? 44 : 30} />
            <YAxis fontSize={11} tickLine={false} axisLine={false}
              tickFormatter={(v) => money ? `${Math.round(Number(v) / 1e6)}M` : `${v}%`} />
            <Tooltip formatter={(v: number) => money ? formatRupiah(v) : `${v}%`} />
            <Legend verticalAlign="top" height={30} />
            {keys.map(([k, label, color]) => (
              <Line key={k} type="monotone" dataKey={k} name={label} stroke={color} strokeWidth={2.5} dot={{ r: period === 'weekly' ? 2 : 3, fill: color }} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FtttFinanceMonitor({ financeProjectId, tab, reloadKey = 0 }: { financeProjectId: string; tab: 'overview' | 'transactions' | 'scurve'; reloadKey?: number }) {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiGet<MonitoringData>(`/fttt-projects/by-finance/${financeProjectId}/monitoring`)
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setData({ linked: false }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [financeProjectId, reloadKey]);

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
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-3 py-2">Timestamp</th><th className="px-3 py-2">Kategori</th><th className="px-3 py-2">Aktivitas</th>
              <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Bobot%</th><th className="px-3 py-2">Remarks</th><th className="px-3 py-2">Oleh</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Belum ada transaksi.</td></tr>
            ) : txns.map((t) => {
              const total = num(t.total);
              const bobot = rab > 0 ? (total / rab) * 100 : 0;
              return (
                <tr key={t.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{new Date(t.createdAt).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-3 py-2">{CAT_LABEL[t.category]}</td>
                  <td className="px-3 py-2">{t.aktivitas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(t.qty)} {t.uom ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(num(t.price))}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{formatRupiah(total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{bobot.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{t.remarks}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{t.createdBy?.name ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // tab === 'scurve'
  return (
    <div className="space-y-6">
      <MiniCurve title="Kurva S Biaya (Cost — Planning vs Actual)" data={data.costCurve ?? []} dataWeekly={data.costCurveWeekly}
        keys={[['plannedCost', 'Planned', '#94A3B8'], ['actualCost', 'Actual', '#00B89E']]} money />
      <MiniCurve title="Kurva S Progress (Schedule — Planning vs Actual)" data={data.progressCurve ?? []} dataWeekly={data.progressCurveWeekly}
        keys={[['plannedProgress', 'Planned %', '#94A3B8'], ['actualProgress', 'Actual %', '#0969DA']]} />
    </div>
  );
}
