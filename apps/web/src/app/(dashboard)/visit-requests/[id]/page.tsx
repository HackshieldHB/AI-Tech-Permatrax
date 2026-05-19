'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, Clock, XCircle, Download, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../../../store/authStore';
import { apiFetch, API_URL } from '../../../../lib/auth';
import { apiGet, apiPatch, apiPost, fixFileUrl, uploadFile, API_BASE } from '../../../../lib/api'; // FIX: apiGet + API_BASE for signed BA Open download URLs
import { toast } from 'sonner';
import { isPmRole, isSurveyorRole } from '../../../../lib/roles';

// FIX Issue 2A: format an ISO/date string into what <input type="datetime-local"> accepts (local "YYYY-MM-DDTHH:mm")
function toDatetimeLocal(isoOrString: string | null | undefined): string {
  if (!isoOrString) return '';
  try {
    const d = new Date(isoOrString);
    if (Number.isNaN(d.getTime())) return ''; // FIX Issue 2A: guard invalid input
    const pad = (n: number) => String(n).padStart(2, '0'); // FIX Issue 2A
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; // FIX Issue 2A: local timezone
  } catch {
    return ''; // FIX Issue 2A: fall back to empty on parse failure
  }
}

// FIX Issue 2A: convert a datetime-local value back to an ISO string for the API
function fromDatetimeLocal(localValue: string): string {
  if (!localValue) return ''; // FIX Issue 2A: null-safe
  const d = new Date(localValue); // FIX Issue 2A: treat as local time
  if (Number.isNaN(d.getTime())) return ''; // FIX Issue 2A: guard bogus values
  return d.toISOString(); // FIX Issue 2A: API stores ISO UTC
}

// FIX: Fix 4 — map permit cluster phase → human label + progress percent
const PHASE_LABELS: Record<string, string> = {
  CLUSTER_INTAKE:       'Intake Cluster',
  VISIT_REQUEST:        'Visit Request',
  BA_OPEN:              'BA Open dibuat',
  SITE_VISIT:           'Kunjungan Lapangan',
  SURVEY_INPUT:         'Input Data Survey',
  ROUTE_SURVEY:         'Route Survey',
  BA_SURVEY:            'BA Survey',
  SIP_REQUEST:          'SIP ke ISP',
  HLD_SUBMISSION:       'Review HLD',
  LLD_SUBMISSION:       'Review LLD',
  PR_BR_ISSUANCE:       'PR/BR dari ISP',
  CONTRACT_MANAGEMENT:  'PKS/PO Kontrak',
  SKOM_BUDGET:          'Budget SKOM',
  MANAGEMENT_APPROVAL:  'Approval Management',
  FUND_DISBURSEMENT:    'Pencairan Dana',
  BAK_GENERATION:       'BAK dibuat',
  BAKP_COMPILATION:     'BAKP Kompilasi',
  CLAIM_SUBMISSION:     'Submit Dokumen Klaim',
  INVOICE_PACKAGE:      'Invoice ke Finance',
  PERMIT_DONE:          '🎉 Permit Selesai',
};

const PHASE_PCT: Record<string, number> = {
  CLUSTER_INTAKE: 15, VISIT_REQUEST: 15, BA_OPEN: 20, SITE_VISIT: 25,
  SURVEY_INPUT: 30, ROUTE_SURVEY: 35, BA_SURVEY: 40, SIP_REQUEST: 45,
  HLD_SUBMISSION: 50, LLD_SUBMISSION: 55, PR_BR_ISSUANCE: 60,
  CONTRACT_MANAGEMENT: 65, SKOM_BUDGET: 70, MANAGEMENT_APPROVAL: 73,
  FUND_DISBURSEMENT: 76, BAK_GENERATION: 80, BAKP_COMPILATION: 85,
  CLAIM_SUBMISSION: 90, INVOICE_PACKAGE: 95, PERMIT_DONE: 100,
};

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  SUBMITTED: CheckCircle,
  VISIT_GATE_APPROVED: CheckCircle,
  VISIT_GATE_REJECTED: XCircle,
  PM_APPROVED: CheckCircle,
  PM_REJECTED: XCircle,
  PM_SENIOR_APPROVED: CheckCircle,
  PM_SENIOR_REJECTED: XCircle,
  ADMIN_APPROVED: CheckCircle,
  ADMIN_REJECTED: XCircle,
  MARKED_EXISTING_FIBER: XCircle,
};

/** Label timeline (Indonesia) untuk VisitApprovalLog.action */
const APPROVAL_LOG_LABELS: Record<string, string> = {
  SUBMITTED: 'Diajukan ke PM',
  VISIT_GATE_APPROVED: 'Jadwal disetujui (PM)',
  VISIT_GATE_REJECTED: 'PM menolak jadwal — perlu revisi',
  PM_APPROVED: 'Hasil survey disetujui (PM)',
  PM_REJECTED: 'Hasil survey ditolak (PM)',
  PM_SENIOR_APPROVED: 'Disetujui PM Senior',
  PM_SENIOR_REJECTED: 'Ditolak PM Senior',
  ADMIN_APPROVED: 'Disetujui Admin',
  ADMIN_REJECTED: 'Ditolak Admin',
  MARKED_EXISTING_FIBER: 'Ditandai jaringan existing',
};

// FIX: Surveyor task panel — shows current task + checklist of all survey steps
const SURVEYOR_TASKS: Record<string, { title: string; desc: string; path: string; icon: string; color: string }> = {
  BA_OPEN: {
    title: 'Tunggu BA Open Generate',
    desc: 'BA Open sedang diproses. Setelah selesai akan lanjut ke kunjungan.',
    path: '',
    icon: '📄', color: '#3B82F6',
  },
  SITE_VISIT: {
    title: 'Input Data Kunjungan Lapangan',
    desc: 'Isi data RT, RW, dan pengelola yang ditemui saat kunjungan.',
    path: '/site-visit',
    icon: '🏠', color: '#00D4B4',
  },
  SURVEY_INPUT: {
    title: 'Input Data Survey',
    desc: 'Catat kondisi area, tingkat kesulitan akses, dan temuan lapangan.',
    path: '/survey-input',
    icon: '📋', color: '#8B5CF6',
  },
  ROUTE_SURVEY: {
    title: 'Survey Route & Homepass',
    desc: 'Input jumlah homepass dan panjang jalur kabel fiber.',
    path: '/route-survey',
    icon: '🗺️', color: '#F59E0B',
  },
  BA_SURVEY: {
    title: 'Upload Foto Evidence',
    desc: 'Upload foto dokumentasi kunjungan dengan GPS tagging (wajib).',
    path: '/evidence',
    icon: '📸', color: '#EC4899',
  },
  SIP_REQUEST: {
    title: 'Isi Form SIP',
    desc: 'Isi Survey Information Permit (19 fields) untuk dikirim ke ISP.',
    path: '/sip',
    icon: '📝', color: '#EF4444',
  },
};

// FIX: canonical surveyor phase order for checklist progress
const SURVEYOR_PHASE_ORDER = ['BA_OPEN', 'SITE_VISIT', 'SURVEY_INPUT', 'ROUTE_SURVEY', 'BA_SURVEY', 'SIP_REQUEST'];

function SurveyorTaskPanel({
  cluster, clusterId, readOnly = false,
}: {
  cluster: any;
  clusterId: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const currentPhase = cluster?.currentPhase as string;
  const currentTask = SURVEYOR_TASKS[currentPhase];

  // FIX: if cluster has moved past BA_SURVEY/SIP phases, surveyor is done
  const isSurveyorDone = !SURVEYOR_PHASE_ORDER.includes(currentPhase);

  return (
    <div
      style={{
        padding: '20px 24px',
        borderRadius: 14,
        marginTop: 20,
        background: 'linear-gradient(135deg, #00D4B408, #3B82F608)',
        border: '1px solid #00D4B430',
      }}
    >
      {/* FIX: header — role-aware title */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: '#00D4B420',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
          }}
        >
          {readOnly ? '👀' : '✅'}
        </div>
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--color-text-primary, #0f172a)',
            }}
          >
            {readOnly
              ? 'Progress Survey Surveyor'
              : isSurveyorDone
                ? 'Survey Selesai!'
                : 'Visit Request Disetujui!'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary, #64748b)',
            }}
          >
            {readOnly
              ? 'Pantauan tugas surveyor di cluster ini'
              : isSurveyorDone
                ? 'Semua tugas survey lapangan sudah diselesaikan'
                : 'Saatnya melakukan survey lapangan'}
          </div>
        </div>
      </div>

      {/* FIX: current task card — editable for surveyor, hidden for read-only when done */}
      {!readOnly && currentTask && !isSurveyorDone ? (
        <div
          style={{
            padding: '16px 18px',
            borderRadius: 10,
            background: 'var(--color-background-primary, #fff)',
            border: `1.5px solid ${currentTask.color}40`,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 26, flexShrink: 0 }}>{currentTask.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--color-text-primary, #0f172a)',
                  marginBottom: 4,
                }}
              >
                Tugas Sekarang: {currentTask.title}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary, #64748b)',
                  lineHeight: 1.5,
                }}
              >
                {currentTask.desc}
              </div>
            </div>
          </div>
          {currentTask.path ? (
            <button
              type="button"
              onClick={() => router.push(`/permit-clusters/${clusterId}${currentTask.path}`)}
              style={{
                width: '100%',
                padding: '11px 16px',
                borderRadius: 8,
                border: 'none',
                background: currentTask.color,
                color: 'white',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Mulai: {currentTask.title} →
            </button>
          ) : null}
        </div>
      ) : null}

      {/* FIX: checklist of all survey steps */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-secondary, #64748b)',
          marginBottom: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Progress Survey
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SURVEYOR_PHASE_ORDER.map((phase) => {
          const task = SURVEYOR_TASKS[phase];
          const currentIdx = SURVEYOR_PHASE_ORDER.indexOf(currentPhase);
          const taskIdx = SURVEYOR_PHASE_ORDER.indexOf(phase);
          const isDone = taskIdx < currentIdx || isSurveyorDone;
          const isActive = taskIdx === currentIdx && !isSurveyorDone;

          return (
            <div
              key={phase}
              onClick={() =>
                !readOnly && (isActive || isDone) && task.path
                  ? router.push(`/permit-clusters/${clusterId}${task.path}`)
                  : undefined
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: isActive
                  ? `${task.color}15`
                  : 'var(--color-background-secondary, #f8fafc)',
                border: isActive ? `0.5px solid ${task.color}40` : 'none',
                cursor:
                  !readOnly && (isActive || isDone) && task.path ? 'pointer' : 'default',
                opacity: !isDone && !isActive ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 16, flexShrink: 0 }}>
                {isDone ? '✅' : isActive ? '🔵' : '⬜'}
              </div>
              <span
                style={{
                  fontSize: 13,
                  color: isActive
                    ? 'var(--color-text-primary, #0f172a)'
                    : 'var(--color-text-secondary, #64748b)',
                  fontWeight: isActive ? 600 : 400,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {task.title}
              </span>
              {isActive ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: task.color,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: `${task.color}15`,
                    flexShrink: 0,
                  }}
                >
                  SEKARANG
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function VisitRequestDetailPage() {
  const params    = useParams();
  const router    = useRouter(); // FIX: needed for pipeline detail navigation
  const id        = params?.id as string;
  const { user }  = useAuthStore();

  const [vr, setVr] = useState<any>(null);
  const [baOpen, setBaOpen] = useState<any | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [notes, setNotes] = useState('');
  // FIX Issue 2: editable form state for REJECTED visit requests
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    visitDate: '',
    stakeholderResponse: 'PENDING' as string,
    surveyNotes: '',
    rtContact: '',
    rwContact: '',
    pengelolaContact: '',
    areaCondition: '',
    existingNetworkFound: false,
    existingOperator: '',
  });
  const [surveyDataForm, setSurveyDataForm] = useState({
    rtContact: '',
    rwContact: '',
    pengelolaContact: '',
    areaCondition: '',
    existingNetworkFound: false,
    existingOperator: '',
    stakeholderResponse: 'PENDING' as string,
    surveyNotes: '',
    evidencePhotos: [] as string[],
  });
  const [surveyPhotosUploading, setSurveyPhotosUploading] = useState(false);
  const [editPhotos, setEditPhotos] = useState<Array<{ fileUrl: string; fileName?: string }>>([]); // FIX Issue 2B: editable evidence photo list
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false); // FIX Issue 2B: upload progress flag

  const loadBaOpen = useCallback(async () => {
    try {
      const json = await apiGet<{ baOpen: any | null }>(`/ba-open/by-visit-request/${id}`); // FIX: same-origin API host as other dashboard calls
      setBaOpen(json.baOpen ?? null);
    } catch {
      setBaOpen(null); // FIX: BA Open might not exist yet
    }
  }, [id]);

  const handleBaOpenDownload = async (baOpenId: string) => {
    try {
      const result = await apiGet<{ url: string }>(`/ba-open/${baOpenId}/download-url`); // FIX: time-limited tokenized URL works behind ngrok
      window.open(result.url, '_blank');
    } catch {
      if (baOpen?.pdfUrl) {
        window.open(fixFileUrl(baOpen.pdfUrl), '_blank'); // FIX: stored file path rewritten for current API host
      } else {
        const downloadUrl = `${API_BASE}/ba-open/${baOpenId}/download`; // FIX: legacy direct download (no token)
        window.open(downloadUrl, '_blank');
      }
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/visit-requests/${id}`, {}, user?.id);
      if (!res.ok) throw new Error('Gagal memuat data');
      const data = await res.json();
      setVr(data);
      setEditForm({
        visitDate: data.visitDate ?? '',
        stakeholderResponse: data.stakeholderResponse ?? 'PENDING',
        surveyNotes: data.surveyNotes ?? '',
        rtContact: data.rtContact ?? '',
        rwContact: data.rwContact ?? '',
        pengelolaContact: data.pengelolaContact ?? '',
        areaCondition: data.areaCondition ?? '',
        existingNetworkFound: !!data.existingNetworkFound,
        existingOperator: data.existingOperator ?? '',
      });
      const ev: string[] = Array.isArray(data.evidencePhotos)
        ? data.evidencePhotos.map((raw: unknown) =>
            typeof raw === 'string' ? raw : (raw as { fileUrl?: string })?.fileUrl ?? '',
          ).filter(Boolean)
        : [];
      setSurveyDataForm({
        rtContact: data.rtContact ?? '',
        rwContact: data.rwContact ?? '',
        pengelolaContact: data.pengelolaContact ?? '',
        areaCondition: data.areaCondition ?? '',
        existingNetworkFound: !!data.existingNetworkFound,
        existingOperator: data.existingOperator ?? '',
        stakeholderResponse: data.stakeholderResponse ?? 'PENDING',
        surveyNotes: data.surveyNotes ?? '',
        evidencePhotos: ev,
      });
      // FIX Issue 2B: hydrate editable photo list from server (supports both string[] and object[] shapes)
      const rawPhotos: unknown[] = Array.isArray(data.evidencePhotos) ? data.evidencePhotos : []; // FIX Issue 2B
      setEditPhotos(
        rawPhotos
          .map((raw): { fileUrl: string; fileName?: string } | null => { // FIX Issue 2B: normalize shape
            if (typeof raw === 'string') return { fileUrl: raw };
            if (raw && typeof raw === 'object' && 'fileUrl' in raw && typeof (raw as any).fileUrl === 'string') {
              return { fileUrl: (raw as any).fileUrl, fileName: (raw as any).fileName };
            }
            return null;
          })
          .filter((x): x is { fileUrl: string; fileName?: string } => x !== null), // FIX Issue 2B
      );
      await loadBaOpen();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  useEffect(() => {
    if (user?.id) void loadBaOpen(); // FIX: refresh BA Open when auth hydrates
  }, [loadBaOpen, user?.id]);

  const handlePmVisitReview = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Alasan penolakan wajib diisi');
      return;
    }
    setActionLoading(true);
    try {
      if (action === 'APPROVE') {
        await apiPatch(`/visit-requests/${id}/pm-visit-review`, {
          action: 'APPROVE',
          notes: notes.trim() || undefined,
        });
      } else {
        await apiPatch(`/visit-requests/${id}/pm-visit-review`, {
          action: 'REJECT',
          rejectionReason: notes.trim(),
        });
      }
      toast.success(action === 'APPROVE' ? 'Jadwal kunjungan disetujui' : 'Jadwal kunjungan ditolak');
      setNotes('');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePmSurveyReview = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Catatan wajib untuk penolakan');
      return;
    }
    setActionLoading(true);
    try {
      await apiPatch(`/visit-requests/${id}/pm-review`, {
        action,
        notes: action === 'REJECT' ? notes.trim() : undefined,
      });
      toast.success(action === 'APPROVE' ? 'Hasil survey disetujui' : 'Hasil survey ditolak');
      setNotes('');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdminApprove = async (action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !notes.trim()) {
      toast.error('Catatan wajib untuk penolakan');
      return;
    }
    setActionLoading(true);
    try {
      await apiPatch(`/visit-requests/${id}/admin-approve`, { action, notes: action === 'REJECT' ? notes : undefined });
      toast.success(action === 'APPROVE' ? 'Disetujui final — BA Open dibuat!' : 'Ditolak');
      setNotes('');
      await fetchData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSurveyorSubmit = async () => {
    setActionLoading(true);
    try {
      await apiPost(`/visit-requests/${id}/submit`, {});
      toast.success('Pengajuan terkirim ke PM');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitSurveyData = async () => {
    if (surveyDataForm.stakeholderResponse === 'PENDING') {
      toast.error('Respon stakeholder wajib diisi');
      return;
    }
    setActionLoading(true);
    try {
      await apiPatch(`/visit-requests/${id}/survey-data`, {
        ...surveyDataForm,
        evidencePhotos: surveyDataForm.evidencePhotos,
      });
      toast.success('Data survey dikirim untuk review PM');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengirim data');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-full border-2 border-[#00D4B4]/30 border-t-[#00D4B4] animate-spin" /></div>;
  if (!vr) return <div className="text-center py-16 text-slate-400">Visit request tidak ditemukan</div>;

  const role = user?.role ?? '';
  const isPM = isPmRole(role);
  const isAdmin = role === 'ADMIN';
  const isSurveyor = isSurveyorRole(role);
  const canPMVisitReview = isPM && vr.status === 'PM_REVIEW_VISIT';
  const canPMSurveyReview = isPM && vr.status === 'PM_REVIEW_SURVEY';
  const canAdminApprove = isAdmin && vr.status === 'ADMIN_REVIEW';
  /** Legacy: tolak jadwal memakai status REJECTED (data lama). Alur baru: DRAFT + rejectionReason. */
  const visitScheduleRejected = vr.status === 'REJECTED' && !vr.visitGateApprovedAt;
  const surveyResultRejected = vr.status === 'REJECTED' && Boolean(vr.visitGateApprovedAt);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-2xl font-black text-slate-800">{vr.cleanList?.rwCode ?? 'Visit Request'}</h1>
            <span className="px-3 py-1 rounded-full text-xs font-black bg-sky-100 text-sky-700">{vr.fiberType}</span>
            <span className="px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-600">{vr.ispCustomer}</span>
          </div>
          <p className="text-sm text-slate-500">{vr.cleanList?.kelurahan} · {vr.requester?.name}</p>
        </div>
      </div>

      {isSurveyor && surveyResultRejected && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 font-semibold">
          Ditolak (hasil survey): {vr.rejectionReason || '—'}
        </div>
      )}

      {isSurveyor && vr.status === 'DRAFT' && vr.requestedBy === user?.id && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          {vr.rejectionReason ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 font-semibold leading-relaxed">
              PM menolak jadwal kunjungan: {vr.rejectionReason}. Silakan revisi tanggal/jam kunjungan dan catatan visit,
              lalu ajukan ulang.
            </div>
          ) : null}
          <h4 className="font-black text-slate-800">
            {vr.rejectionReason ? 'Draft — revisi jadwal' : 'Draft — jadwal & catatan'}
          </h4>
          <p className="text-xs text-slate-500">
            Setelah submit, PM akan meninjau jadwal kunjungan. Data lapangan diisi di halaman ini setelah jadwal disetujui.
          </p>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tanggal kunjungan</label>
            <input
              type="datetime-local"
              value={toDatetimeLocal(editForm.visitDate)}
              onChange={(e) => setEditForm((p) => ({ ...p, visitDate: fromDatetimeLocal(e.target.value) }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Catatan (opsional)</label>
            <textarea
              value={editForm.surveyNotes}
              onChange={(e) => setEditForm((p) => ({ ...p, surveyNotes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={actionLoading}
              onClick={async () => {
                setActionLoading(true);
                try {
                  await apiPatch(`/visit-requests/${id}`, {
                    visitDate: editForm.visitDate || undefined,
                    surveyNotes: editForm.surveyNotes || undefined,
                  });
                  toast.success('Draf disimpan');
                  await fetchData();
                } catch (e: unknown) {
                  toast.error(e instanceof Error ? e.message : 'Gagal simpan');
                } finally {
                  setActionLoading(false);
                }
              }}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Simpan draf
            </button>
            <button
              type="button"
              onClick={handleSurveyorSubmit}
              disabled={actionLoading || !editForm.visitDate}
              className="px-5 py-2.5 bg-sky-600 text-white rounded-xl font-bold text-sm hover:bg-sky-700 transition-colors disabled:opacity-60"
            >
              Ajukan jadwal ke PM
            </button>
          </div>
        </div>
      )}

      {isSurveyor && vr.status === 'APPROVED_PENDING_DATA' && vr.requestedBy === user?.id && (
        <div className="bg-white rounded-2xl border border-sky-200 shadow-sm p-5 space-y-4">
          <h4 className="font-black text-slate-800">Isi data survey lapangan</h4>
          <p className="text-sm text-slate-600">
            Jadwal disetujui PM. Lengkapi kontak lapangan, stakeholder, dan unggah foto sebelum kirim ke review hasil survey.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(
              [
                ['rtContact', 'Kontak RT'],
                ['rwContact', 'Kontak RW'],
                ['pengelolaContact', 'Kontak pengelola'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-bold text-slate-500 mb-1">{label}</label>
                <input
                  value={surveyDataForm[key]}
                  onChange={(e) => setSurveyDataForm((p) => ({ ...p, [key]: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Kondisi area</label>
            <textarea
              value={surveyDataForm.areaCondition}
              onChange={(e) => setSurveyDataForm((p) => ({ ...p, areaCondition: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3 items-center">
            <span className="text-sm font-semibold text-slate-700">Jaringan existing?</span>
            <button
              type="button"
              onClick={() => setSurveyDataForm((p) => ({ ...p, existingNetworkFound: false }))}
              className={`px-3 py-1 rounded-lg text-sm font-bold ${!surveyDataForm.existingNetworkFound ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100'}`}
            >
              Tidak
            </button>
            <button
              type="button"
              onClick={() => setSurveyDataForm((p) => ({ ...p, existingNetworkFound: true }))}
              className={`px-3 py-1 rounded-lg text-sm font-bold ${surveyDataForm.existingNetworkFound ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}
            >
              Ya
            </button>
          </div>
          {surveyDataForm.existingNetworkFound && (
            <input
              placeholder="Nama operator"
              value={surveyDataForm.existingOperator}
              onChange={(e) => setSurveyDataForm((p) => ({ ...p, existingOperator: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Respon stakeholder</label>
            <select
              value={surveyDataForm.stakeholderResponse}
              onChange={(e) =>
                setSurveyDataForm((p) => ({ ...p, stakeholderResponse: e.target.value as typeof p.stakeholderResponse }))
              }
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="PENDING">Belum dikonfirmasi</option>
              <option value="ALLOWED">Diizinkan</option>
              <option value="CONDITIONAL">Bersyarat</option>
              <option value="NOT_ALLOWED">Tidak diizinkan</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Catatan survey</label>
            <textarea
              value={surveyDataForm.surveyNotes}
              onChange={(e) => setSurveyDataForm((p) => ({ ...p, surveyNotes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-2">Foto bukti</label>
            {surveyDataForm.evidencePhotos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {surveyDataForm.evidencePhotos.map((url) => (
                  <a key={url} href={fixFileUrl(url)} target="_blank" rel="noreferrer" className="text-xs text-teal-700 underline">
                    Lihat foto
                  </a>
                ))}
              </div>
            )}
            <input
              type="file"
              multiple
              accept="image/*"
              disabled={surveyPhotosUploading}
              className="text-sm"
              onChange={async (e) => {
                const files = e.target.files;
                if (!files?.length) return;
                setSurveyPhotosUploading(true);
                try {
                  const fd = new FormData();
                  Array.from(files).forEach((f) => fd.append('photos', f));
                  const token = useAuthStore.getState().accessToken;
                  const res = await fetch(`${API_URL}/visit-requests/${id}/evidence`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: fd,
                  });
                  if (!res.ok) throw new Error('Gagal upload');
                  const json = (await res.json()) as { evidencePhotos?: string[] };
                  if (json.evidencePhotos) {
                    setSurveyDataForm((p) => ({ ...p, evidencePhotos: json.evidencePhotos ?? p.evidencePhotos }));
                  }
                  toast.success('Foto terunggah');
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : 'Upload gagal');
                } finally {
                  setSurveyPhotosUploading(false);
                  e.target.value = '';
                }
              }}
            />
          </div>
          <button
            type="button"
            disabled={
              actionLoading ||
              surveyDataForm.stakeholderResponse === 'PENDING' ||
              surveyPhotosUploading
            }
            onClick={() => void handleSubmitSurveyData()}
            className="w-full py-3 rounded-xl bg-[#00D4B4] text-[#0F1B2D] font-black text-sm disabled:opacity-50"
          >
            Kirim data survey ke PM
          </button>
        </div>
      )}

      {/* FIX Issue 2: editable form for surveyor when visit request is REJECTED */}
      {isSurveyor && vr.status === 'REJECTED' && vr.requestedBy === user?.id && (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--color-background-primary, #fff)',
            border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary, #0f172a)' }}>
            {visitScheduleRejected ? '✏️ Revisi jadwal kunjungan' : '✏️ Revisi data survey'}
          </div>

          {!editMode ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setEditMode(true)} // FIX Issue 2: open inline editor
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#F59E0B',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Perbaiki Data Visit Request
              </button>
              <button
                type="button"
                onClick={handleSurveyorSubmit}
                disabled={actionLoading}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
                  background: 'none',
                  cursor: actionLoading ? 'wait' : 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--color-text-secondary, #64748b)',
                }}
              >
                {actionLoading ? 'Memproses…' : 'Submit ulang tanpa perubahan'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Tanggal Kunjungan {visitScheduleRejected ? '*' : ''}
                </label>
                {visitScheduleRejected ? (
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(editForm.visitDate)}
                    min={toDatetimeLocal(new Date().toISOString())}
                    onChange={(e) => setEditForm((p) => ({ ...p, visitDate: fromDatetimeLocal(e.target.value) }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', background: 'var(--color-background-primary, #fff)', color: 'var(--color-text-primary, #0f172a)', fontSize: 13 }}
                  />
                ) : (
                  <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>
                    {vr.visitDate
                      ? new Date(vr.visitDate).toLocaleString('id-ID')
                      : '—'} (jadwal tidak dapat diubah pada tahap ini)
                  </p>
                )}
                {visitScheduleRejected && editForm.visitDate ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748b)', marginTop: 4 }}>
                    Terpilih:{' '}
                    {new Date(editForm.visitDate).toLocaleString('id-ID', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                ) : null}
              </div>
              {surveyResultRejected ? (
                <>
                  {(
                    [
                      ['rtContact', 'Kontak RT'],
                      ['rwContact', 'Kontak RW'],
                      ['pengelolaContact', 'Kontak pengelola'],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {label}
                      </label>
                      <input
                        value={editForm[key]}
                        onChange={(e) => setEditForm((p) => ({ ...p, [key]: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', fontSize: 13 }}
                      />
                    </div>
                  ))}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Kondisi area
                    </label>
                    <textarea
                      value={editForm.areaCondition}
                      onChange={(e) => setEditForm((p) => ({ ...p, areaCondition: e.target.value }))}
                      rows={2}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', fontSize: 13 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Jaringan existing?</span>
                    <button type="button" onClick={() => setEditForm((p) => ({ ...p, existingNetworkFound: false }))} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: !editForm.existingNetworkFound ? '#DCFCE7' : '#f1f5f9' }}>Tidak</button>
                    <button type="button" onClick={() => setEditForm((p) => ({ ...p, existingNetworkFound: true }))} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: editForm.existingNetworkFound ? '#FEE2E2' : '#f1f5f9' }}>Ya</button>
                  </div>
                  {editForm.existingNetworkFound ? (
                    <input
                      value={editForm.existingOperator}
                      onChange={(e) => setEditForm((p) => ({ ...p, existingOperator: e.target.value }))}
                      placeholder="Nama operator"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', fontSize: 13 }}
                    />
                  ) : null}
                </>
              ) : null}
              {surveyResultRejected ? (
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Respon Stakeholder *
                </label>
                <select
                  value={editForm.stakeholderResponse}
                  onChange={(e) => setEditForm((p) => ({ ...p, stakeholderResponse: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', background: 'var(--color-background-primary, #fff)', color: 'var(--color-text-primary, #0f172a)', fontSize: 13 }}
                >
                  <option value="PENDING">Belum dikonfirmasi</option>
                  <option value="ALLOWED">✅ Diizinkan</option>
                  <option value="CONDITIONAL">⚠️ Diizinkan bersyarat</option>
                  <option value="NOT_ALLOWED">🚫 Tidak Diizinkan</option>
                </select>
                {editForm.stakeholderResponse === 'NOT_ALLOWED' && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, marginTop: 8, background: '#EF444415', border: '1px solid #EF444440', fontSize: 12, color: '#EF4444' }}>
                    🚫 Tidak bisa submit ulang — lakukan pendekatan ke stakeholder terlebih dahulu.
                  </div>
                )}
              </div>
              ) : null}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Catatan Survey
                </label>
                <textarea
                  value={editForm.surveyNotes}
                  onChange={(e) => setEditForm((p) => ({ ...p, surveyNotes: e.target.value }))} // FIX Issue 2: capture notes
                  rows={3}
                  placeholder="Tambahkan catatan perbaikan..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--color-border-tertiary, #e2e8f0)', background: 'var(--color-background-primary, #fff)', color: 'var(--color-text-primary, #0f172a)', fontSize: 13, resize: 'vertical' }}
                />
              </div>

              {/* FIX Issue 2B: photo editor — survey result rejection only */}
              {surveyResultRejected ? (
              <div style={{ paddingTop: 12, borderTop: '0.5px solid var(--color-border-tertiary, #e2e8f0)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary, #64748b)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Foto Bukti Kunjungan
                </div>

                {editPhotos.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginBottom: 12 }}>
                    {editPhotos.map((photo, idx) => {
                      const url = fixFileUrl(photo.fileUrl); // FIX Issue 2B: ngrok-safe URL for existing photos
                      return (
                        <div key={`${photo.fileUrl}-${idx}`} style={{ position: 'relative' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={photo.fileName || `Foto ${idx + 1}`}
                            onClick={() => window.open(url, '_blank')} // FIX Issue 2B: click to view full
                            style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8, cursor: 'pointer', background: '#f1f5f9' }}
                          />
                          <button
                            type="button"
                            onClick={() => setEditPhotos((prev) => prev.filter((_, i) => i !== idx))} // FIX Issue 2B: remove photo from list
                            style={{
                              position: 'absolute', top: 4, right: 4,
                              width: 22, height: 22, borderRadius: '50%',
                              background: '#EF4444', color: '#fff',
                              border: 'none', cursor: 'pointer',
                              fontSize: 12, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                            }}
                            title="Hapus foto"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 16px', borderRadius: 8,
                    border: `1.5px dashed ${uploadingEditPhoto ? '#00D4B4' : 'var(--color-border-tertiary, #e2e8f0)'}`,
                    background: uploadingEditPhoto ? '#00D4B408' : 'var(--color-background-secondary, #f8fafc)',
                    cursor: uploadingEditPhoto ? 'wait' : 'pointer',
                    transition: 'all 150ms',
                  }}
                >
                  <span style={{ fontSize: 20 }}>{uploadingEditPhoto ? '⏳' : '📷'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary, #0f172a)' }}>
                      {uploadingEditPhoto ? 'Mengupload foto...' : editPhotos.length > 0 ? '+ Tambah Foto Lagi' : '+ Upload Foto Survey'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748b)', marginTop: 2 }}>
                      JPG, PNG, WEBP — Maksimal 10MB per foto
                    </div>
                  </div>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    disabled={uploadingEditPhoto}
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (!files.length) return;
                      setUploadingEditPhoto(true); // FIX Issue 2B: lock UI during upload
                      try {
                        for (const file of files) {
                          if (file.size > 10 * 1024 * 1024) { // FIX Issue 2B: 10MB guard
                            toast.error(`${file.name} terlalu besar (max 10MB)`);
                            continue;
                          }
                          const url = await uploadFile(file, 'visit-request-evidence', id); // FIX Issue 2B: reuse central uploader
                          setEditPhotos((prev) => [...prev, { fileUrl: url, fileName: file.name }]); // FIX Issue 2B: append to list
                          toast.success(`✅ ${file.name} diupload`);
                        }
                      } catch (err: any) {
                        toast.error(`Upload gagal: ${err?.message ?? err}`);
                      } finally {
                        setUploadingEditPhoto(false);
                        e.target.value = ''; // FIX Issue 2B: reset input so same file can be picked again
                      }
                    }}
                  />
                </label>

                {editPhotos.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #64748b)', marginTop: 6 }}>
                    {editPhotos.length} foto · Klik foto untuk melihat ukuran penuh
                  </div>
                )}
              </div>
              ) : null}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={
                    actionLoading ||
                    (visitScheduleRejected && !editForm.visitDate) ||
                    (surveyResultRejected &&
                      (editForm.stakeholderResponse === 'NOT_ALLOWED' ||
                        editForm.stakeholderResponse === 'PENDING'))
                  }
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      if (visitScheduleRejected) {
                        await apiPatch(`/visit-requests/${id}`, {
                          visitDate: editForm.visitDate || undefined,
                          surveyNotes: editForm.surveyNotes || undefined,
                        });
                      } else {
                        await apiPatch(`/visit-requests/${id}`, {
                          rtContact: editForm.rtContact || undefined,
                          rwContact: editForm.rwContact || undefined,
                          pengelolaContact: editForm.pengelolaContact || undefined,
                          areaCondition: editForm.areaCondition || undefined,
                          existingNetworkFound: editForm.existingNetworkFound,
                          existingOperator: editForm.existingOperator || undefined,
                          stakeholderResponse: editForm.stakeholderResponse,
                          surveyNotes: editForm.surveyNotes || undefined,
                          evidencePhotos: editPhotos.map((p) => p.fileUrl),
                        });
                      }
                      await apiPost(`/visit-requests/${id}/submit`, {});
                      toast.success('Berhasil submit ulang');
                      setEditMode(false);
                      await fetchData();
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : 'Gagal submit ulang');
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#00D4B4',
                    color: 'white',
                    cursor: actionLoading ? 'wait' : 'pointer',
                    fontSize: 14,
                    fontWeight: 600,
                    opacity:
                      (visitScheduleRejected && !editForm.visitDate) ||
                      (surveyResultRejected &&
                        (editForm.stakeholderResponse === 'NOT_ALLOWED' ||
                          editForm.stakeholderResponse === 'PENDING'))
                        ? 0.5
                        : 1,
                  }}
                >
                  {actionLoading ? 'Memproses…' : '🔄 Simpan & Submit Ulang'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 10,
                    border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: 'var(--color-text-secondary, #64748b)',
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {canPMVisitReview && (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-5 space-y-3">
          <h4 className="font-black text-slate-800">Review jadwal kunjungan</h4>
          <p className="text-xs text-slate-500">Setujui atau tolak jadwal sebelum surveyor ke lapangan.</p>
          <textarea
            placeholder="Catatan (opsional untuk setujui / wajib alasan untuk tolak)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm min-h-[80px]"
          />
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => void handlePmVisitReview('APPROVE')}
              disabled={actionLoading}
              style={{ background: 'green' }}
              className="px-4 py-2 rounded-xl text-white font-bold text-sm"
            >
              ✓ Setujui jadwal
            </button>
            <button
              type="button"
              onClick={() => void handlePmVisitReview('REJECT')}
              disabled={actionLoading || !notes.trim()}
              style={{ background: 'red' }}
              className="px-4 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-40"
            >
              ✗ Tolak jadwal
            </button>
          </div>
        </div>
      )}

      {canPMSurveyReview && (
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-5 space-y-3">
          <h4 className="font-black text-slate-800">Review hasil survey</h4>
          <p className="text-xs text-slate-500">Hasil lapangan sudah dikirim surveyor.</p>
          <textarea
            placeholder="Catatan (wajib untuk tolak)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm min-h-[80px]"
          />
          <div className="flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => void handlePmSurveyReview('APPROVE')}
              disabled={actionLoading}
              style={{ background: 'green' }}
              className="px-4 py-2 rounded-xl text-white font-bold text-sm"
            >
              ✓ Setujui hasil
            </button>
            <button
              type="button"
              onClick={() => void handlePmSurveyReview('REJECT')}
              disabled={actionLoading || !notes.trim()}
              style={{ background: 'red' }}
              className="px-4 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-40"
            >
              ✗ Tolak hasil
            </button>
          </div>
        </div>
      )}

      {canAdminApprove && (
        <div className="bg-white rounded-2xl border border-purple-100 shadow-sm p-5 space-y-3">
          <h4 className="font-black text-slate-800">Persetujuan Final (Admin)</h4>
          <textarea
            placeholder="Catatan (wajib untuk tolak)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm min-h-[80px]"
          />
          <div className="flex gap-3 flex-wrap">
            <button type="button" onClick={() => handleAdminApprove('APPROVE')} disabled={actionLoading} style={{ background: 'teal' }} className="px-4 py-2 rounded-xl text-white font-bold text-sm">
              ✓ Setujui Final → BA Open dibuat
            </button>
            <button type="button" onClick={() => handleAdminApprove('REJECT')} disabled={actionLoading || !notes.trim()} style={{ background: 'red' }} className="px-4 py-2 rounded-xl text-white font-bold text-sm disabled:opacity-40">
              ✗ Tolak
            </button>
          </div>
        </div>
      )}

      {/* FIX: Fix 4 — Permit Cluster progress section (shows full lifecycle, not just APPROVED) */}
      {vr.permitCluster && (
        <div
          style={{
            padding: 20,
            background: 'var(--color-background-secondary, #f8fafc)',
            borderRadius: 12,
            border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--color-text-primary, #0f172a)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Progress Perizinan
              </h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)', margin: '2px 0 0' }}>
                Cluster: <strong>{vr.permitCluster.clusterCode}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/permit-clusters/${vr.permitCluster.id}`)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-background-info, #ddf4ff)',
                color: 'var(--color-text-info, #0969da)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Lihat Detail Pipeline <ArrowRight style={{ width: 13, height: 13 }} />
            </button>
          </div>
          {(() => {
            const phase = vr.permitCluster.currentPhase as string;
            const pct   = PHASE_PCT[phase] ?? 15;
            const label = PHASE_LABELS[phase] ?? phase;
            const color = pct === 100 ? '#22C55E' : pct >= 70 ? '#8B5CF6' : pct >= 40 ? '#3B82F6' : '#F59E0B';
            return (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: 'var(--color-text-secondary, #64748b)' }}>
                    Fase saat ini: <strong style={{ color: 'var(--color-text-primary, #0f172a)' }}>{label}</strong>
                  </span>
                  <span style={{ fontWeight: 700, color }}>{pct}% selesai</span>
                </div>
                <div
                  style={{
                    height: 8,
                    background: 'var(--color-background-primary, #fff)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: '0.5px solid var(--color-border-tertiary, #e2e8f0)',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: color,
                      borderRadius: 4,
                      transition: 'width 600ms ease',
                    }}
                  />
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* FIX: Fix 6 — Surveyor Task Panel (shows current task + checklist) */}
      {vr.status === 'APPROVED' && vr.permitCluster ? (
        <SurveyorTaskPanel
          cluster={vr.permitCluster}
          clusterId={vr.permitCluster.id}
          readOnly={!isSurveyor}
        />
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 space-y-4">
            <h2 className="font-black text-slate-700 text-sm uppercase tracking-widest">Data Kunjungan</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['Kode RW',       vr.cleanList?.rwCode],
                ['Kelurahan',     vr.cleanList?.kelurahan],
                ['Homepass',      vr.cleanList?.homepasCount],
                ['ISP',           vr.ispCustomer],
                ['Tgl Kunjungan', vr.visitDate ? new Date(vr.visitDate).toLocaleDateString('id-ID') : '—'],
                ['Kontak RT',     vr.rtContact ?? '—'],
                ['Kontak RW',     vr.rwContact ?? '—'],
                ['Kontak Pengelola', vr.pengelolaContact ?? '—'],
                ['Kondisi Area',  vr.areaCondition],
                ['Jaringan Existing', vr.existingNetworkFound ? `Ya (${vr.existingOperator ?? '?'})` : 'Tidak'],
                ['Respon Stakeholder', vr.stakeholderResponse],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <dt className="text-xs font-black text-slate-400 uppercase tracking-wider">{label}</dt>
                  <dd className="font-semibold text-slate-700 mt-0.5">{val ?? '—'}</dd>
                </div>
              ))}
            </dl>
            {vr.surveyNotes && (
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1">Catatan Surveyor</p>
                <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-3">{vr.surveyNotes}</p>
              </div>
            )}
          </div>

          {vr.evidencePhotos?.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h2 className="font-black text-slate-700 text-sm uppercase tracking-widest mb-4">Foto Bukti</h2>
              <div className="grid grid-cols-3 gap-3">
                {vr.evidencePhotos.map((raw: any, i: number) => {
                  const url = fixFileUrl(typeof raw === 'string' ? raw : raw?.fileUrl); // FIX Issue 3/4: rewrite localhost URLs for ngrok access
                  return (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-square rounded-xl overflow-hidden bg-slate-100 block">
                      <img src={url} alt={`photo-${i}`} className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-emerald-50/80 rounded-2xl p-6 border border-emerald-100">
            <h2 className="font-black text-emerald-900 text-sm uppercase tracking-widest mb-3">BA Open</h2>
            {baOpen === undefined ? (
              <p className="text-xs text-slate-500">Memuat status BA Open…</p>
            ) : baOpen ? (
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: 10,
                  marginTop: 4,
                  background: '#3B82F615',
                  border: '0.5px solid #3B82F640',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-text-primary, #0f172a)',
                    marginBottom: 8,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>📄 Berita Acara Open {/* FIX: consistent label with pipeline */}</span>
                  {(baOpen.existingFiber || vr?.status === 'EXISTING_FIBER') && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-amber-900">
                      Fiber Existing
                    </span>
                  )}
                </div>
                <p className="text-emerald-800 font-bold">{baOpen.documentNumber}</p>
                <p className="text-xs text-emerald-700 mb-3">Status: {baOpen.status}</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void handleBaOpenDownload(baOpen.id)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
                    style={{
                      border: 'none',
                      background: '#3B82F6',
                      color: 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <Download style={{ width: 14, height: 14 }} /> ⬇ Download BA Open PDF {/* FIX: signed URL — avoids wrong host / unreachable tab */}
                  </button>
                  {baOpen.pdfUrl ? (
                    <a
                      href={fixFileUrl(baOpen.pdfUrl)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: 'var(--color-background-secondary, #f1f5f9)',
                        color: 'var(--color-text-primary, #0f172a)',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      🔗 Buka Langsung {/* FIX: ngrok-safe absolute file URL */}
                    </a>
                  ) : null}
                </div>
                {!baOpen.pdfUrl ? (
                  <p className="text-xs text-amber-700 mt-2">Jika PDF belum tersimpan, server akan generate saat unduh.</p>
                ) : null}
                {baOpen.documentNumber && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary, #64748b)',
                      marginTop: 8,
                    }}
                  >
                    No. Dokumen: {baOpen.documentNumber}
                    {baOpen.tanggal // FIX: schema field is tanggal (not meetingDate)
                      ? ` · Tanggal: ${new Date(baOpen.tanggal).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}`
                      : ''}
                  </div>
                )}
              </div>
            ) : vr?.status === 'REJECTED' ? (
              <p style={{ color: 'var(--color-text-secondary, #57606a)', fontSize: 13 }}>
                BA Open tidak dibuat karena visit request ditolak Admin.
              </p>
            ) : vr?.adminApprovedAt && (vr?.status === 'APPROVED' || vr?.status === 'EXISTING_FIBER') ? (
              <p style={{ color: 'var(--color-text-secondary, #57606a)', fontSize: 13, lineHeight: 1.5 }}>
                {vr.status === 'EXISTING_FIBER'
                  ? 'Visit disetujui dengan tanda fiber existing. BA Open seharusnya tersedia — muat ulang halaman. Jika tetap kosong, kemungkinan data VR lama (sebelum pembaruan sistem); hubungi Admin untuk penyesuaian manual.'
                  : 'BA Open dibuat otomatis setelah persetujuan Admin. Muat ulang halaman jika nomor dokumen belum tampil.'}
              </p>
            ) : (
              <p style={{ color: 'var(--color-text-secondary, #57606a)', fontSize: 13 }}>
                BA Open akan dibuat otomatis setelah Admin menyetujui visit request.
              </p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 h-fit space-y-6">
          <div>
            <h2 className="font-black text-slate-700 text-sm uppercase tracking-widest mb-3">Ringkasan alur</h2>
            <ul className="text-xs text-slate-600 space-y-2">
              <li>Surveyor submit: {vr.approvalLogs?.find((l: any) => l.action === 'SUBMITTED')?.createdAt ? new Date(vr.approvalLogs.find((l: any) => l.action === 'SUBMITTED').createdAt).toLocaleString('id-ID') : '—'}</li>
              <li>PM review: {vr.pmReviewedAt ? `${new Date(vr.pmReviewedAt).toLocaleString('id-ID')}` : '—'}</li>
              <li>Admin final: {vr.adminApprovedAt ? `${new Date(vr.adminApprovedAt).toLocaleString('id-ID')}` : '—'}</li>
            </ul>
          </div>

          <div>
            <h2 className="font-black text-slate-700 text-sm uppercase tracking-widest mb-5">Timeline Approval</h2>
            <div className="space-y-0">
              {vr.approvalLogs?.map((log: any, i: number) => {
                const Icon = ACTION_ICONS[log.action] ?? Clock;
                const isApproved =
                  log.action.includes('APPROVED') ||
                  log.action === 'SUBMITTED' ||
                  log.action === 'VISIT_GATE_APPROVED';
                return (
                  <div key={log.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${isApproved ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      {i < vr.approvalLogs.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 my-1 min-h-6" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-xs font-black text-slate-700">
                        {APPROVAL_LOG_LABELS[log.action] ?? log.action.replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-slate-500">{log.actor?.name} ({log.actor?.role})</p>
                      <p className="text-[10px] text-slate-400">{new Date(log.createdAt).toLocaleString('id-ID')}</p>
                      {log.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-2 py-1 mt-1">{log.notes}</p>}
                    </div>
                  </div>
                );
              })}
              {(!vr.approvalLogs || vr.approvalLogs.length === 0) && (
                <p className="text-slate-400 text-xs">Belum ada aktivitas.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
