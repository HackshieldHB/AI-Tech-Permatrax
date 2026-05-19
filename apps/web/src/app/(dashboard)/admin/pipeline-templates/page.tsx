'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/auth';
import { 
  Settings, 
  Plus, 
  Layers, 
  ExternalLink, 
  Activity, 
  CheckCircle2, 
  XCircle,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function PipelineTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await apiFetch('/pipeline-engine/templates');
        if (res.ok) {
          const data = await res.json();
          setTemplates(data);
        }
      } catch (error) {
        toast.error('Gagal memuat template');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary" />
            Pipeline Templates
          </h1>
          <p className="text-slate-500 text-sm">Kelola alur kerja dinamis berdasarkan ISP dan Teknologi</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all">
          <Plus className="w-5 h-5" />
          Template Baru
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((tpl) => (
          <div key={tpl.id} className="bg-white border rounded-xl p-5 hover:shadow-xl transition-all group relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1.5 h-full ${tpl.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
            
            <div className="flex justify-between items-start mb-4">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <Layers className="w-5 h-5" />
              </div>
              <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${tpl.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {tpl.isActive ? 'Aktif' : 'Non-Aktif'}
              </span>
            </div>

            <h3 className="font-black text-lg mb-1 group-hover:text-primary transition-colors">{tpl.name}</h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-tighter mb-4">
              {tpl.fiberType} • {tpl.ispCustomer.name}
            </p>

            <div className="flex items-center gap-6 border-t pt-4">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold opacity-40">Tahapan</span>
                <span className="font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-slate-500" />
                  {tpl._count.stages} Stages
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold opacity-40">Versi</span>
                <span className="font-bold">v{tpl.version}</span>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button className="flex-1 py-2 bg-slate-100 rounded-lg text-sm font-bold hover:bg-slate-200 transition-colors">
                Edit Template
              </button>
              <button className="p-2 border rounded-lg hover:bg-slate-50 transition-colors">
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="flex flex-col items-center justify-center p-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <Layers className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-400">Belum ada template terdaftar</h3>
          <p className="text-sm text-slate-400">Silakan buat template baru atau jalankan seed script.</p>
        </div>
      )}
    </div>
  );
}
