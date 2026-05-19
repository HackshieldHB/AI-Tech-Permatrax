'use client';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, ArrowRight, Activity, MapPin } from 'lucide-react';
import Link from 'next/link';
import { API_HOST } from '../../../lib/api'; // FIX: centralized API URL (smart fallback)

export default function SurveyorInbox() {
  const [boxes, setBoxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_HOST}/api/documents/inbox/rejected`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }, // FIX: bypass ngrok-free interstitial
      })
       .then(res => res.json())
       .then(data => {
          setBoxes(data);
          setLoading(false);
       })
       .catch(err => {
          console.error(err);
          setLoading(false);
       });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
       <div className="bg-red-600 px-6 py-12 pt-16 rounded-b-[40px] shadow-lg relative overflow-hidden flex flex-col">
          <div className="absolute top-0 right-0 w-64 h-64 bg-red-500 blur-[80px] rounded-full pointer-events-none" />
          <h1 className="text-white text-3xl font-black tracking-tight flex items-center gap-2 relative z-10">
             <AlertTriangle className="w-8 h-8 text-white" /> Action Required
          </h1>
          <p className="text-red-100 font-bold mt-2 relative z-10 text-sm">
             These surveys were rejected and require immediate corrections before they can proceed.
          </p>
       </div>

       <div className="px-6 py-8 flex flex-col gap-4">
          {loading ? (
             <div className="flex justify-center items-center py-20 flex-col gap-2">
                <Activity className="w-8 h-8 text-slate-300 animate-spin" />
                <span className="text-xs font-black text-slate-400 tracking-widest uppercase">Fetching Inbox...</span>
             </div>
          ) : boxes.length === 0 ? (
             <div className="flex flex-col justify-center items-center py-32 opacity-50">
                <ShieldCheck className="w-16 h-16 text-slate-300 mb-2" />
                <span className="font-black text-slate-500">Inbox Clear</span>
             </div>
          ) : (
             boxes.map((box) => {
                const latestLog = box.approvalLogs && box.approvalLogs[0];
                return (
                   <div key={box.id} className="bg-white border-2 border-red-100 rounded-2xl p-5 shadow-xl shadow-red-900/5 relative overflow-hidden">
                      <div className="flex justify-between items-start mb-3">
                         <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Rejected Validations</span>
                            <h3 className="text-slate-800 font-black text-lg tracking-tight">{box.cluster?.code || box.clusterId}</h3>
                         </div>
                         <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[9px] uppercase tracking-widest font-black rounded-lg border border-slate-200">
                            {box.documentType}
                         </span>
                      </div>
                      
                      <div className="mb-4 bg-red-50 rounded-xl p-3 border border-red-100 flex flex-col gap-1.5 shadow-inner">
                         <span className="text-[10px] font-black uppercase text-red-400 tracking-widest">Reason from {latestLog?.actionBy || 'Admin'}</span>
                         <p className="text-sm font-bold text-red-700 leading-snug">
                            &quot;{latestLog?.notes || 'General topography failure'}&quot;
                         </p>
                      </div>

                      <Link href={`/survey/${box.clusterId}`} className="w-full bg-red-600 hover:bg-red-700 text-white font-black py-4 rounded-xl shadow-lg shadow-red-600/30 text-xs tracking-wider flex items-center justify-center gap-2 transition-all">
                        <MapPin className="w-4 h-4" /> Edit Survey Geometry <ArrowRight className="w-4 h-4" />
                      </Link>
                   </div>
                );
             })
          )}
       </div>
    </div>
  );
}
