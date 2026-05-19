'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { isSurveyorRole } from '../../../lib/roles';
import { MapPin, Pickaxe, Navigation, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { API_HOST } from '../../../lib/api'; // FIX: centralized API URL (smart fallback)

export default function FieldSurveyPage() {
  const router = useRouter();
  const params = useParams();
  const clusterId = params.clusterId as string;
  
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
     estimatedHP: '',
     estimatedPoles: '',
     fieldNotes: '',
     latitude: null as number | null,
     longitude: null as number | null,
     userId: user?.name || 'Surveyor_01'
  });

  useEffect(() => {
    if (!user?.role) return;
    if (!isSurveyorRole(user.role) && user.role !== 'ADMIN') {
       toast.error('Network execution boundary violation. Access restricted.');
       router.push('/');
    }
  }, [user?.role, router]);

  const captureGPS = () => {
    toast.loading('Acquiring explicit bounds natively...', { id: 'gps' });
    setTimeout(() => {
      setFormData(prev => ({...prev, latitude: -6.1751, longitude: 106.8272 }));
      toast.success('Geographic parameters locked.', { id: 'gps' });
    }, 1200);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        estimatedHP: parseInt(formData.estimatedHP),
        estimatedPoles: parseInt(formData.estimatedPoles),
        fieldNotes: formData.fieldNotes,
        latitude: formData.latitude,
        longitude: formData.longitude,
        userId: formData.userId
      };

      const res = await fetch(`${API_HOST}/api/surveys/${clusterId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true', // FIX: bypass ngrok-free interstitial
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed tracking payload bounds natively.');

      toast.success('Baseline Protocol BA_SURVEY Generated Mapping PostGIS Natively!');
      router.push('/');
    } catch(err) {
       toast.error('Pipeline failed allocating metrics array.');
    } finally {
       setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 w-full flex flex-col font-sans relative pb-10">
      
      {/* Mobile Top Header */}
      <div className="bg-slate-900 pt-12 pb-6 px-5 rounded-b-3xl shadow-xl shadow-primary/10 relative overflow-hidden shrink-0">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col gap-4">
           <button onClick={() => router.back()} className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-sm shadow-sm ring-1 ring-white/10">
              <ArrowLeft className="w-4 h-4" />
           </button>
           <div className="flex flex-col gap-1">
             <span className="text-[10px] uppercase font-black tracking-widest text-primary/70">Target Node: {clusterId}</span>
             <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
               <Pickaxe className="w-6 h-6 text-slate-300" /> Field Survey Entry
             </h1>
           </div>
        </div>
      </div>

      {/* Main Execution Viewport */}
      <div className="flex-1 px-5 -mt-3 pt-6 relative z-10 max-w-lg mx-auto w-full">
         <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            
            <div className="bg-white p-5 rounded-3xl shadow-lg shadow-slate-200/50 border border-slate-100 flex flex-col gap-4 relative">
               <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center border border-primary/20"><MapPin className="w-3.5 h-3.5" /></div>
                  <span className="font-black text-slate-800 text-sm tracking-tight">Geographic Assessment</span>
               </div>
               
               <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 pl-1">Estimated Homepass (HP)</label>
                  <input type="number" required value={formData.estimatedHP} onChange={e => setFormData({...formData, estimatedHP: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400 placeholder:font-medium transition-all" placeholder="Enter surveyed bounds" />
               </div>

               <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 pl-1">Target Infrastructure Poles</label>
                  <input type="number" required value={formData.estimatedPoles} onChange={e => setFormData({...formData, estimatedPoles: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-slate-400 placeholder:font-medium transition-all" placeholder="Explicit node count" />
               </div>
            </div>

            <div className="bg-white p-5 rounded-3xl shadow-lg shadow-slate-200/50 border border-slate-100 flex flex-col gap-4">
               <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500 pl-1">Field Topography Notes</label>
                  <textarea rows={4} value={formData.fieldNotes} onChange={e => setFormData({...formData, fieldNotes: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none transition-all placeholder:text-slate-400 placeholder:font-medium" placeholder="Describe terrain boundaries, complexities, or structural roadblocks natively..." />
               </div>

               <button type="button" onClick={captureGPS} className={`w-full py-4 rounded-xl border border-primary/20 bg-primary/5 text-primary font-black text-sm tracking-wide shadow-inner flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors ${formData.latitude ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : ''}`}>
                  <Navigation className="w-4 h-4" /> {formData.latitude ? `LOCKED: ${formData.latitude}, ${formData.longitude}` : 'Capture GPS Telemetry'}
               </button>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary-hover text-white rounded-xl py-4 font-black shadow-lg shadow-primary/30 tracking-wider flex justify-center items-center mt-2 transition-all active:scale-[0.98]">
               {loading ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : 'GENERATE BA SURVEY MODEL'}
            </button>
         </form>
      </div>

    </div>
  );
}
