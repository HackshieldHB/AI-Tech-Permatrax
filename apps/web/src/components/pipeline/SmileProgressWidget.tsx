'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/auth';
import { toast } from 'sonner';
import { 
  Plus, 
  History, 
  Loader2, 
  TrendingUp, 
  CheckCircle2, 
  ArrowUpRight
} from 'lucide-react';

interface SmileProgressWidgetProps {
  clusterId: string;
  targetPct: number;
  onUpdate: () => void;
}

export default function SmileProgressWidget({ 
  clusterId, 
  targetPct, 
  onUpdate 
}: SmileProgressWidgetProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [newPct, setNewPct] = useState<string>('');

  const fetchHistory = async () => {
    try {
      const res = await apiFetch(`/pipeline-engine/clusters/${clusterId}/smile-progress`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [clusterId]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const pct = parseFloat(newPct);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Progress harus antara 0-100');
      return;
    }

    setRecording(true);
    try {
      const res = await apiFetch(`/pipeline-engine/clusters/${clusterId}/smile-progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progressPct: pct }),
      });

      if (res.ok) {
        toast.success('Progress berhasil dicatat');
        setNewPct('');
        fetchHistory();
        onUpdate();
      } else {
        toast.error('Gagal mencatat progress');
      }
    } catch (error) {
      toast.error('Kesalahan sistem');
    } finally {
      setRecording(false);
    }
  };

  const latest = history[0]?.progressPct || 0;
  const isComplete = latest >= targetPct;

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 bg-slate-50 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-bold">SMILE Progress Monitoring</h4>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${isComplete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          Target: {targetPct}%
        </span>
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Progress Visualization */}
        <div className="flex items-center gap-6">
          <div className="relative w-24 h-24 shrink-0">
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle className="text-slate-200 stroke-current" strokeWidth="8" fill="transparent" r="40" cx="50" cy="50" />
              <circle 
                className={`${latest >= targetPct ? 'text-green-500' : latest >= 50 ? 'text-amber-500' : 'text-rose-500'} stroke-current`}
                strokeWidth="8" 
                strokeDasharray={`${latest * 2.51}, 251.2`} 
                strokeLinecap="round" 
                fill="transparent" 
                r="40" cx="50" cy="50" 
                style={{ transition: 'all 1s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-black">{latest}%</span>
              <span className="text-[10px] opacity-40 uppercase font-bold tracking-tighter">Aktual</span>
            </div>
          </div>
          
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="opacity-60">Status Target</span>
              {isComplete ? (
                <span className="text-green-600 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Tercapai
                </span>
              ) : (
                <span className="text-amber-600 font-bold">Belum Tercapai</span>
              )}
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ${isComplete ? 'bg-green-500' : 'bg-primary'}`} 
                style={{ width: `${Math.min(100, (latest / targetPct) * 100)}%` }} 
              />
            </div>
            <p className="text-[11px] text-slate-500 italic">
              {isComplete 
                ? 'Persyaratan SMILE progress telah terpenuhi.' 
                : `Butuh ${targetPct - latest}% lagi untuk mencapai target.`}
            </p>
          </div>
        </div>

        {/* Action Form */}
        <form onSubmit={handleRecord} className="flex flex-col justify-center gap-3 border-t md:border-t-0 md:border-l md:pl-6 pt-4 md:pt-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input 
                type="number" 
                placeholder="Update % progress..."
                className="w-full pl-4 pr-10 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                value={newPct}
                onChange={(e) => setNewPct(e.target.value)}
                min="0"
                max="100"
                step="0.01"
              />
              <span className="absolute right-4 top-2 text-sm opacity-30 font-bold">%</span>
            </div>
            <button 
              type="submit"
              disabled={recording || !newPct}
              className="p-2 bg-primary text-white rounded-lg shadow-md shadow-primary/20 disabled:opacity-50 transition-all hover:scale-105 active:scale-95"
            >
              {recording ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUpRight className="w-5 h-5" />}
            </button>
          </div>
          
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold opacity-30 tracking-widest">
            <History className="w-3 h-3" />
            Terakhir dicatat: {history[0] ? new Date(history[0].recordedAt).toLocaleString('id-ID') : '—'}
          </div>
        </form>
      </div>
    </div>
  );
}
