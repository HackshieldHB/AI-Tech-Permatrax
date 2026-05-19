'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/auth';
import { useAuthStore } from '../../store/authStore';
import { toast } from 'sonner';
import { 
  CheckCircle2, 
  Lock, 
  PlayCircle, 
  AlertCircle, 
  ChevronRight, 
  ChevronDown,
  UploadCloud,
  FileText,
  Loader2
} from 'lucide-react';
import StageDocumentUpload from './StageDocumentUpload';
import SmileProgressWidget from './SmileProgressWidget';

interface PipelineProgressProps {
  clusterId: string;
}

export default function PipelineProgress({ clusterId }: PipelineProgressProps) {
  const [progress, setProgress] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const { user } = useAuthStore();

  const fetchProgress = async () => {
    try {
      const res = await apiFetch(`/pipeline-engine/clusters/${clusterId}/progress`);
      if (res.ok) {
        const data = await res.json();
        setProgress(data);
      }
    } catch (error) {
      console.error('Failed to fetch pipeline progress', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();
  }, [clusterId]);

  const handleAdvance = async (stageId: string) => {
    if (!confirm('Apakah Anda yakin ingin menyelesaikan tahap ini?')) return;
    
    setAdvancing(stageId);
    try {
      const res = await apiFetch(`/pipeline-engine/clusters/${clusterId}/stages/${stageId}/advance`, {
        method: 'POST',
      });
      if (res.ok) {
        toast.success('Tahap berhasil diselesaikan');
        fetchProgress();
      } else {
        const err = await res.json();
        toast.error(err.message || 'Gagal menyelesaikan tahap');
      }
    } catch (error) {
      toast.error('Terjadi kesalahan sistem');
    } finally {
      setAdvancing(null);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center p-12">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        {progress.map((p, idx) => (
          <StageItem 
            key={p.id} 
            item={p} 
            user={user} 
            onAdvance={() => handleAdvance(p.stageId)}
            advancing={advancing === p.stageId}
            isLast={idx === progress.length - 1}
            onRefresh={fetchProgress}
            clusterId={clusterId}
          />
        ))}
      </div>
    </div>
  );
}

function StageItem({ item, user, onAdvance, advancing, isLast, onRefresh, clusterId }: any) {
  const [expanded, setExpanded] = useState(item.status === 'ACTIVE');
  const stage = item.stage;
  const isAllowed = user && stage.allowedActorRoles.includes(user.role);
  
  const statusConfig: any = {
    DONE: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50' },
    ACTIVE: { icon: PlayCircle, color: 'text-primary', bg: 'bg-primary/10 border-primary/20 shadow-sm' },
    LOCKED: { icon: Lock, color: 'text-slate-400', bg: 'bg-slate-50' },
    BLOCKED: { icon: AlertCircle, color: 'text-amber-500', bg: 'bg-amber-50 border-amber-200' },
  };

  const config = statusConfig[item.status] || statusConfig.LOCKED;
  const Icon = config.icon;

  const hasSmileCondition = stage.triggerConditions?.smileProgressMin != null;

  return (
    <div className={`border rounded-xl transition-all duration-200 ${config.bg}`}>
      <div 
        className="p-4 flex items-center gap-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={`p-2 rounded-full bg-white border ${config.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider opacity-60">Tahap {stage.sequence}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase" style={{ backgroundColor: stage.color || '#64748b' }}>
              {stage.shortLabel}
            </span>
          </div>
          <h3 className="font-semibold truncate">{stage.name}</h3>
          {item.completedAt && (
            <p className="text-xs opacity-60 mt-0.5">
              Selesai pada {new Date(item.completedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {item.status === 'LOCKED' && item.blockedReason && (
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
              <AlertCircle className="w-3.5 h-3.5" />
              {item.blockedReason}
            </span>
          )}
          {expanded ? <ChevronDown className="w-5 h-5 opacity-40" /> : <ChevronRight className="w-5 h-5 opacity-40" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-black/5 space-y-4 mt-2">
          {/* Blocking Reason Mobile */}
          {item.status === 'LOCKED' && item.blockedReason && (
            <div className="md:hidden p-3 bg-amber-100 text-amber-800 rounded-lg text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{item.blockedReason}</span>
            </div>
          )}

          {/* SMILE Progress Widget */}
          {hasSmileCondition && (
            <SmileProgressWidget 
              clusterId={clusterId} 
              targetPct={stage.triggerConditions.smileProgressMin}
              onUpdate={onRefresh}
            />
          )}

          {/* Required Documents */}
          {stage.requiredDocuments?.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Dokumen Diperlukan
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stage.requiredDocuments.map((doc: any) => (
                  <StageDocumentUpload 
                    key={doc.id} 
                    doc={doc} 
                    clusterId={clusterId}
                    stageId={stage.id}
                    onUpload={onRefresh}
                    canUpload={item.status === 'ACTIVE'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Action Button */}
          {item.status === 'ACTIVE' && isAllowed && (
            <div className="pt-2">
              <button
                onClick={(e) => { e.stopPropagation(); onAdvance(); }}
                disabled={advancing}
                className="w-full py-2.5 bg-primary text-white rounded-lg font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {advancing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
                Selesaikan Tahap
              </button>
            </div>
          )}

          {item.status === 'DONE' && (
            <div className="p-3 bg-slate-100 rounded-lg text-sm text-slate-600 italic">
              "Tahap telah selesai diverifikasi"
            </div>
          )}
        </div>
      )}
    </div>
  );
}
