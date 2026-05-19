'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { apiGet } from '../../../../lib/api';
import { formatRupiah, formatDateID } from '../../../../lib/format';
import type { ForecastDto } from '../../../../types/api.types';
import type { BudgetLedger } from '../../../../types/api.types';
import { num } from '../_lib/num';

type Props = { projectId: string; ledgerSample: BudgetLedger[]; totalBudget: number };

export function ForecastPanel({ projectId, ledgerSample, totalBudget }: Props) {
  const [forecast, setForecast] = useState<ForecastDto | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let c = false;
    void (async () => {
      try {
        const f = await apiGet<ForecastDto>(`/finance-projects/${projectId}/forecast`);
        if (!c) setForecast(f);
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : 'Gagal memuat forecast');
      }
    })();
    return () => {
      c = true;
    };
  }, [projectId]);

  const chartData = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    const deducts = ledgerSample
      .filter(
        (e) =>
          (e.entryType === 'DEDUCT_MATERIAL' || e.entryType === 'DEDUCT_JASA') &&
          new Date(e.createdAt) >= start,
      )
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let mCum = 0;
    let jCum = 0;
    const byDay: Record<string, { d: string; material: number; jasa: number }> = {};
    for (const e of deducts) {
      const d = new Date(e.createdAt).toISOString().slice(0, 10);
      if (!byDay[d]) byDay[d] = { d, material: mCum, jasa: jCum };
      if (e.entryType === 'DEDUCT_MATERIAL') mCum += num(e.amount);
      else jCum += num(e.amount);
      byDay[d] = { d, material: mCum, jasa: jCum };
    }
    return Object.values(byDay).sort((a, b) => a.d.localeCompare(b.d));
  }, [ledgerSample]);

  const th80 = totalBudget * 0.8;
  const th100 = totalBudget;

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!forecast) return <div className="text-sm text-slate-500">Memuat forecast…</div>;

  return (
    <div className="space-y-6">
      {!forecast.metadata.isReliable ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm p-4">
          Data belum cukup untuk estimasi reliable. Minimal 7 hari operasi dan 5 transaksi. Angka di bawah
          adalah perhitungan kasar.
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-100 p-4 bg-white">
          <div className="text-xs font-bold text-slate-500 uppercase">Burn rate / hari</div>
          <div className="mt-2 text-sm">
            Material: {formatRupiah(forecast.burnRate.material)}
            <br />
            Jasa: {formatRupiah(forecast.burnRate.jasa)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 p-4 bg-white">
          <div className="text-xs font-bold text-slate-500 uppercase">Estimasi habis</div>
          <div className="mt-2 text-sm">
            Material:{' '}
            {forecast.burnRate.material <= 0
              ? 'Tak terbatas'
              : forecast.estimatedDepletionDate.material
                ? formatDateID(forecast.estimatedDepletionDate.material)
                : '—'}
            <br />
            Jasa:{' '}
            {forecast.burnRate.jasa <= 0
              ? 'Tak terbatas'
              : forecast.estimatedDepletionDate.jasa
                ? formatDateID(forecast.estimatedDepletionDate.jasa)
                : '—'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-100 p-4 bg-white">
          <div className="text-xs font-bold text-slate-500 uppercase">Proyeksi akhir</div>
          <div className="mt-2 font-black text-slate-900">
            {formatRupiah(forecast.projectedFinalRealization.total)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Window:{' '}
            {forecast.projectionWindow.type === 'endDate'
              ? `sampai ${formatDateID(forecast.projectionWindow.endDate)} (${Math.round(forecast.projectionWindow.daysProjected)} hari)`
              : `lookahead ${forecast.projectionWindow.daysProjected} hari`}
          </div>
        </div>
      </div>

      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="d" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v: number) => formatRupiah(v)}
              labelFormatter={(l) => l}
            />
            <Legend />
            <ReferenceLine y={th80} stroke="#F97316" strokeDasharray="4 4" label="80%" />
            <ReferenceLine y={th100} stroke="#EF4444" strokeDasharray="4 4" label="100%" />
            <Line type="monotone" dataKey="material" name="Material kumulatif" stroke="#10B981" dot={false} />
            <Line type="monotone" dataKey="jasa" name="Jasa kumulatif" stroke="#6366F1" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-500">{forecast.metadata.disclaimer}</p>
    </div>
  );
}
