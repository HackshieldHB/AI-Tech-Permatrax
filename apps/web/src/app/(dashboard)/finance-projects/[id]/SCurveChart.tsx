'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
} from 'recharts';
import { formatRupiah } from '../../../../lib/format';
import { apiGet, apiPost } from '../../../../lib/api';
import { toast } from 'sonner';

interface PlanningItem {
  month: number;
  year: number;
  plannedAmount: number | string;
}

interface ActualItem {
  month: number;
  year: number;
  actualAmount: number;
}

interface SCurveChartProps {
  projectId: string;
  manage?: boolean;
}

export function SCurveChart({ projectId, manage = false }: SCurveChartProps) {
  const [data, setData] = useState<{ planning: PlanningItem[]; actual: ActualItem[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [planForm, setPlanForm] = useState<PlanningItem[]>([]);

  const loadData = async () => {
    try {
      const res = await apiGet<{ planning: PlanningItem[]; actual: ActualItem[] }>(
        `/finance-projects/${projectId}/s-curve-data`
      );
      setData(res);
      setPlanForm(res.planning.map(p => ({ ...p, plannedAmount: Number(p.plannedAmount) })));
    } catch {
      toast.error('Gagal memuat data S-Curve');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [projectId]);

  const chartData = useMemo(() => {
    if (!data) return [];

    // Find date range
    const allDates = [
      ...data.planning.map((p) => ({ m: p.month, y: p.year })),
      ...data.actual.map((a) => ({ m: a.month, y: a.year })),
    ];
    if (allDates.length === 0) return [];

    const sorted = allDates.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.m - b.m));
    const start = sorted[0];
    const end = sorted[sorted.length - 1];

    const result = [];
    let currY = start.y;
    let currM = start.m;
    let cumPlan = 0;
    let cumActual = 0;

    const actualMap = new Map(data.actual.map((a) => [`${a.year}-${a.month}`, a.actualAmount]));
    const planMap = new Map(data.planning.map((p) => [`${p.year}-${p.month}`, Number(p.plannedAmount)]));

    while (currY < end.y || (currY === end.y && currM <= end.m)) {
      const key = `${currY}-${currM}`;
      const p = planMap.get(key) || 0;
      const a = actualMap.get(key) || 0;

      cumPlan += p;
      cumActual += a;

      result.push({
        name: `${currM}/${currY}`,
        planned: p,
        actual: a,
        cumulativePlanned: cumPlan,
        cumulativeActual: cumActual,
        month: currM,
        year: currY,
      });

      currM++;
      if (currM > 12) {
        currM = 1;
        currY++;
      }
    }

    return result;
  }, [data]);

  const savePlanning = async () => {
    try {
      await apiPost(`/finance-projects/${projectId}/planning`, { plannings: planForm });
      toast.success('Perencanaan disimpan');
      setEditing(false);
      await loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan');
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Memuat S-Curve…</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-slate-800">Kurva S (Planning vs Actual)</h3>
        {manage && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100"
          >
            Edit Planning
          </button>
        )}
      </div>

      {editing ? (
        <div className="bg-slate-50 p-4 rounded-2xl space-y-4">
          <div className="max-h-64 overflow-y-auto space-y-2">
            {planForm.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="w-20 font-medium">{p.month}/{p.year}</span>
                <input
                  type="number"
                  className="rounded-lg border px-2 py-1 w-full"
                  value={p.plannedAmount}
                  onChange={(e) => {
                    const next = [...planForm];
                    next[idx] = { ...next[idx], plannedAmount: Number(e.target.value) || 0 };
                    setPlanForm(next);
                  }}
                />
                <button
                   onClick={() => setPlanForm(prev => prev.filter((_, i) => i !== idx))}
                   className="text-red-500"
                >✕</button>
              </div>
            ))}
            <button
               onClick={() => {
                 const last = planForm[planForm.length - 1] || { month: new Date().getMonth(), year: new Date().getFullYear() };
                 let nextM = last.month + 1;
                 let nextY = last.year;
                 if (nextM > 12) { nextM = 1; nextY++; }
                 setPlanForm([...planForm, { month: nextM, year: nextY, plannedAmount: 0 }]);
               }}
               className="text-xs font-bold text-[#00D4B4]"
            >+ Tambah Bulan</button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void savePlanning()}
              className="flex-1 bg-[#00D4B4] text-[#0F1B2D] font-bold py-2 rounded-xl text-sm"
            >
              Simpan
            </button>
            <button
              onClick={() => { setEditing(false); setPlanForm(data?.planning.map(p => ({ ...p, plannedAmount: Number(p.plannedAmount) })) || []); }}
              className="flex-1 bg-white border py-2 rounded-xl text-sm"
            >
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div className="h-96 w-full bg-white rounded-2xl border border-slate-100 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000000}M`} />
              <Tooltip
                formatter={(val: number) => formatRupiah(val)}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar dataKey="actual" name="Actual Bulanan" fill="#6366F1" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="planned" name="Planned Bulanan" fill="#94A3B8" radius={[4, 4, 0, 0]} barSize={20} opacity={0.3} />
              <Area
                type="monotone"
                dataKey="cumulativePlanned"
                name="Cum. Planned"
                stroke="#94A3B8"
                fill="url(#colorPlan)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cumulativeActual"
                name="Cum. Actual"
                stroke="#00D4B4"
                strokeWidth={3}
                dot={{ r: 4, fill: '#00D4B4', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
              <defs>
                <linearGradient id="colorPlan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#94A3B8" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#94A3B8" stopOpacity={0}/>
                </linearGradient>
              </defs>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
