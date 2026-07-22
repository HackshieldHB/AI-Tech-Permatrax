'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle, Circle, Lock, SkipForward, ChevronRight, Upload, FileText, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../../../lib/auth';
import { useAuthStore } from '../../../../store/authStore';
import { fixFileUrl, API_HOST } from '../../../../lib/api';
import {
  FtttProject,
  FtttPhase,
  FtttPhaseStatus,
  FtttClosingLog,
  FtttSpan,
  FtttSpanLogCategory,
  FtttSurveySite,
  FTTT_COMPANY_LABELS,
  FTTT_PHASE_LABELS,
  FTTT_PROJECT_STATUS_LABELS,
  FTTT_DOC_TYPE_LABELS,
  FTTT_COST_CATEGORY_LABELS,
  FTTT_PRIORITY_LABELS,
  FTTT_PRIORITY_COLORS,
  FTTT_REQUEST_STATUS_LABELS,
  FTTT_REQUEST_STATUS_COLORS,
  type FtttCostCategory,
  type FtttTransaction,
  type FtttSiteSummary,
  type FinanceSiteOption,
} from '../../../../types/api.types';
import { io, Socket } from 'socket.io-client';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend as RLegend,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PHASE_ORDER: FtttPhase[] = [
  'INITIATION', 'SITE_INITIATION', 'SURVEY', 'PREPARATION', 'PROCUREMENT',
  'IMPLEMENTATION', 'DOCUMENTATION', 'RECONCILIATION', 'CLOSING',
];
// Integra V2: Bulky projects only manage Initiation lifecycle; operational
// phases (Survey → Closing) belong to their Sites
const BULKY_PHASES: FtttPhase[] = ['INITIATION', 'SITE_INITIATION'];
const SITE_OPERATIONAL_PHASES: FtttPhase[] = PHASE_ORDER.filter(
  (p) => !BULKY_PHASES.includes(p),
);

function fmt(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Date + time (WIB) — used for chronological log timestamps
function fmtDateTimeWIB(date: string | null) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

function PhaseIcon({ status }: { status: FtttPhaseStatus }) {
  if (status === 'COMPLETED') return <CheckCircle size={18} color="#1a7f37" />;
  if (status === 'ACTIVE')    return <Circle size={18} color="#0969DA" fill="#DDF4FF" />;
  if (status === 'SKIPPED')   return <SkipForward size={18} color="#57606a" />;
  return <Lock size={18} color="#D0D7DE" />;
}

// ─── Live Progress Bar ────────────────────────────────────────────────────────
function LiveProgressBar({ project }: { project: FtttProject }) {
  // Integra V3: Bulky Parent progress = Initiation + Site Initiation only.
  // Site children still use full operational lifecycle; optional aggregate label when Sites exist.
  const isBulky = project.hierarchyLevel === 'BULKY';
  const children = project.children ?? [];
  const stepperPhases = isBulky ? BULKY_PHASES : PHASE_ORDER.filter((phase) => {
    const progress = project.phaseProgresses.find((p) => p.phase === phase);
    return progress && progress.status !== 'SKIPPED';
  });

  let pct: number;
  let overallLabel = 'Overall Progress';
  if (isBulky) {
    const bulkyProg = project.phaseProgresses.filter((p) => BULKY_PHASES.includes(p.phase));
    const completed = bulkyProg.filter((p) => p.status === 'COMPLETED').length;
    pct = bulkyProg.length > 0 ? Math.round((completed / bulkyProg.length) * 100) : 0;
    if (children.length > 0) {
      const childPcts = children.map((c) => {
        const cp = (c.phaseProgresses ?? []).filter((p) => p.status !== 'SKIPPED');
        const cCompleted = cp.filter((p) => p.status === 'COMPLETED').length;
        return cp.length > 0 ? (cCompleted / cp.length) * 100 : 0;
      });
      const sitesPct = Math.round(childPcts.reduce((s, v) => s + v, 0) / childPcts.length);
      overallLabel = `Parent Initiation · Sites ${sitesPct}%`;
    } else {
      overallLabel = 'Parent Progress (Initiation)';
    }
  } else {
    const visible = project.phaseProgresses.filter((p) => p.status !== 'SKIPPED');
    const completed = visible.filter((p) => p.status === 'COMPLETED').length;
    pct = visible.length > 0 ? Math.round((completed / visible.length) * 100) : 0;
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>{overallLabel}</span>
        <span style={{ fontWeight: 700, color: pct === 100 ? '#1a7f37' : '#0969DA' }}>{pct}%</span>
      </div>
      {/* Bar */}
      <div style={{ height: 10, background: '#EAEEF2', borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: pct === 100 ? '#1a7f37' : '#0969DA',
            borderRadius: 5,
            transition: 'width 0.5s ease',
          }}
        />
      </div>
      {/* Phase stepper — Bulky: Initiation + Site Initiation only (Integra V3) */}
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', gap: 0, paddingBottom: 4 }}>
        {(isBulky ? BULKY_PHASES : stepperPhases).map((phase, idx, arr) => {
          const progress = project.phaseProgresses.find((p) => p.phase === phase);
          if (!progress) return null;
          const isLast = idx === arr.length - 1;
          return (
            <React.Fragment key={phase}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72, gap: 4 }}>
                <PhaseIcon status={progress.status} />
                <span
                  style={{
                    fontSize: 10,
                    textAlign: 'center',
                    color: progress.status === 'ACTIVE' ? '#0969DA' : progress.status === 'COMPLETED' ? '#1a7f37' : progress.status === 'SKIPPED' ? '#bbb' : '#8c959f',
                    fontWeight: progress.status === 'ACTIVE' ? 700 : 400,
                    lineHeight: 1.2,
                  }}
                >
                  {FTTT_PHASE_LABELS[phase]}
                </span>
              </div>
              {!isLast && (
                <div style={{ flex: 1, height: 2, minWidth: 8, background: progress.status === 'COMPLETED' ? '#1a7f37' : '#EAEEF2', margin: '0 2px', marginBottom: 14 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── Survey uploads section ───────────────────────────────────────────────────
// C7.1: Surveyor-only uploads; PM is reviewer/approver only
// C7.1: Removed "Foto" option; Catatan Lapangan is text-only; file-type validation per activity

const FILE_TYPE_LABELS: Record<string, string> = {
  supporting_file:   '📄 File Pendukung',
  survey_evidence:   '🔍 Bukti Survei',
  operational_notes: '📝 Catatan Lapangan',
};

// Accepted file formats per activity type
const FILE_ACCEPT: Record<string, string> = {
  supporting_file:   '.pdf,.doc,.docx,.xls,.xlsx,.kmz',
  survey_evidence:   '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.webp,.bmp,.tiff,.kmz',
  operational_notes: '',   // text-only — no file
};

function SurveySection({ project, onRefresh, continueMode = false }: { project: FtttProject; onRefresh: () => void; continueMode?: boolean }) {
  const { user } = useAuthStore();
  const [uploading, setUploading]     = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteCode, setNewSiteCode] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [siteBusy, setSiteBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // C7.1: default to supporting_file (Foto removed)
  const [fileType, setFileType] = useState<'supporting_file' | 'survey_evidence' | 'operational_notes'>('supporting_file');
  const [caption, setCaption]   = useState('');
  const [noteText, setNoteText] = useState('');  // C7.1: text-only for Catatan Lapangan

  const role       = user?.role ?? '';
  const isSurveyor = role === 'SURVEYOR_FTTT';
  // C7.1: PM is reviewer/approver only — no upload capability
  const isPM       = role === 'PM_FTTT' || role === 'ADMIN' || role === 'GENERAL_MANAGER';
  const canDelete  = ['SURVEYOR_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(role);
  const canManageSites = ['SURVEYOR_FTTT', 'PM_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(role);

  const surveyProg      = project.phaseProgresses.find((p) => p.phase === 'SURVEY');
  const surveyNotes     = surveyProg?.notes ?? null;
  const isPendingReview = surveyNotes === 'PENDING_PM_REVIEW';
  const isRejected      = typeof surveyNotes === 'string' && surveyNotes.startsWith('REJECTED:');
  const rejectionReason = isRejected ? surveyNotes.replace('REJECTED:', '') : '';
  const sites = project.surveySites ?? [];
  const sitesDone = sites.filter((s) => s.status === 'DONE').length;
  const sitesTotal = sites.length;
  const surveyComplete = sitesTotal > 0 && sitesDone === sitesTotal;

  // C7.1: Upload file (for supporting_file and survey_evidence)
  const handleUploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fileType', fileType);
    if (caption) fd.append('caption', caption);
    if (selectedSiteId) fd.append('siteId', selectedSiteId);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-uploads`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Dokumen berhasil diunggah');
      onRefresh();
      setCaption('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setUploading(false);
    }
  };

  // C7.1: Save text note (for operational_notes — no file, multipart with empty file field)
  const handleSaveNote = async () => {
    if (!noteText.trim()) { toast.error('Catatan tidak boleh kosong'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('fileType', 'operational_notes');
      fd.append('caption', noteText.trim());
      if (selectedSiteId) fd.append('siteId', selectedSiteId);
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-uploads`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal menyimpan catatan');
      toast.success('Catatan lapangan berhasil disimpan');
      onRefresh();
      setNoteText('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setUploading(false);
    }
  };

  const handleAddSite = async () => {
    if (!newSiteName.trim()) { toast.error('Nama site wajib diisi'); return; }
    setSiteBusy(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSiteName.trim(), code: newSiteCode.trim() || undefined }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Site ditambahkan');
      setNewSiteName(''); setNewSiteCode('');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSiteBusy(false); }
  };

  const handleMarkSite = async (siteId: string, status: 'PENDING' | 'DONE') => {
    setSiteBusy(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-sites/${siteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(status === 'DONE' ? 'Site ditandai selesai survey' : 'Status site dikembalikan');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSiteBusy(false); }
  };

  const handleDelete = async (uploadId: string, label: string) => {
    if (!confirm(`Hapus "${label}"?`)) return;
    setDeletingId(uploadId);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-uploads/${uploadId}`, { method: 'DELETE' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal hapus');
      toast.success('File berhasil dihapus');
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/submit-survey-review`, { method: 'POST' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Survei berhasil dikirim ke PM untuk direview');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSubmitting(false); }
  };

  const handlePMReview = async (approved: boolean) => {
    if (!approved && !rejectReason.trim()) { toast.error('Alasan penolakan wajib diisi'); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/review-survey`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, rejectionNotes: approved ? undefined : rejectReason.trim() }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(approved ? 'Survey disetujui — fase lanjut ke Preparation' : 'Survey ditolak — dikembalikan ke Surveyor');
      setShowRejectForm(false); setRejectReason('');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSubmitting(false); }
  };

  // Group uploads by fileType
  const grouped = project.surveyUploads.reduce<Record<string, typeof project.surveyUploads>>((acc, u) => {
    (acc[u.fileType] = acc[u.fileType] ?? []).push(u);
    return acc;
  }, {});

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
  };

  const isNoteType = fileType === 'operational_notes';

  return (
    <div>
      {/* Partial survey progress */}
      <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: '#0969DA' }}>
            Survey Progress{continueMode ? ' (berlanjut paralel)' : ''}
          </p>
          <span style={{ fontSize: 12, fontWeight: 700, color: surveyComplete ? '#1a7f37' : '#0969DA' }}>
            {sitesTotal === 0 ? 'Belum ada site' : `${sitesDone} / ${sitesTotal} site`}
            {surveyComplete ? ' · Completed' : ''}
          </span>
        </div>
        <div style={{ height: 8, background: '#D0D7DE', borderRadius: 999, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{
            height: '100%', width: `${sitesTotal ? Math.round((sitesDone / sitesTotal) * 100) : 0}%`,
            background: surveyComplete ? '#1a7f37' : '#0969DA', transition: 'width .2s',
          }} />
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: '#57606a' }}>
          Survey dapat dilakukan bertahap per site. Preparation dapat dilanjutkan tanpa menunggu seluruh site selesai.
        </p>
        {canManageSites && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} placeholder="Nama site (wajib)"
              style={{ flex: 1, minWidth: 140, padding: '6px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
            <input value={newSiteCode} onChange={(e) => setNewSiteCode(e.target.value)} placeholder="Kode (opsional)"
              style={{ width: 110, padding: '6px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
            <button type="button" disabled={siteBusy} onClick={() => void handleAddSite()}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              + Tambah Survey Site
            </button>
          </div>
        )}
        {sites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sites.map((s: FtttSurveySite) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #D0D7DE', borderRadius: 8, padding: '8px 10px' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {s.code ? `${s.code} · ` : ''}{s.name}
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: s.status === 'DONE' ? '#1a7f37' : '#9a6700', background: s.status === 'DONE' ? '#DAFBE1' : '#FFF8C5', padding: '1px 6px', borderRadius: 999 }}>
                      {s.status === 'DONE' ? 'Selesai' : 'Belum'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#8c959f' }}>{s._count?.uploads ?? 0} evidence</div>
                </div>
                {canManageSites && (
                  <button type="button" disabled={siteBusy}
                    onClick={() => void handleMarkSite(s.id, s.status === 'DONE' ? 'PENDING' : 'DONE')}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    {s.status === 'DONE' ? 'Batalkan' : 'Tandai Selesai'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Survey state banners */}
      {isPendingReview && (
        <div style={{ background: '#FFF8C5', border: '1px solid #d4a017', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 12, color: '#9a6700' }}>⏳ Menunggu Review PM FTTT</p>
          <p style={{ margin: 0, fontSize: 11, color: '#9a6700' }}>Surveyor telah mengirim hasil survey. PM FTTT dapat mereview dan menyetujui atau menolak di bawah. Site yang belum selesai tetap dapat dilanjutkan setelah Preparation.</p>
        </div>
      )}
      {isRejected && (
        <div style={{ background: '#FFEBE9', border: '1px solid #cf222e', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 12, color: '#cf222e' }}>❌ Survey Ditolak — Revisi Diperlukan</p>
          <p style={{ margin: 0, fontSize: 11, color: '#cf222e' }}>Alasan: {rejectionReason}</p>
          {isSurveyor && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#cf222e' }}>Harap perbaiki dokumen dan kirim ulang ke PM.</p>}
        </div>
      )}

      {/* C7.1: PM info banner — read-only, reviewer only */}
      {isPM && !isPendingReview && !isRejected && project.currentPhase === 'SURVEY' && (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#0969DA' }}>
          ℹ️ Pada fase Validation & Survey, PM berperan sebagai <strong>reviewer</strong>. Upload dokumen hanya dapat dilakukan oleh Surveyor FTTT. Survey bertahap diperbolehkan — Preparation dapat dilanjutkan tanpa menunggu seluruh site selesai.
        </div>
      )}

      {/* PM review panel — shown when pending review */}
      {isPM && isPendingReview && (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 12, color: '#0969DA' }}>📋 Review Hasil Validation & Survey</p>
          <p style={{ margin: '0 0 10px', fontSize: 11, color: '#57606a' }}>Periksa seluruh dokumen yang diunggah Surveyor di bawah, lalu tentukan keputusan:</p>
          {!showRejectForm ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void handlePMReview(true)} disabled={submitting}
                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                ✓ Setujui Survey
              </button>
              <button type="button" onClick={() => setShowRejectForm(true)}
                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#cf222e', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                ✗ Tolak Survey
              </button>
            </div>
          ) : (
            <div>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
                placeholder="Alasan penolakan (wajib diisi)…"
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #cf222e', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void handlePMReview(false)} disabled={submitting || !rejectReason.trim()}
                  style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: rejectReason.trim() ? '#cf222e' : '#D0D7DE', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {submitting ? '…' : 'Konfirmasi Tolak'}
                </button>
                <button type="button" onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontSize: 12 }}>Batal</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* C7.1: Upload form — Surveyor only; allow continue after phase advance */}
      {isSurveyor && (!isPendingReview || continueMode) && (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600 }}>Tambah Aktivitas Survey</p>

          {/* Activity type selector — C7.1: Foto removed */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <select value={fileType} onChange={(e) => setFileType(e.target.value as typeof fileType)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
              <option value="supporting_file">📄 File Pendukung</option>
              <option value="survey_evidence">🔍 Bukti Survei</option>
              <option value="operational_notes">📝 Catatan Lapangan</option>
            </select>
            {sites.length > 0 && (
              <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
                <option value="">— Site (opsional) —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.code ? `${s.code} · ` : ''}{s.name}</option>
                ))}
              </select>
            )}

            {/* File format hint — Integra V3: KMZ accepted on Validation & Survey */}
            <span style={{ fontSize: 11, color: '#8c959f', alignSelf: 'center' }}>
              {fileType === 'supporting_file' && 'Format: PDF, Word, Excel, KMZ'}
              {fileType === 'survey_evidence'  && 'Format: PDF, PNG, JPG, Word, Excel, KMZ'}
              {fileType === 'operational_notes' && 'Input teks — tidak perlu file'}
            </span>
          </div>

          {/* Caption for file types */}
          {!isNoteType && (
            <input value={caption} onChange={(e) => setCaption(e.target.value)}
              placeholder="Keterangan / nama dokumen (opsional)"
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
          )}

          {/* C7.1: Catatan Lapangan — text input only */}
          {isNoteType ? (
            <div>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4}
                placeholder="Tuliskan hasil observasi, temuan lapangan, atau informasi survey…"
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }} />
              <button type="button" onClick={() => void handleSaveNote()} disabled={uploading || !noteText.trim()}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: noteText.trim() ? '#0969DA' : '#D0D7DE', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                {uploading ? 'Menyimpan…' : '💾 Simpan Catatan'}
              </button>
            </div>
          ) : (
            /* C7.1: File upload with per-type accept filter */
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={fileRef} type="file" style={{ display: 'none' }}
                accept={FILE_ACCEPT[fileType]}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadFile(f); }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Upload size={13} /> {uploading ? 'Mengunggah…' : 'Upload'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Uploaded docs list */}
      {project.surveyUploads.length === 0 && (
        <p style={{ fontSize: 12, color: '#8c959f' }}>Belum ada dokumen survei diunggah.</p>
      )}
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#24292f' }}>
            {FILE_TYPE_LABELS[type] ?? type}
            <span style={{ fontWeight: 400, color: '#57606a', marginLeft: 6 }}>({items.length})</span>
          </p>
          {items.map((u) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', background: '#F6F8FA', borderRadius: 6, marginBottom: 4, border: '1px solid #EAEEF2' }}>
              <FileText size={13} color="#57606a" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* C7.1: Catatan Lapangan — show as text, no file link */}
                {type === 'operational_notes' ? (
                  <p style={{ margin: 0, fontSize: 12, color: '#24292f', whiteSpace: 'pre-wrap' }}>{u.caption || '—'}</p>
                ) : (
                  <a href={fixFileUrl(u.fileUrl)} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: '#0969DA', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.caption || u.originalFileName || u.fileUrl?.split('/').pop() || 'File'} <ExternalLink size={10} />
                  </a>
                )}
                <span style={{ fontSize: 10, color: '#8c959f' }}>
                  {fmtDateTime(u.createdAt)} · {u.uploadedBy.name}
                </span>
              </div>
              {canDelete && !isPendingReview && (
                <button type="button"
                  onClick={() => void handleDelete(u.id, u.caption || u.fileType)}
                  disabled={deletingId === u.id}
                  style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #cf222e', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  {deletingId === u.id ? '…' : '🗑'}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Surveyor submit-to-PM button — only while still on SURVEY phase */}
      {isSurveyor && !continueMode && !isPendingReview && project.surveyUploads.length > 0 && (
        <div style={{ marginTop: 12, padding: 10, background: '#DAFBE1', borderRadius: 8, border: '1px solid #2DA44E' }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1a7f37' }}>
            ✅ Siap lanjut Preparation? Kirim ke PM untuk direview (site yang belum selesai bisa dilanjutkan nanti).
          </p>
          <button type="button" onClick={() => void handleSubmitForReview()} disabled={submitting}
            style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {submitting ? 'Mengirim…' : '📤 Submit ke PM untuk Review'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Site Initiation section (Integra V1: Bulky project → child Sites) ───────
function SiteInitiationSection({
  project,
  onRefresh,
  userRole,
  monitoringOnly = false,
}: {
  project: FtttProject;
  onRefresh: () => void;
  userRole: string;
  /** Integra V3: after Site Initiation done, Parent is monitoring + child list only */
  monitoringOnly?: boolean;
}) {
  const { user } = useAuthStore();
  const canManage = !monitoringOnly && (userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER' || userRole === 'PM_FTTT');
  const [sites, setSites] = useState<FtttSiteSummary[]>([]);
  const [available, setAvailable] = useState<FinanceSiteOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFinanceSiteId, setSelectedFinanceSiteId] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sitesRes, availRes] = await Promise.all([
        apiFetch(`/fttt-projects/${project.id}/sites`, { method: 'GET' }, user?.id),
        canManage
          ? apiFetch(`/fttt-projects/${project.id}/available-finance-sites`, { method: 'GET' }, user?.id)
          : Promise.resolve(null),
      ]);
      setSites(sitesRes.ok ? await sitesRes.json() : []);
      setAvailable(availRes && availRes.ok ? await availRes.json() : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [project.id, user?.id, canManage]);
  useEffect(() => { void load(); }, [load]);

  const fmtIDR = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

  const handleAddSite = async () => {
    if (!selectedFinanceSiteId) { toast.error('Pilih Finance Site terlebih dahulu'); return; }
    setAdding(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/sites`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ financeProjectId: selectedFinanceSiteId }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal menambahkan site');
      toast.success('Site berhasil ditambahkan');
      setSelectedFinanceSiteId('');
      void load(); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setAdding(false); }
  };

  const handleDeleteSite = async (siteId: string) => {
    if (!confirm('Hapus site ini?')) return;
    setDeletingId(siteId);
    try {
      const res = await apiFetch(`/fttt-projects/sites/${siteId}`, { method: 'DELETE' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal menghapus site');
      toast.success('Site dihapus');
      void load(); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setDeletingId(null); }
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {monitoringOnly ? '📍 Daftar Child Project (Site)' : '📍 Site Initiation'}
      </p>
      <p style={{ fontSize: 12, color: '#57606a', marginBottom: 12 }}>
        {monitoringOnly
          ? 'Parent Project berfungsi sebagai monitoring. Buka masing-masing Site untuk lifecycle operasional (Survey → Closing).'
          : 'Project ini bersifat Bulky (gabungan beberapa Site). Tambahkan Site yang akan dikerjakan — setiap Site terhubung ke Finance Site (Segment) masing-masing.'}
      </p>

      {canManage && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <select value={selectedFinanceSiteId} onChange={(e) => setSelectedFinanceSiteId(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: '7px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
            <option value="">— Pilih Finance Site —</option>
            {available.map((fs) => (
              <option key={fs.id} value={fs.id}>{fs.code} · {fs.name} ({fmtIDR(Number(fs.totalBudget))})</option>
            ))}
          </select>
          <button type="button" disabled={adding || !selectedFinanceSiteId} onClick={() => void handleAddSite()}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: adding ? 'not-allowed' : 'pointer', fontSize: 12 }}>
            {adding ? 'Menambahkan…' : '+ Add Site'}
          </button>
        </div>
      )}
      {canManage && available.length === 0 && !loading && (
        <p style={{ fontSize: 11, color: '#8c959f', marginTop: -8, marginBottom: 12 }}>Tidak ada Finance Site yang tersedia untuk ditambahkan.</p>
      )}

      {loading ? (
        <p style={{ fontSize: 12, color: '#8c959f' }}>Memuat…</p>
      ) : sites.length === 0 ? (
        <p style={{ fontSize: 12, color: '#8c959f' }}>Belum ada Site.</p>
      ) : (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 10, overflow: 'hidden' }}>
          {sites.map((s) => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #F0F3F6' }}>
              <div>
                <Link href={`/fttt-projects/${s.id}`} style={{ fontWeight: 600, fontSize: 13, color: '#0969DA', textDecoration: 'none' }}>
                  {s.projectName ?? `Site ${s.id.slice(-6).toUpperCase()}`}
                </Link>
                <div style={{ fontSize: 11, color: '#57606a', marginTop: 2 }}>
                  {FTTT_PHASE_LABELS[s.currentPhase]} · {s.financeProject ? `${s.financeProject.code} · ${s.financeProject.name}` : 'Belum terhubung Finance Site'}
                  {s.pm?.name ? ` · PM: ${s.pm.name}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Link href={`/fttt-projects/${s.id}`} style={{ fontSize: 11, color: '#0969DA' }}>Lihat ↗</Link>
                {canManage && (
                  <button type="button" disabled={deletingId === s.id} onClick={() => void handleDeleteSite(s.id)}
                    style={{ fontSize: 11, color: '#cf222e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {deletingId === s.id ? 'Menghapus…' : 'Delete Site'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DRM section (PST only) ───────────────────────────────────────────────────
function DrmSection({ project, onRefresh }: { project: FtttProject; onRefresh: () => void }) {
  const { user } = useAuthStore();
  const [uploading, setUploading] = useState(false);
  const [activeDocType, setActiveDocType] = useState('BOQ_INITIAL');
  const [notes, setNotes] = useState('');
  const [replaceType, setReplaceType] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const canEdit = ['PM_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(user?.role ?? '');

  const handleUpload = async (file: File, typeOverride?: string) => {
    const type = typeOverride ?? activeDocType;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', type);
    if (notes) fd.append('notes', notes);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/drm-documents`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Dokumen berhasil diunggah / diganti');
      onRefresh();
      setNotes('');
      setReplaceType(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setUploading(false);
    }
  };

  // Group by docType, latest version per type
  const grouped = project.drmDocuments.reduce<Record<string, typeof project.drmDocuments>>((acc, d) => {
    (acc[d.docType] = acc[d.docType] ?? []).push(d);
    return acc;
  }, {});

  const DRM_LABELS: Record<string, string> = {
    BOQ_INITIAL: 'BOQ Awal', TOS_INITIAL: 'TOS Awal', DRM_RESULT: 'Hasil DRM', ACTUAL: 'Aktual',
  };

  const REQUIRED_TYPES = ['BOQ_INITIAL', 'DRM_RESULT'];
  const uploadedTypes = new Set(Object.keys(grouped));

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>DRM Management — Riwayat Dokumen</p>

      {/* Uploaded docs with Ganti button — C7-PST5 */}
      {Object.entries(grouped).map(([type, docs]) => {
        const latest = docs[docs.length - 1];
        return (
          <div key={type} style={{ background: '#F0FFF8', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 12 }}>✓ {DRM_LABELS[type] ?? type}</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {docs.map((d) => (
                    <a key={d.id} href={fixFileUrl(d.fileUrl)} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, textDecoration: 'none', color: '#0969DA', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <FileText size={11} /> v{d.version} <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
                {latest.uploadedBy && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {latest.uploadedBy.name}</p>}
              </div>
              {canEdit && (
                <>
                  <input ref={replaceRef} type="file" accept=".xlsx,.xls,.pdf,.doc,.docx" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f && replaceType) void handleUpload(f, replaceType); }} />
                  <button type="button"
                    onClick={() => { setReplaceType(type); replaceRef.current?.click(); }}
                    disabled={uploading}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #FFA500', background: '#FFF8F0', color: '#7d5a00', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {uploading && replaceType === type ? '…' : '🔄 Ganti'}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* Missing required docs */}
      {REQUIRED_TYPES.filter((t) => !uploadedTypes.has(t)).map((t) => (
        <div key={t} style={{ background: '#FFEBE9', border: '1px solid #cf222e', borderRadius: 8, padding: 10, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠️</span>
          <p style={{ margin: 0, fontSize: 12, color: '#cf222e', fontWeight: 600 }}>{DRM_LABELS[t] ?? t} — belum diunggah</p>
        </div>
      ))}

      {/* Upload new doc form */}
      {canEdit && (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600 }}>Upload Dokumen DRM</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <select value={activeDocType} onChange={(e) => setActiveDocType(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
              <option value="BOQ_INITIAL">BOQ Awal</option>
              <option value="DRM_RESULT">Hasil DRM</option>
              <option value="TOS_INITIAL">TOS Awal</option>
              <option value="ACTUAL">Aktual</option>
            </select>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan (opsional)"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 120 }} />
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf,.doc,.docx" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
            {uploading ? 'Mengunggah…' : '+ Upload'}
          </button>
        </div>
      )}

      {project.drmDocuments.length === 0 && !canEdit && <p style={{ fontSize: 12, color: '#8c959f' }}>Belum ada dokumen DRM.</p>}
    </div>
  );
}

// ─── Sanggah section (iForte only) ───────────────────────────────────────────
function SanggahSection({ project, onRefresh, isAdmin }: { project: FtttProject; onRefresh: () => void; isAdmin: boolean }) {
  const { user } = useAuthStore();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const canSubmit = project.sanggahs.length < 2;

  const handleSubmit = async () => {
    if (!reason.trim()) { toast.error('Alasan wajib diisi'); return; }
    const fd = new FormData();
    fd.append('reason', reason);
    if (selectedFile) fd.append('file', selectedFile);
    setSubmitting(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/sanggah`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Sanggah berhasil diajukan');
      setReason(''); setSelectedFile(null);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (sanggahId: string, status: 'ACCEPTED' | 'REJECTED') => {
    const res = await apiFetch(`/fttt-projects/sanggah/${sanggahId}/resolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }, user?.id);
    if (res.ok) { toast.success('Sanggah diperbarui'); onRefresh(); }
  };

  const statusColors: Record<string, string> = { SUBMITTED: '#9a6700', ACCEPTED: '#1a7f37', REJECTED: '#cf222e' };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        Sanggah Management ({project.sanggahs.length}/2)
      </p>
      {project.sanggahs.map((s) => (
        <div key={s.id} style={{ background: '#F6F8FA', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Percobaan ke-{s.attemptNumber}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[s.status] }}>{s.status}</span>
          </div>
          <p style={{ fontSize: 12, margin: '0 0 4px' }}>{s.reason}</p>
          {s.fileUrl && (
            <a href={fixFileUrl(s.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>
              Lihat dokumen →
            </a>
          )}
          {isAdmin && s.status === 'SUBMITTED' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => void handleResolve(s.id, 'ACCEPTED')} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#DAFBE1', color: '#1a7f37', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Terima</button>
              <button onClick={() => void handleResolve(s.id, 'REJECTED')} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: '#FFEBE9', color: '#cf222e', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Tolak</button>
            </div>
          )}
        </div>
      ))}
      {canSubmit && (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px' }}>Ajukan Sanggah Baru</p>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={3} placeholder="Alasan sanggah (minimal 10 karakter)…"
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
            <button onClick={() => fileRef.current?.click()} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, cursor: 'pointer', background: '#F6F8FA' }}>
              {selectedFile ? selectedFile.name.slice(0, 20) + '…' : '+ Lampiran'}
            </button>
            <button onClick={handleSubmit} disabled={submitting} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              {submitting ? 'Mengirim…' : 'Kirim Sanggah'}
            </button>
          </div>
        </div>
      )}
      {!canSubmit && <p style={{ fontSize: 12, color: '#8c959f' }}>Batas maksimal 2 pengajuan sanggah telah tercapai.</p>}
    </div>
  );
}

// ─── Jaminan section (Telkom Infra only, upload restricted to Finance) ────────
// Issue #3: prevent duplicates — show Replace for existing, only show types not yet uploaded
function JaminanSection({ project, onRefresh }: { project: FtttProject; onRefresh: () => void }) {
  const { user } = useAuthStore();
  const isFinance = user?.role === 'FINANCE' || user?.role === 'ADMIN' || user?.role === 'GENERAL_MANAGER';

  const ALL_TYPES = ['JAMINAN_UANG_MUKA', 'JAMINAN_PELAKSANAAN'] as const;
  type JType = typeof ALL_TYPES[number];
  const JAMINAN_LABELS: Record<JType, string> = { JAMINAN_UANG_MUKA: 'Jaminan Uang Muka', JAMINAN_PELAKSANAAN: 'Jaminan Pelaksanaan' };

  // Already uploaded types
  const uploadedTypes = new Set(project.jaminans.map((j) => j.jaminanType as JType));
  const missingTypes = ALL_TYPES.filter((t) => !uploadedTypes.has(t));
  const allUploaded = missingTypes.length === 0;

  const [activeType, setActiveType] = useState<JType>(missingTypes[0] ?? ALL_TYPES[0]);
  const [replaceFor, setReplaceFor] = useState<JType | null>(null);  // which type we're replacing
  const [issuer, setIssuer] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // FIX: sync activeType when jaminans change (e.g., after first upload completes).
  // Without this, activeType stays stale ('JAMINAN_UANG_MUKA') even after Uang Muka
  // was successfully uploaded, causing the next upload to overwrite the wrong slot.
  React.useEffect(() => {
    if (missingTypes.length > 0 && !missingTypes.includes(activeType)) {
      setActiveType(missingTypes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.jaminans.length]);

  const handleUpload = async (typeOverride?: JType) => {
    // Always derive the effective type from current missingTypes to guard against stale state
    const type = typeOverride ?? (missingTypes.includes(activeType) ? activeType : missingTypes[0] ?? activeType);
    const fd = new FormData();
    fd.append('jaminanType', type);
    if (issuer) fd.append('issuer', issuer);
    if (notes) fd.append('notes', notes);
    if (selectedFile) fd.append('file', selectedFile);
    setSubmitting(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/jaminan`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      const isReplace = uploadedTypes.has(type);
      toast.success(isReplace ? 'Dokumen berhasil diganti' : 'Jaminan berhasil diunggah');
      setIssuer(''); setNotes(''); setSelectedFile(null); setReplaceFor(null);
      onRefresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Header — mandatory indicator */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
          Dokumen Jaminan ({project.jaminans.length}/2)
          {allUploaded
            ? <span style={{ marginLeft: 8, fontSize: 11, color: '#1a7f37', fontWeight: 600 }}>✓ Lengkap</span>
            : <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#cf222e', padding: '1px 6px', background: '#FFEBE9', borderRadius: 999 }}>WAJIB — {missingTypes.length} belum diisi</span>
          }
        </p>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#57606a' }}>
        Kedua dokumen Jaminan merupakan syarat <strong>wajib</strong> sebelum fase Preparation dapat diselesaikan. Diisi oleh Finance.
      </p>

      {/* Show uploaded jaminans */}
      {project.jaminans.map((j) => (
        <div key={j.id} style={{ background: '#F0FFF8', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 12 }}>✓ {JAMINAN_LABELS[j.jaminanType as JType] ?? j.jaminanType}</p>
            {j.issuer && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{j.issuer}</p>}
            {j.notes  && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{j.notes}</p>}
            <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {j.uploadedBy.name}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {j.fileUrl && <a href={fixFileUrl(j.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat File</a>}
            {isFinance && (
              <button type="button"
                onClick={() => { setReplaceFor(j.jaminanType as JType); setActiveType(j.jaminanType as JType); setSelectedFile(null); setIssuer(j.issuer ?? ''); setNotes(j.notes ?? ''); }}
                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer' }}>
                Edit / Ganti
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Show missing types as mandatory pending */}
      {missingTypes.map((t) => (
        <div key={t} style={{ background: '#FFEBE9', border: '1px solid #cf222e', borderRadius: 8, padding: 10, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <div>
            <p style={{ margin: 0, fontSize: 12, color: '#cf222e', fontWeight: 600 }}>{JAMINAN_LABELS[t]}</p>
            <p style={{ margin: 0, fontSize: 10, color: '#cf222e' }}>Dokumen WAJIB — belum diisi oleh Finance</p>
          </div>
        </div>
      ))}

      {/* Upload / Edit form — Finance only */}
      {isFinance && (
        <>
          {(missingTypes.length > 0 || replaceFor !== null) && (
            <div style={{ border: `1px solid ${replaceFor ? '#FFA500' : '#D0D7DE'}`, borderRadius: 8, padding: 12, marginTop: 8, background: replaceFor ? '#FFFBF0' : '#fff' }}>
              <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 6px', color: replaceFor ? '#7d5a00' : '#24292f' }}>
                {replaceFor ? `Edit Jaminan: ${JAMINAN_LABELS[replaceFor]}` : 'Upload Jaminan'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {!replaceFor && (
                  <select value={activeType} onChange={(e) => setActiveType(e.target.value as JType)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
                    {missingTypes.map((t) => <option key={t} value={t}>{JAMINAN_LABELS[t]}</option>)}
                  </select>
                )}
                <input value={issuer} onChange={(e) => setIssuer(e.target.value)}
                  placeholder="Penerbit / bank / lembaga penjamin"
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 140 }} />
              </div>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Nomor dokumen / nilai jaminan / catatan lain (opsional)"
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
                {/* FIX C4: Rename from "Lampiran (opsional)" → clear upload button */}
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, cursor: 'pointer', background: '#F6F8FA' }}>
                  {selectedFile ? '📎 ' + selectedFile.name.slice(0, 20) + '…' : '📎 Upload File Jaminan'}
                </button>
                {/* FIX C4: Remove "Kirim ke PM" — Jaminan has no PM review/approval flow */}
                <button type="button" onClick={() => { void handleUpload(replaceFor ?? undefined); }} disabled={submitting}
                  style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: replaceFor ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {submitting ? 'Menyimpan…' : replaceFor ? '🔄 Perbarui Jaminan' : '+ Upload Jaminan'}
                </button>
                {replaceFor && (
                  <button type="button" onClick={() => { setReplaceFor(null); setSelectedFile(null); setIssuer(''); setNotes(''); }}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Batal</button>
                )}
              </div>
            </div>
          )}
          {allUploaded && !replaceFor && (
            <p style={{ fontSize: 11, color: '#57606a', marginTop: 8 }}>Kedua dokumen sudah diisi. Klik "Edit / Ganti" pada dokumen yang perlu diperbarui.</p>
          )}
        </>
      )}

      {/* Non-Finance info box */}
      {!isFinance && missingTypes.length > 0 && (
        <div style={{ background: '#FFF8C5', border: '1px solid #d4a017', borderRadius: 8, padding: 10, marginTop: 6, fontSize: 12, color: '#9a6700' }}>
          ⏳ Menunggu Finance mengisi dokumen Jaminan yang wajib sebelum fase ini dapat diselesaikan.
        </div>
      )}
    </div>
  );
}

// ─── Documentation & Acceptance — per-lifecycle card-based section ───────────
// Admin Project uploads; PM FTTT reviews and approves/rejects.
// ─── iFORTE Project Preparation: Supporting Document (Opsional) ───────────────
// Upload PDF/Excel sebagai referensi project; BUKAN syarat lanjut fase.
// Admin Project upload → PM FTTT review/approval. Material tidak dikelola di PermaTrax.
// Integra V1: generalized for all companies (was iFORTE-only) — optional supporting
// document upload/approval on the Preparation phase
function SupportingDocSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const canUpload = userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER';
  const canPmApprove = userRole === 'PM_FTTT';
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const doc = project.reconDocs?.find((d) => d.docKey === 'SUPPORTING_DOC_IFORTE') ?? null;

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('docKey', 'SUPPORTING_DOC_IFORTE');
      if (notes) fd.append('notes', notes);
      fd.append('file', file);
      const res = await apiFetch(`/fttt-projects/${project.id}/recon-docs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Supporting Document tersimpan — menunggu review PM FTTT');
      setNotes(''); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); }
  };

  const handleApprove = async (approved: boolean) => {
    if (!doc) return;
    if (!approved && !rejectReason.trim()) { toast.error('Alasan penolakan wajib diisi'); return; }
    try {
      const res = await apiFetch(`/fttt-projects/recon-docs/${doc.id}/approve`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, rejectionNotes: approved ? undefined : rejectReason.trim() }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(approved ? 'Supporting Document disetujui' : 'Supporting Document ditolak');
      setRejectOpen(false); setRejectReason(''); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
  };

  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>📎 Supporting Document (Opsional)</p>
      <p style={{ fontSize: 12, color: '#57606a', marginBottom: 12 }}>
        Admin Project mengunggah dokumen pendukung (PDF / Excel) sebagai referensi. PM FTTT melakukan review &amp; approval.
        Upload bersifat opsional — fase dapat dilanjutkan tanpa dokumen ini.
      </p>

      {doc ? (
        <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Supporting Document terunggah</span>
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: STATUS_COLORS[doc.approvalStatus] ?? '#57606a' }}>
                {STATUS_LABELS[doc.approvalStatus] ?? doc.approvalStatus}
              </span>
              {doc.notes && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>📝 {doc.notes}</p>}
              {doc.rejectionNotes && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#cf222e' }}>Alasan: {doc.rejectionNotes}</p>}
              {doc.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {doc.uploadedBy.name}</p>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {doc.fileUrl && <a href={fixFileUrl(doc.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
              {canUpload && (doc.approvalStatus === 'REJECTED' || doc.approvalStatus === 'APPROVED') && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#FFA500', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                  {uploading ? '…' : '🔄 Ganti'}
                </button>
              )}
            </div>
          </div>
          {canPmApprove && doc.approvalStatus === 'PENDING_PM' && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => void handleApprove(true)}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                ✓ Setujui
              </button>
              {!rejectOpen ? (
                <button type="button" onClick={() => setRejectOpen(true)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#cf222e', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                  ✕ Tolak
                </button>
              ) : (
                <>
                  <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Alasan penolakan…"
                    style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
                  <button type="button" onClick={() => void handleApprove(false)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#cf222e', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                    Konfirmasi Tolak
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : canUpload ? (
        <div style={{ border: '1.5px dashed #D0D7DE', borderRadius: 10, padding: 14, marginBottom: 10, background: '#F9FAFB' }}>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan dokumen (opsional)…"
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
            {uploading ? 'Mengunggah…' : '+ Upload Supporting Document (PDF / Excel)'}
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: '#57606a', marginBottom: 10 }}>Belum ada Supporting Document. Hanya Admin Project yang dapat mengunggah.</p>
      )}
      <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />
      <p style={{ fontSize: 11, color: '#8c959f' }}>
        ✅ Fase Project Preparation dapat diselesaikan kapan saja — Supporting Document bukan persyaratan.
      </p>
    </div>
  );
}

function DocumentationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  // Admin uploads; PM FTTT reviews/approves/rejects
  const canUploadDocs  = userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER';
  const canReplaceDocs = userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER';
  const canPmApprove   = userRole === 'PM_FTTT';
  const canAdminApprove = false; // PM is now final approver — no Admin approval step

  // Per-doc state maps: key → value
  const [formContents, setFormContents] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<string | null>(null);
  const [rejectReason, setRejectReason]   = useState('');
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', PENDING_ADMIN: '#0969DA', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', PENDING_ADMIN: 'Menunggu Admin', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  // Get required docs for this project's company
  const requiredDocs = DOCUMENTATION_DOCS[project.ftttCompany] ?? [];

  // For each required doc key, find the LATEST submitted document (desc order from API)
  const latestDocFor = (key: string) => project.documents.find((d) => d.docType === key) ?? null;

  // Count how many required docs are APPROVED
  const approvedKeys = new Set(project.documents.filter((d) => d.approvalStatus === 'APPROVED').map((d) => d.docType));
  const allDone = requiredDocs.filter((d) => d.required).every((d) => (approvedKeys as Set<string>).has(d.key));

  const handleUpload = async (docKey: string, file: File) => {
    setUploadingKey(docKey);
    const fd = new FormData();
    fd.append('docType', docKey);
    fd.append('file', file);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/documents`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen berhasil diunggah'); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleGenerateForm = async (docKey: string) => {
    const content = formContents[docKey]?.trim();
    if (!content) { toast.error('Isi dokumen wajib diisi'); return; }
    setUploadingKey(docKey);
    const fd = new FormData();
    fd.append('docType', docKey);
    fd.append('formContent', content);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/documents`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen disimpan — menunggu persetujuan PM');
      setFormContents((prev) => ({ ...prev, [docKey]: '' }));
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleReplaceFile = async (docId: string, file: File) => {
    setUploadingKey(docId);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await apiFetch(`/fttt-projects/documents/${docId}/replace`, { method: 'PUT', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen diganti — menunggu review PM'); setReplacingDocId(null); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleReplaceForm = async (docId: string, docKey: string) => {
    const content = formContents[docKey]?.trim();
    if (!content) { toast.error('Isi dokumen wajib diisi'); return; }
    setUploadingKey(docKey);
    const fd = new FormData();
    fd.append('formContent', content);
    try {
      const res = await apiFetch(`/fttt-projects/documents/${docId}/replace`, { method: 'PUT', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen diperbarui — menunggu review PM');
      setFormContents((prev) => ({ ...prev, [docKey]: '' }));
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleApprove = async (docId: string, approved: boolean, rejectionNotes?: string) => {
    const res = await apiFetch(`/fttt-projects/documents/${docId}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, rejectionNotes }),
    }, user?.id);
    if (res.ok) { toast.success(approved ? 'Dokumen disetujui' : 'Dokumen ditolak'); onRefresh(); }
    else { const e = await res.json().catch(() => ({})); toast.error((e as { message?: string }).message ?? 'Gagal'); }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>
            Dokumen Documentation & Acceptance
            <span style={{ marginLeft: 8, fontSize: 11, color: '#57606a' }}>
              ({approvedKeys.size}/{requiredDocs.length} disetujui)
            </span>
            {allDone && <span style={{ marginLeft: 8, fontSize: 11, color: '#1a7f37', fontWeight: 700 }}>✓ Semua Lengkap</span>}
          </p>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: '#EDF2F4', color: '#57606a', fontWeight: 600 }}>
            {project.ftttCompany === 'TELKOM_INFRA' ? 'Telkom Infra' : project.ftttCompany === 'PST' ? 'PST' : 'iFORTE'}
          </span>
        </div>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>
          Dokumen dikonfigurasi sesuai lifecycle {project.ftttCompany === 'TELKOM_INFRA' ? 'Telkom Infra' : project.ftttCompany === 'PST' ? 'PST' : 'iFORTE'}.
          Upload dokumen dilakukan oleh Admin Project; review dan approval oleh PM FTTT.
        </p>
      </div>

      {/* Required doc cards */}
      {requiredDocs.map((doc) => {
        const latestDoc = latestDocFor(doc.key);
        const isUploading = uploadingKey === doc.key;
        const isApproved  = latestDoc?.approvalStatus === 'APPROVED';
        const isRejected  = latestDoc?.approvalStatus === 'REJECTED';
        const isPendingPm = latestDoc?.approvalStatus === 'PENDING_PM';
        const isPendingAdmin = latestDoc?.approvalStatus === 'PENDING_ADMIN';

        return (
          <div key={doc.key} style={{
            background: isApproved ? '#F0FFF4' : isRejected ? '#FFF5F5' : '#F6F8FA',
            border: `1px solid ${isApproved ? '#2DA44E' : isRejected ? '#cf222e' : '#EAEEF2'}`,
            borderRadius: 10, padding: 12, marginBottom: 10,
          }}>
            {/* Doc header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{doc.label}</span>
                  {doc.required && !isApproved && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: '#FFEBE9', color: '#cf222e' }}>WAJIB</span>
                  )}
                  {doc.generateForm && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: '#DDF4FF', color: '#0969DA' }}>Generate Form</span>
                  )}
                  {latestDoc && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[latestDoc.approvalStatus] }}>
                      {STATUS_LABELS[latestDoc.approvalStatus]}
                    </span>
                  )}
                  {!latestDoc && <span style={{ fontSize: 10, color: '#8c959f' }}>Belum diunggah</span>}
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{doc.desc}</p>

                {/* Submitted doc details */}
                {latestDoc?.notes && <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>📝 {latestDoc.notes}</p>}
                {latestDoc?.formContent && (
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#24292f', background: '#F0F8FF', padding: '4px 6px', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                    {latestDoc.formContent.length > 150 ? latestDoc.formContent.slice(0, 150) + '…' : latestDoc.formContent}
                  </p>
                )}
                {isRejected && latestDoc?.rejectionNotes && (
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: '#cf222e', fontStyle: 'italic' }}>
                    Ditolak: {latestDoc.rejectionNotes}
                  </p>
                )}
                {latestDoc?.uploadedBy && (
                  <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {latestDoc.uploadedBy.name}</p>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {latestDoc?.fileUrl && (
                  <a href={fixFileUrl(latestDoc.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>
                )}

                {/* PM approve/reject */}
                {canPmApprove && isPendingPm && (
                  <>
                    <button type="button" onClick={() => void handleApprove(latestDoc!.id, true)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓</button>
                    <button type="button" onClick={() => { setRejectTarget(latestDoc!.id); setRejectReason(''); }}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗</button>
                  </>
                )}

                {/* Admin approve/reject */}
                {canAdminApprove && isPendingAdmin && (
                  <>
                    <button type="button" onClick={() => void handleApprove(latestDoc!.id, true)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Setujui</button>
                    <button type="button" onClick={() => { setRejectTarget(latestDoc!.id); setRejectReason(''); }}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗ Tolak</button>
                  </>
                )}

                {/* Replace rejected Upload doc */}
                {canReplaceDocs && isRejected && !doc.generateForm && (
                  <>
                    <input ref={(el) => { replaceRefs.current[doc.key] = el; }} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReplaceFile(latestDoc!.id, f); }} />
                    <button type="button" onClick={() => replaceRefs.current[doc.key]?.click()} disabled={isUploading}
                      style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #FFA500', background: '#FFF8F0', color: '#7d5a00', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      {isUploading ? '…' : '🔄 Upload Ulang'}
                    </button>
                  </>
                )}

                {/* Upload NEW Upload doc (not yet submitted or approved) */}
                {canUploadDocs && !doc.generateForm && !latestDoc && (
                  <>
                    <input ref={(el) => { fileRefs.current[doc.key] = el; }} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(doc.key, f); }} />
                    <button type="button" onClick={() => fileRefs.current[doc.key]?.click()} disabled={isUploading}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {isUploading ? '…' : '+ Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Generate Form textarea — shown when not yet submitted OR rejected */}
            {doc.generateForm && canUploadDocs && (!latestDoc || isRejected) && (
              <div style={{ marginTop: 10, padding: 10, background: '#F0F8FF', borderRadius: 8, border: '1px dashed #0969DA' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#0969DA' }}>
                  📝 {isRejected ? 'Isi Ulang Dokumen (setelah ditolak)' : 'Isi Konten Dokumen'}
                </p>
                <textarea
                  value={formContents[doc.key] ?? ''}
                  onChange={(e) => setFormContents((prev) => ({ ...prev, [doc.key]: e.target.value }))}
                  rows={4}
                  placeholder={`Masukkan isi ${doc.label}…\n(tanggal, nomor dokumen, pihak terlibat, poin-poin utama, dll.)`}
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #0969DA', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }}
                />
                <button type="button"
                  onClick={() => {
                    if (isRejected && latestDoc) void handleReplaceForm(latestDoc.id, doc.key);
                    else void handleGenerateForm(doc.key);
                  }}
                  disabled={isUploading || !(formContents[doc.key]?.trim())}
                  style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: formContents[doc.key]?.trim() ? '#0969DA' : '#D0D7DE', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {isUploading ? 'Menyimpan…' : isRejected ? '🔄 Kirim Ulang' : '✉️ Kirim ke PM'}
                </button>
              </div>
            )}

            {/* Approved state — show form content summary if any */}
            {isApproved && latestDoc?.formContent && !latestDoc.notes && (
              <p style={{ margin: '6px 0 0', fontSize: 10, color: '#57606a' }}>
                Form content tersimpan — tanda tangan akan muncul pada dokumen resmi.
              </p>
            )}
          </div>
        );
      })}

      {/* Rejection reason dialog */}
      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#cf222e' }}>Alasan Penolakan</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#57606a' }}>
              Berikan alasan yang jelas agar PM FTTT dapat melakukan perbaikan dan upload ulang dokumen.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Tuliskan alasan penolakan… (wajib diisi)"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${rejectReason.trim() ? '#D0D7DE' : '#cf222e'}`, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Batal</button>
              <button type="button" onClick={() => { if (rejectReason.trim()) { void handleApprove(rejectTarget, false, rejectReason.trim()); setRejectTarget(null); setRejectReason(''); } }}
                disabled={!rejectReason.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectReason.trim() ? '#cf222e' : '#8C959F', color: '#fff', fontWeight: 600, cursor: rejectReason.trim() ? 'pointer' : 'not-allowed', fontSize: 13 }}>
                Konfirmasi Tolak
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info for PM — review-only notice */}
      {canPmApprove && !canUploadDocs && (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 8, padding: 10, marginTop: 6, fontSize: 12, color: '#0969DA' }}>
          ℹ️ Anda dapat mereview dan approve/reject dokumen pada setiap card di atas. Upload dokumen baru hanya dapat dilakukan oleh Admin Project.
        </div>
      )}
    </div>
  );
}

// ─── Implementation phase section ─────────────────────────────────────────────
// C5-Issue4: MONITORING_DOC is Admin-only; Surveyor+PM can only upload photos+notes
// ─── Folder-based Daily Implementation Log (Galian: Span / KU: Folder KU) ─────
const SPAN_LOG_CATEGORY_LABELS: Record<string, string> = {
  GALIAN: 'Galian', VIDEO_GALIAN: 'Video Galian', PERBAIKAN: 'Perbaikan',
  HANDHOLE: 'Handhole', JEMBATAN: 'Jembatan', JOIN_TERMINASI: 'Join Terminasi', MARKING_POS: 'Marking Pos',
  // Integra V2: Kabel Udara (KU) activities
  PENARIKAN_KABEL: 'Penarikan Kabel', PENANAMAN_TIANG: 'Penanaman Tiang',
};
// Integra V2: category options differ per Metode Implementasi
const GALIAN_LOG_CATEGORIES = ['GALIAN', 'VIDEO_GALIAN', 'PERBAIKAN', 'HANDHOLE', 'JEMBATAN', 'JOIN_TERMINASI', 'MARKING_POS'];
const KU_LOG_CATEGORIES = ['PENARIKAN_KABEL', 'PENANAMAN_TIANG', 'JOIN_TERMINASI'];

function SpanSection({ project, onRefresh, isAdmin, canLog, mode }: { project: FtttProject; onRefresh: () => void; isAdmin: boolean; canLog?: boolean; mode?: 'GALIAN' | 'KU' }) {
  const { user } = useAuthStore();
  const isKu = mode === 'KU';
  const itemLabel = isKu ? 'Folder KU' : 'Span';
  const logCategories = isKu ? KU_LOG_CATEGORIES : GALIAN_LOG_CATEGORIES;
  const spans: FtttSpan[] = project.spans ?? [];
  const [newSpanNumber, setNewSpanNumber] = useState('');
  // Integra V2: panjang folder (meter) — diisi sekali saat buat Span/Folder KU
  const [newSpanLength, setNewSpanLength] = useState('');
  const [creatingSpan, setCreatingSpan] = useState(false);
  const [expandedSpan, setExpandedSpan] = useState<string | null>(null);
  const [uploadingLog, setUploadingLog] = useState<string | null>(null);
  const [logCategory, setLogCategory] = useState<string>(isKu ? 'PENARIKAN_KABEL' : 'GALIAN');
  useEffect(() => { setLogCategory(isKu ? 'PENARIKAN_KABEL' : 'GALIAN'); }, [isKu]);
  const [logCaption, setLogCaption] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const logFileRef = useRef<HTMLInputElement>(null);
  const logFolderRef = useRef<HTMLInputElement>(null);
  // iFORTE: PM/Surveyor juga boleh mengisi Daily Log (backend memvalidasi role)
  const mayLog = canLog ?? isAdmin;

  const handleCreateSpan = async () => {
    if (!newSpanNumber.trim()) return;
    const lengthVal = Number(newSpanLength);
    if (newSpanLength.trim() === '' || Number.isNaN(lengthVal) || lengthVal <= 0) {
      toast.error(`Isi panjang pekerjaan (meter) untuk ${itemLabel} ini`);
      return;
    }
    setCreatingSpan(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/spans`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spanNumber: newSpanNumber.trim(), lengthMeters: lengthVal }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      setNewSpanNumber(''); setNewSpanLength(''); toast.success(`${itemLabel} berhasil dibuat`); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setCreatingSpan(false); }
  };

  const handleDeleteSpan = async (spanId: string) => {
    if (!confirm(`Hapus ${itemLabel.toLowerCase()} ini beserta seluruh log-nya?`)) return;
    try {
      const res = await apiFetch(`/fttt-projects/spans/${spanId}`, { method: 'DELETE' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(`${itemLabel} dihapus`); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
  };

  // JLM: folder / multi-file upload — every file in the chosen folder is uploaded to the category
  const handleAddLogs = async (spanId: string, files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.size > 0);
    if (arr.length === 0) return;
    setUploadingLog(spanId);
    let ok = 0;
    try {
      for (let i = 0; i < arr.length; i++) {
        if (arr.length > 1) setUploadProgress(`Mengunggah ${i + 1}/${arr.length}…`);
        const fd = new FormData();
        fd.append('category', logCategory);
        if (logCaption) fd.append('caption', logCaption);
        fd.append('file', arr[i]);
        const res = await apiFetch(`/fttt-projects/spans/${spanId}/logs`, { method: 'POST', body: fd }, user?.id);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { message?: string }).message ?? 'Gagal'); }
        ok++;
      }
      setLogCaption('');
      toast.success(arr.length > 1 ? `${ok} file berhasil diunggah` : 'Log berhasil diunggah');
      onRefresh();
    } catch (err: unknown) {
      toast.error(`${err instanceof Error ? err.message : 'Gagal'} (${ok}/${arr.length} terunggah)`);
      onRefresh();
    } finally { setUploadingLog(null); setUploadProgress(''); }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('Hapus log ini?')) return;
    try {
      const res = await apiFetch(`/fttt-projects/span-logs/${logId}`, { method: 'DELETE' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Log dihapus'); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📍 Daily Implementation Log — {itemLabel}</p>

      {/* Create Span / Folder KU */}
      {mayLog && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input value={newSpanNumber} onChange={(e) => setNewSpanNumber(e.target.value)}
            placeholder={isKu ? 'Nomor Folder KU (mis. KU-001)' : 'Nomor Span (mis. SP-001)'}
            style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
          <input type="number" min={0} value={newSpanLength} onChange={(e) => setNewSpanLength(e.target.value)}
            placeholder="Panjang (m) *"
            title="Panjang Pekerjaan (Meter) — wajib diisi saat membuat folder"
            style={{ width: 130, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
          <button type="button" onClick={() => void handleCreateSpan()} disabled={creatingSpan || !newSpanNumber.trim() || !newSpanLength.trim()}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
            {creatingSpan ? '…' : isKu ? '+ Tambah KU' : '+ Tambah Span'}
          </button>
        </div>
      )}

      {spans.length === 0 && (
        <p style={{ fontSize: 12, color: '#57606a' }}>Belum ada {itemLabel.toLowerCase()}. {mayLog ? `Tambahkan ${itemLabel.toLowerCase()} pertama di atas.` : 'Admin akan membuat folder.'}</p>
      )}

      {spans.map((span) => (
        <div key={span.id} style={{ border: '1px solid #D0D7DE', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#F6F8FA', cursor: 'pointer' }}
            onClick={() => setExpandedSpan(expandedSpan === span.id ? null : span.id)}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{itemLabel} {span.spanNumber}</span>
              {span.lengthMeters != null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#0969DA', background: '#EFF6FF', padding: '1px 6px', borderRadius: 999, marginLeft: 8 }}>
                  {Number(span.lengthMeters).toLocaleString('id-ID')} m
                </span>
              )}
              <span style={{ fontSize: 11, color: '#57606a', marginLeft: 8 }}>{span.spanLogs.length} log</span>
              <span style={{ fontSize: 11, color: '#8c959f', marginLeft: 8 }}>· dibuat {fmt(span.createdAt)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {isAdmin && (
                <button type="button" onClick={(e) => { e.stopPropagation(); void handleDeleteSpan(span.id); }}
                  style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11 }}>
                  Hapus
                </button>
              )}
              <span style={{ fontSize: 12, color: '#57606a' }}>{expandedSpan === span.id ? '▲' : '▼'}</span>
            </div>
          </div>

          {expandedSpan === span.id && (
            <div style={{ padding: 12 }}>
              {/* JLM: file count per category */}
              {span.spanLogs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {Object.entries(SPAN_LOG_CATEGORY_LABELS).map(([k, v]) => {
                    const n = span.spanLogs.filter((l) => l.category === k).length;
                    if (n === 0) return null;
                    return (
                      <span key={k} style={{ fontSize: 10, fontWeight: 600, color: '#374151', background: '#EDF2F4', padding: '2px 8px', borderRadius: 999 }}>
                        {v}: {n} file
                      </span>
                    );
                  })}
                </div>
              )}
              {/* Existing logs */}
              {span.spanLogs.map((log) => (
                <div key={log.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #EAEEF2' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 100 }}>{SPAN_LOG_CATEGORY_LABELS[log.category] ?? log.category}</span>
                  <div style={{ flex: 1 }}>
                    {log.caption && <span style={{ fontSize: 11, color: '#57606a' }}>{log.caption}</span>}
                    {Number(log.meterDone ?? 0) > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0969DA', background: '#EFF6FF', padding: '1px 6px', borderRadius: 999 }}>
                        +{Number(log.meterDone).toLocaleString('id-ID')} m
                      </span>
                    )}
                    <span style={{ display: 'block', fontSize: 10, color: '#8c959f' }}>🕒 {fmtDateTimeWIB(log.createdAt)}</span>
                  </div>
                  {log.fileUrl && (
                    <a href={fixFileUrl(log.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>
                  )}
                  {isAdmin && (
                    <button type="button" onClick={() => void handleDeleteLog(log.id)}
                      style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 10 }}>×</button>
                  )}
                </div>
              ))}

              {/* Add log form */}
              {mayLog && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={logCategory} onChange={(e) => setLogCategory(e.target.value)}
                    style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 }}>
                    {logCategories.map((k) => (
                      <option key={k} value={k}>{SPAN_LOG_CATEGORY_LABELS[k] ?? k}</option>
                    ))}
                  </select>
                  <input value={logCaption} onChange={(e) => setLogCaption(e.target.value)}
                    placeholder="Keterangan (opsional)"
                    style={{ flex: 1, minWidth: 120, padding: '5px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 }} />
                  {/* JLM: multi-file + folder upload — all files go to the selected category */}
                  <input ref={logFileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.pdf" style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.length) void handleAddLogs(span.id, e.target.files); e.target.value = ''; }} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <input ref={logFolderRef} type="file" {...({ webkitdirectory: '', directory: '' } as any)} multiple style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.length) void handleAddLogs(span.id, e.target.files); e.target.value = ''; }} />
                  <button type="button" onClick={() => logFolderRef.current?.click()} disabled={uploadingLog === span.id}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                    📁 Upload Folder
                  </button>
                  <button type="button" onClick={() => logFileRef.current?.click()} disabled={uploadingLog === span.id}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                    {uploadingLog === span.id ? (uploadProgress || '…') : '📄 Upload File'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── JLM: Implementation Transaction Log + budget monitoring + S-Curve ──────────
const TXN_CATEGORIES: FtttCostCategory[] = ['PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN'];
const txnInp: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 };

function SCurveMini({ title, data, dataWeekly, keys, money }: {
  title: string;
  data: Record<string, unknown>[];
  dataWeekly?: Record<string, unknown>[];
  keys: [string, string, string][];
  money?: boolean;
}) {
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const shown = period === 'weekly' && dataWeekly && dataWeekly.length > 0 ? dataWeekly : data;
  const pxPerTick = period === 'weekly' ? 88 : 96;
  const chartHeight = 220;
  // Fill container when short; expand past container when many weeks → real horizontal scroll
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
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{title}</p>
        <select value={period} onChange={(e) => setPeriod(e.target.value as 'weekly' | 'monthly')}
          style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE' }}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div
        ref={scrollRef}
        style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
      >
        <div style={{ width: chartWidth, height: chartHeight }}>
          <ComposedChart width={chartWidth} height={chartHeight} data={shown}
            margin={{ left: 8, right: 24, top: 8, bottom: period === 'weekly' ? 16 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" fontSize={period === 'weekly' ? 8 : 10} tickLine={false} axisLine={false}
              interval={0} angle={period === 'weekly' ? -35 : 0} textAnchor={period === 'weekly' ? 'end' : 'middle'}
              height={period === 'weekly' ? 56 : 30} />
            <YAxis fontSize={10} tickLine={false} axisLine={false} width={44}
              tickFormatter={(v) => money ? `${Math.round(Number(v) / 1e6)}M` : `${v}%`} />
            <RTooltip formatter={(v: number) => money ? 'Rp ' + Math.round(v).toLocaleString('id-ID') : `${v}%`} />
            <RLegend verticalAlign="top" height={28} />
            {keys.map(([k, label, color]) => (
              <Line key={k} type="monotone" dataKey={k} name={label} stroke={color} strokeWidth={2}
                connectNulls={false} dot={{ r: period === 'weekly' ? 2 : 3, fill: color }} />
            ))}
          </ComposedChart>
        </div>
      </div>
    </div>
  );
}

function TransactionLogSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const isPm = userRole === 'PM_FTTT' || userRole === 'GENERAL_MANAGER';
  const fp = project.financeProject ?? null;
  const rab = fp ? Number(fp.totalBudget) : 0;
  const txns: FtttTransaction[] = project.transactions ?? [];

  const isFinance = userRole === 'FINANCE' || userRole === 'GENERAL_MANAGER';
  const [scurve, setScurve] = useState<{
    byCategory: { category: string; budget: number; spent: number; remaining: number }[];
    costCurve: Record<string, unknown>[];
    progressCurve: Record<string, unknown>[];
    costCurveWeekly?: Record<string, unknown>[];
    progressCurveWeekly?: Record<string, unknown>[];
    hasRevision?: boolean;
  } | null>(null);
  const [disburseId, setDisburseId] = useState<string | null>(null);
  const [disburseDate, setDisburseDate] = useState('');
  const [disbursing, setDisbursing] = useState(false);
  const [openCat, setOpenCat] = useState<FtttCostCategory | null>(null);
  const [form, setForm] = useState({ aktivitas: '', uom: '', qty: '', price: '', remarks: '', expectedNeedDate: '', reason: '' });
  const [saving, setSaving] = useState(false);
  // Integra V1: Finance review (Accept/Decline) of a Financial Request
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<'accept' | 'decline' | null>(null);
  const [scheduledReleaseAt, setScheduledReleaseAt] = useState('');
  const [declinedReason, setDeclinedReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRows, setPlanRows] = useState<{ targetDate: string; plannedBudget: string; plannedProgressPct: string }[]>([]);
  const [hasBaselinePlan, setHasBaselinePlan] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  const formatBudgetInput = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('id-ID');
  };
  const parseBudgetInput = (display: string) => Number(display.replace(/\D/g, '')) || 0;

  const openPlanEditor = async () => {
    if (!fp) return;
    setPlanOpen(true);
    try {
      const res = await apiFetch(`/finance-projects/${fp.id}/timeline`, { method: 'GET' }, user?.id);
      if (!res.ok) throw new Error('Gagal memuat planning');
      const data = await res.json();
      const rows = Array.isArray(data) ? data : (data.milestones ?? []);
      setHasBaselinePlan(Array.isArray(data) ? rows.length > 0 : !!data.hasBaseline);
      setPlanRows(rows.length
        ? rows.map((r: { targetDate: string; plannedBudget: string | number; plannedProgressPct: string | number }) => ({
            targetDate: String(r.targetDate).slice(0, 10),
            plannedBudget: Number(r.plannedBudget) ? Number(r.plannedBudget).toLocaleString('id-ID') : '',
            plannedProgressPct: String(Number(r.plannedProgressPct)),
          }))
        : [{ targetDate: '', plannedBudget: '', plannedProgressPct: '' }]);
    } catch {
      setPlanRows([{ targetDate: '', plannedBudget: '', plannedProgressPct: '' }]);
    }
  };

  const savePlanEditor = async () => {
    if (!fp) return;
    const milestones = planRows
      .filter((r) => r.targetDate)
      .map((r) => ({
        targetDate: new Date(r.targetDate + 'T12:00:00').toISOString(),
        plannedBudget: parseBudgetInput(r.plannedBudget),
        plannedProgressPct: Math.min(100, Number(r.plannedProgressPct) || 0),
      }));
    setSavingPlan(true);
    try {
      const res = await apiFetch(`/finance-projects/${fp.id}/timeline`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestones }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(hasBaselinePlan ? 'Perubahan Planning tersimpan' : 'Plan Awal tersimpan');
      setPlanOpen(false);
      void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSavingPlan(false); }
  };

  const loadScurve = useCallback(async () => {
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/budget-scurve`, { method: 'GET' }, user?.id);
      if (res.ok) setScurve(await res.json());
    } catch { /* ignore */ }
  }, [project.id, user?.id]);
  useEffect(() => { void loadScurve(); }, [loadScurve, txns.length]);

  const fmtIDR = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const fmtDT = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB';

  const handleAdd = async (category: FtttCostCategory) => {
    if (!form.aktivitas.trim()) { toast.error('Aktivitas wajib diisi'); return; }
    if (!form.remarks.trim()) { toast.error('Remarks wajib diisi'); return; }
    if (!form.expectedNeedDate) { toast.error('Tanggal Kebutuhan wajib diisi'); return; }
    if (!form.reason.trim()) { toast.error('Alasan/justifikasi wajib diisi'); return; }
    const qty = Number(form.qty); const price = Number(form.price);
    if (!(qty > 0)) { toast.error('Qty harus lebih dari 0'); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/transactions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category, aktivitas: form.aktivitas, uom: form.uom || undefined, qty, price, remarks: form.remarks,
          expectedNeedDate: new Date(form.expectedNeedDate + 'T12:00:00').toISOString(),
          reason: form.reason,
        }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Financial Request tercatat — menunggu review Finance');
      setForm({ aktivitas: '', uom: '', qty: '', price: '', remarks: '', expectedNeedDate: '', reason: '' });
      setOpenCat(null);
      onRefresh(); void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSaving(false); }
  };

  const handleAccept = async (id: string) => {
    if (!scheduledReleaseAt) { toast.error('Isi Rencana Tanggal Pencairan'); return; }
    setReviewing(true);
    try {
      const res = await apiFetch(`/fttt-projects/transactions/${id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledReleaseAt: new Date(scheduledReleaseAt).toISOString() }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Financial Request disetujui');
      setReviewId(null); setReviewAction(null); setScheduledReleaseAt('');
      onRefresh(); void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setReviewing(false); }
  };

  const handleDecline = async (id: string) => {
    if (!declinedReason.trim()) { toast.error('Isi alasan penolakan'); return; }
    setReviewing(true);
    try {
      const res = await apiFetch(`/fttt-projects/transactions/${id}/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declinedReason: declinedReason.trim() }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Financial Request ditolak');
      setReviewId(null); setReviewAction(null); setDeclinedReason('');
      onRefresh(); void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setReviewing(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus transaksi ini?')) return;
    try {
      const res = await apiFetch(`/fttt-projects/transactions/${id}`, { method: 'DELETE' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Transaksi dihapus'); onRefresh(); void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
  };

  const handleDisburse = async (id: string) => {
    if (!disburseDate) { toast.error('Isi Tanggal Dana Keluar'); return; }
    const today = new Date();
    const max = new Date(today); max.setDate(max.getDate() + 14);
    const todayStr = today.toISOString().slice(0, 10);
    const maxStr = max.toISOString().slice(0, 10);
    if (disburseDate > maxStr) { toast.error('Tanggal Dana Keluar maksimal 14 hari dari hari ini'); return; }
    setDisbursing(true);
    try {
      const res = await apiFetch(`/fttt-projects/transactions/${id}/disburse`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disbursedAt: new Date(disburseDate + 'T12:00:00').toISOString() }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(
        disburseDate > todayStr
          ? 'Dana keluar dijadwalkan — budget berkurang pada tanggal tersebut'
          : 'Tanggal Dana Keluar tersimpan — budget diperbarui',
      );
      setDisburseId(null); setDisburseDate('');
      onRefresh(); void loadScurve();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setDisbursing(false); }
  };

  if (!fp) {
    return (
      <div style={{ background: '#FFF8C5', border: '1px solid #d4a017', borderRadius: 10, padding: 14, fontSize: 12, color: '#9a6700' }}>
        ⚠️ Project ini belum terhubung dengan Finance Project (FTTT). Transaction Log & monitoring budget memerlukan link ke Finance Project (pilih saat Project Initiation).
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 12, color: '#374151' }}>
        <span>👤 <b>{user?.name ?? '—'}</b></span>
        <span>📁 Project: <b>{fp.code} · {fp.name}</b></span>
        <span>💰 Total RAB: <b>{fmtIDR(rab)}</b></span>
      </div>

      {!isPm && !isFinance && (
        <div style={{ background: '#F6F8FA', border: '1px solid #D0D7DE', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#57606a' }}>
          🔒 PM FTTT mencatat Transaction Log; Finance mengisi Tanggal Dana Keluar untuk merealisasikan budget.
        </div>
      )}
      {isPm && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 12, color: '#1e40af' }}>
          ℹ️ Setelah Simpan, transaksi tersimpan sebagai rencana. Budget Finance belum berkurang sampai Finance mengisi Tanggal Dana Keluar.
        </div>
      )}

      {scurve && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
          {scurve.byCategory.map((b) => (
            <div key={b.category} style={{ border: '1px solid #EAEEF2', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>{FTTT_COST_CATEGORY_LABELS[b.category as FtttCostCategory]}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: b.remaining < 0 ? '#cf222e' : '#111' }}>{fmtIDR(b.spent)} <span style={{ fontSize: 10, color: '#8c959f', fontWeight: 500 }}>/ {fmtIDR(b.budget)}</span></div>
              <div style={{ height: 4, background: '#EAEEF2', borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: '100%', borderRadius: 2, background: b.remaining < 0 ? '#cf222e' : '#1a7f37', width: `${b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {TXN_CATEGORIES.map((cat) => {
        const catTxns = txns.filter((t) => t.category === cat);
        return (
          <div key={cat} style={{ border: '1px solid #D0D7DE', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F6F8FA' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{FTTT_COST_CATEGORY_LABELS[cat]} <span style={{ fontSize: 11, color: '#57606a' }}>({catTxns.length})</span></span>
              {isPm && (
                <button type="button" onClick={() => { setOpenCat(openCat === cat ? null : cat); setForm({ aktivitas: '', uom: '', qty: '', price: '', remarks: '', expectedNeedDate: '', reason: '' }); }}
                  style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  + Add
                </button>
              )}
            </div>
            {isPm && openCat === cat && (
              <div style={{ padding: 10, borderBottom: '1px solid #EAEEF2', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 6 }}>
                <input placeholder="Aktivitas" value={form.aktivitas} onChange={(e) => setForm({ ...form, aktivitas: e.target.value })} style={txnInp} />
                <input placeholder="UOM" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} style={txnInp} />
                <input placeholder="Qty" type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} style={txnInp} />
                <input placeholder="Price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} style={txnInp} />
                <input placeholder="Remarks (wajib)" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} style={{ ...txnInp, gridColumn: '1 / 4' }} />
                <input type="date" title="Tanggal Kebutuhan" value={form.expectedNeedDate} onChange={(e) => setForm({ ...form, expectedNeedDate: e.target.value })} style={txnInp} />
                <input placeholder="Alasan/justifikasi (wajib)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={{ ...txnInp, gridColumn: '1 / 4' }} />
                <button type="button" disabled={saving} onClick={() => void handleAdd(cat)}
                  style={{ borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? '…' : 'Simpan'}
                </button>
                <div style={{ gridColumn: '1 / 5', fontSize: 11, color: '#57606a' }}>Total otomatis: <b>{fmtIDR((Number(form.qty) || 0) * (Number(form.price) || 0))}</b> · Timestamp dibuat otomatis saat disimpan · Prioritas dihitung otomatis dari Tanggal Kebutuhan</div>
              </div>
            )}
            {catTxns.length === 0 ? (
              <div style={{ padding: 10, fontSize: 11, color: '#8c959f' }}>Belum ada transaksi.</div>
            ) : catTxns.map((t) => {
              const total = Number(t.total);
              const bobot = rab > 0 ? (total / rab) * 100 : 0;
              const nowMs = Date.now();
              const hasDate = !!t.disbursedAt;
              const realized = hasDate && new Date(t.disbursedAt!).getTime() <= nowMs;
              const scheduled = hasDate && !realized;
              // Integra V1: legacy transactions (no `reason`) skip the Financial Request review gate
              const isFinancialRequest = !!t.reason;
              const pendingReview = isFinancialRequest && t.requestStatus === 'PENDING_REVIEW';
              const accepted = !isFinancialRequest || t.requestStatus === 'ACCEPTED';
              const declined = isFinancialRequest && t.requestStatus === 'DECLINED';
              return (
                <div key={t.id} style={{ padding: '8px 12px', borderBottom: '1px solid #F0F3F6', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{t.aktivitas}
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: realized ? '#1a7f37' : scheduled ? '#0969DA' : '#9a6700', background: realized ? '#DAFBE1' : scheduled ? '#DDF4FF' : '#FFF8C5', padding: '1px 6px', borderRadius: 999 }}>
                        {realized ? 'Terealisasi' : scheduled ? 'Terjadwal' : 'Menunggu Dana Keluar'}
                      </span>
                      {t.priority && (
                        <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: '#fff', background: FTTT_PRIORITY_COLORS[t.priority] ?? '#57606a', padding: '1px 6px', borderRadius: 999 }}>
                          {FTTT_PRIORITY_LABELS[t.priority] ?? t.priority}
                        </span>
                      )}
                      {isFinancialRequest && t.requestStatus && (
                        <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: FTTT_REQUEST_STATUS_COLORS[t.requestStatus] ?? '#57606a', background: '#F6F8FA', padding: '1px 6px', borderRadius: 999, border: `1px solid ${FTTT_REQUEST_STATUS_COLORS[t.requestStatus] ?? '#D0D7DE'}` }}>
                          {FTTT_REQUEST_STATUS_LABELS[t.requestStatus] ?? t.requestStatus}
                        </span>
                      )}
                    </span>
                    <span style={{ fontWeight: 700 }}>{fmtIDR(total)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#57606a', marginTop: 2 }}>
                    {Number(t.qty)} {t.uom ?? ''} × {fmtIDR(Number(t.price))} · Bobot {bobot.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 10, color: '#8c959f', marginTop: 2 }}>📝 {t.remarks} · 🕒 {fmtDT(t.createdAt)} · {t.createdBy?.name}</div>
                  {t.expectedNeedDate && (
                    <div style={{ fontSize: 10, color: '#8c959f', marginTop: 2 }}>
                      📅 Kebutuhan: {new Date(t.expectedNeedDate).toLocaleDateString('id-ID')}{t.reason ? ` · Alasan: ${t.reason}` : ''}
                    </div>
                  )}
                  {declined && (
                    <div style={{ fontSize: 10, color: '#cf222e', marginTop: 2 }}>
                      ✕ Ditolak{t.reviewedBy?.name ? ` oleh ${t.reviewedBy.name}` : ''}{t.declinedReason ? ` · Alasan: ${t.declinedReason}` : ''}
                    </div>
                  )}
                  {isFinancialRequest && t.requestStatus === 'ACCEPTED' && t.scheduledReleaseAt && !hasDate && (
                    <div style={{ fontSize: 10, color: '#1a7f37', marginTop: 2 }}>
                      ✓ Disetujui{t.reviewedBy?.name ? ` oleh ${t.reviewedBy.name}` : ''} · Rencana pencairan: {new Date(t.scheduledReleaseAt).toLocaleDateString('id-ID')}
                    </div>
                  )}
                  {hasDate && (
                    <div style={{ fontSize: 10, color: realized ? '#1a7f37' : '#0969DA', marginTop: 2 }}>
                      💵 Dana keluar: {fmtDT(t.disbursedAt!)}{t.disbursedBy?.name ? ` · ${t.disbursedBy.name}` : ''}{scheduled ? ' (menunggu tanggal)' : ''}
                    </div>
                  )}
                  {isFinance && pendingReview && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {reviewId === t.id && reviewAction === 'accept' ? (
                        <>
                          <input type="datetime-local" value={scheduledReleaseAt} onChange={(e) => setScheduledReleaseAt(e.target.value)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 }} />
                          <button type="button" disabled={reviewing} onClick={() => void handleAccept(t.id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                            {reviewing ? '…' : 'Konfirmasi Setuju'}
                          </button>
                          <button type="button" onClick={() => { setReviewId(null); setReviewAction(null); setScheduledReleaseAt(''); }}
                            style={{ fontSize: 11, background: 'none', border: 'none', color: '#57606a', cursor: 'pointer' }}>Batal</button>
                        </>
                      ) : reviewId === t.id && reviewAction === 'decline' ? (
                        <>
                          <input placeholder="Alasan penolakan…" value={declinedReason} onChange={(e) => setDeclinedReason(e.target.value)}
                            style={{ flex: 1, minWidth: 160, padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 }} />
                          <button type="button" disabled={reviewing} onClick={() => void handleDecline(t.id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#cf222e', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                            {reviewing ? '…' : 'Konfirmasi Tolak'}
                          </button>
                          <button type="button" onClick={() => { setReviewId(null); setReviewAction(null); setDeclinedReason(''); }}
                            style={{ fontSize: 11, background: 'none', border: 'none', color: '#57606a', cursor: 'pointer' }}>Batal</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setReviewId(t.id); setReviewAction('accept'); setScheduledReleaseAt(''); }}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
                            ✓ Accept
                          </button>
                          <button type="button" onClick={() => { setReviewId(t.id); setReviewAction('decline'); setDeclinedReason(''); }}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#cf222e', color: '#fff', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
                            ✕ Decline
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {!hasDate && isFinance && accepted && !pendingReview && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {disburseId === t.id ? (
                        <>
                          <input type="date" value={disburseDate}
                            min={new Date().toISOString().slice(0, 10)}
                            max={(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toISOString().slice(0, 10); })()}
                            onChange={(e) => {
                              const v = e.target.value;
                              const max = new Date(); max.setDate(max.getDate() + 14);
                              const maxStr = max.toISOString().slice(0, 10);
                              if (v && v > maxStr) { toast.error('Tanggal Dana Keluar maksimal 14 hari dari hari ini'); return; }
                              setDisburseDate(v);
                            }}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11 }} />
                          <button type="button" disabled={disbursing} onClick={() => void handleDisburse(t.id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                            {disbursing ? '…' : 'Simpan Tanggal Dana Keluar'}
                          </button>
                          <button type="button" onClick={() => { setDisburseId(null); setDisburseDate(''); }}
                            style={{ fontSize: 11, background: 'none', border: 'none', color: '#57606a', cursor: 'pointer' }}>Batal</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => { setDisburseId(t.id); setDisburseDate(new Date().toISOString().slice(0, 10)); }}
                          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
                          + Tanggal Dana Keluar
                        </button>
                      )}
                    </div>
                  )}
                  {isPm && !realized && <button type="button" onClick={() => void handleDelete(t.id)} style={{ marginTop: 2, fontSize: 10, color: '#cf222e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Hapus</button>}
                </div>
              );
            })}
          </div>
        );
      })}

      {scurve && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 11, color: '#8c959f', margin: 0 }}>
              ℹ️ Planning Awal diatur lewat Set Plan Awal; Edit Planning menambah garis Perubahan Planning.
            </p>
            {(isPm || isFinance) && fp && (
              <button type="button" onClick={() => void openPlanEditor()}
                style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#0F1B2D', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {hasBaselinePlan || scurve.hasRevision || (scurve.costCurve?.length ?? 0) > 0 ? '✏️ Edit Planning' : '📌 Set Plan Awal'}
              </button>
            )}
          </div>
          <SCurveMini title="📈 Kurva S Biaya" data={scurve.costCurve} dataWeekly={scurve.costCurveWeekly}
            keys={scurve.hasRevision
              ? [['baselineCost', 'Planning Awal', '#94A3B8'], ['plannedCost', 'Perubahan Planning', '#F59E0B'], ['actualCost', 'Actual', '#00B89E']]
              : [['baselineCost', 'Planning Awal', '#94A3B8'], ['actualCost', 'Actual', '#00B89E']]} money />
          <SCurveMini title="📊 Kurva S Progress" data={scurve.progressCurve} dataWeekly={scurve.progressCurveWeekly}
            keys={scurve.hasRevision
              ? [['baselineProgress', 'Planning Awal %', '#94A3B8'], ['plannedProgress', 'Perubahan Planning %', '#F59E0B'], ['actualProgress', 'Actual %', '#0969DA']]
              : [['baselineProgress', 'Planning Awal %', '#94A3B8'], ['actualProgress', 'Actual %', '#0969DA']]} />
        </div>
      )}

      {planOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>{hasBaselinePlan ? 'Edit Planning — Kurva S' : 'Set Plan Awal — Kurva S'}</p>
              <button type="button" onClick={() => setPlanOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <p style={{ fontSize: 11, color: '#57606a', marginBottom: 10 }}>
              {hasBaselinePlan
                ? 'Edit ini menyimpan garis Perubahan Planning. Planning Awal tetap tidak berubah.'
                : 'Simpan sebagai Plan Awal (baseline). Garis Perubahan Planning baru muncul setelah Edit Planning.'}
            </p>
            {planRows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr auto', gap: 6, marginBottom: 6 }}>
                <input type="date" value={r.targetDate} onChange={(e) => { const n = [...planRows]; n[i] = { ...n[i], targetDate: e.target.value }; setPlanRows(n); }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
                <input type="text" inputMode="numeric" placeholder="1.000.000" value={r.plannedBudget}
                  onChange={(e) => { const n = [...planRows]; n[i] = { ...n[i], plannedBudget: formatBudgetInput(e.target.value) }; setPlanRows(n); }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
                <input type="number" placeholder="0-100" value={r.plannedProgressPct}
                  onChange={(e) => { const n = [...planRows]; n[i] = { ...n[i], plannedProgressPct: e.target.value }; setPlanRows(n); }}
                  style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
                <button type="button" onClick={() => setPlanRows(planRows.filter((_, x) => x !== i))} style={{ color: '#cf222e', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setPlanRows([...planRows, { targetDate: '', plannedBudget: '', plannedProgressPct: '' }])}
              style={{ fontSize: 11, fontWeight: 700, color: '#00B89E', border: 'none', background: 'none', cursor: 'pointer', marginBottom: 10 }}>+ Tambah Milestone</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={savingPlan} onClick={() => void savePlanEditor()}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#0F1B2D', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {savingPlan ? 'Menyimpan…' : (hasBaselinePlan ? 'Simpan Perubahan Planning' : 'Simpan Plan Awal')}
              </button>
              <button type="button" onClick={() => setPlanOpen(false)}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImplementationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const isAdmin      = userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER';
  const isSurveyor   = userRole === 'SURVEYOR_FTTT';
  const isPmFttt     = userRole === 'PM_FTTT';
  const isTI         = project.ftttCompany === 'TELKOM_INFRA';
  const isPST        = project.ftttCompany === 'PST';
  const isIforte     = project.ftttCompany === 'IFORTE';
  // Integra V1: Metode Implementasi (Galian / KU) generalized for ALL companies —
  // method-first daily logging (was PST-only)
  const implType     = project.implementationType ?? null;
  // Integra V4: KU must show the same Total Panjang / Progress monitoring as Galian
  const showLengthProgress = implType === 'GALIAN' || implType === 'KU';
  // Issue 2: TI Implementation — Admin only; PST/iFORTE — Surveyor/PM/Admin
  const canUpload    = isTI ? isAdmin : (isSurveyor || isAdmin || isPmFttt);
  const canMonitoring = isAdmin;
  const canNote      = canUpload;
  const [settingType, setSettingType] = useState(false);

  const handleSetImplType = async (type: 'GALIAN' | 'KU') => {
    setSettingType(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/implementation-type`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(`Jenis implementasi diset: ${type === 'GALIAN' ? 'Galian' : 'KU (Kabel Udara)'}`);
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSettingType(false); }
  };

  // C6-PST4: Track Surveyor "lapangan done" state via phaseProgress.notes
  const implProg = project.phaseProgresses.find((p) => p.phase === 'IMPLEMENTATION');
  const lapanganDone = implProg?.notes === 'SURVEYOR_DONE';

  const [logType, setLogType] = useState<'PHOTO' | 'MONITORING_DOC' | 'NOTE' | 'RFSD'>('PHOTO');
  const [caption, setCaption] = useState('');
  const [notes, setNotes]   = useState('');
  const [uploading, setUploading]   = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  // Integra V2: Daily Log tab is shown for both Galian and KU — Transaction Log / Log Aktivitas remain company-wide
  const [implTab, setImplTab] = useState<'daily' | 'transaction' | 'activity'>(implType ? 'daily' : 'activity');
  // Re-sync default tab once implType becomes known after initial mount (method-first selector)
  useEffect(() => { if (implType) setImplTab('daily'); }, [implType]);
  const fileRef = useRef<HTMLInputElement>(null);

  const LOG_LABELS: Record<string, string> = { PHOTO: '📷 Foto Progress', MONITORING_DOC: '📊 Dokumen Monitoring', NOTE: '📝 Catatan Progress', RFSD: '📦 RFSD (Ready For Sales Document)' };

  // ── iFORTE GENERAL: Progress (%) berdasarkan panjang implementasi (meter) ──
  const totalPanjang = Number(project.totalPanjangMeter ?? 0);
  // Integra V2: panjang folder (meter) diisi sekali saat buat Span/Folder KU — bukan per aktivitas
  const meterFromSpans = (project.spans ?? []).reduce(
    (sum, sp) => sum + Number(sp.lengthMeters ?? 0), 0,
  );
  // Prefer Log Aktivitas meters when Daily Log already mirrored there (avoid double-count)
  const meterFromActivity = (project.implementationLogs ?? []).reduce(
    (sum, l) => sum + Number(l.meterDone ?? 0), 0,
  );
  const meterDoneTotal = meterFromActivity > 0 ? meterFromActivity : meterFromSpans;
  const progressPct = totalPanjang > 0 ? Math.min(100, (meterDoneTotal / totalPanjang) * 100) : null;
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState('');
  const [savingTotal, setSavingTotal] = useState(false);
  const canSetTotal = isAdmin || isPmFttt;

  const handleSaveTotal = async () => {
    const m = Number(totalInput);
    if (!m || m <= 0) { toast.error('Total panjang pekerjaan harus lebih dari 0'); return; }
    setSavingTotal(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/total-panjang`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meters: m }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Total panjang pekerjaan disimpan');
      setEditingTotal(false); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSavingTotal(false); }
  };

  // iFORTE: RFSD sudah diunggah? (indikator pekerjaan fisik selesai)
  const hasRfsd = (project.implementationLogs ?? []).some((l) => l.logType === 'RFSD');

  const handleMarkDone = async () => {
    if (!confirm('Tandai pekerjaan lapangan selesai? Task akan diteruskan ke Admin untuk upload Dokumen Monitoring.')) return;
    setMarkingDone(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/mark-implementation-done`, { method: 'POST' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Pekerjaan lapangan ditandai selesai — Admin akan upload Dokumen Monitoring');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setMarkingDone(false); }
  };

  const fmtDateTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
  };

  // Issue #1: multi-file upload — loop through files for PHOTO type
  const handleAdd = async (files?: FileList | File[]) => {
    const fileArray = files ? Array.from(files) : [];
    setUploading(true);
    try {
      if (logType === 'NOTE' || fileArray.length === 0) {
        // Single API call for NOTE or no file
        const fd = new FormData();
        fd.append('logType', logType);
        if (caption) fd.append('caption', caption);
        if (notes)   fd.append('notes', notes);
        if (fileArray[0]) fd.append('file', fileArray[0]);
        const res = await apiFetch(`/fttt-projects/${project.id}/implementation-logs`, { method: 'POST', body: fd }, user?.id);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
        toast.success('Log implementasi berhasil disimpan');
      } else {
        // Issue #1: multiple files — upload each as a separate log entry
        for (let i = 0; i < fileArray.length; i++) {
          setUploadProgress(`Mengunggah ${i + 1}/${fileArray.length}…`);
          const fd = new FormData();
          fd.append('logType', logType);
          fd.append('caption', caption || `Foto ${i + 1}${fileArray.length > 1 ? ` dari ${fileArray.length}` : ''}`);
          if (notes) fd.append('notes', notes);
          fd.append('file', fileArray[i]);
          const res = await apiFetch(`/fttt-projects/${project.id}/implementation-logs`, { method: 'POST', body: fd }, user?.id);
          if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {message?: string}).message ?? 'Gagal'); }
        }
        toast.success(`${fileArray.length} foto berhasil diunggah`);
      }
      setCaption(''); setNotes(''); setUploadProgress(''); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); setUploadProgress(''); }
  };

  const logs = [...(project.implementationLogs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Integra V1: Method-first Daily Log — every company picks implementation
  // method (Galian / KU) before any implementation activity is shown
  if (!implType) {
    return (
      <div>
        <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Pilih Metode Implementasi</p>
        <p style={{ fontSize: 12, color: '#57606a', marginBottom: 12 }}>
          Project ini memiliki dua jenis pekerjaan implementasi. Pilih metode terlebih dahulu untuk menentukan alur dokumentasi Daily Log.
        </p>
        {isAdmin ? (
          <div style={{ display: 'flex', gap: 10 }}>
            {([
              { key: 'GALIAN' as const, icon: '⛏️', label: 'Galian', desc: 'Dokumentasi berbasis Span (Daily Implementation Log)' },
              { key: 'KU' as const, icon: '🔌', label: 'KU (Kabel Udara)', desc: 'Form upload dokumentasi existing' },
            ]).map((opt) => (
              <button key={opt.key} type="button" disabled={settingType}
                onClick={() => void handleSetImplType(opt.key)}
                style={{ flex: 1, padding: 14, borderRadius: 10, border: '1.5px solid #D0D7DE', background: '#fff', cursor: settingType ? 'not-allowed' : 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{opt.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#57606a', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ background: '#F6F8FA', border: '1px solid #D0D7DE', borderRadius: 8, padding: 10, fontSize: 12, color: '#57606a' }}>
            🔒 Admin Project akan memilih jenis implementasi terlebih dahulu.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {implType && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#EDF2F4', fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 10 }}>
          Metode Implementasi: {implType === 'GALIAN' ? '⛏️ Galian' : '🔌 KU (Kabel Udara)'}
        </div>
      )}

      {/* Integra V4: Total Panjang + Progress — Galian and KU */}
      {showLengthProgress && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', border: '1px solid #D0D7DE', borderRadius: 10, padding: '10px 14px', marginBottom: 12, background: '#F6F8FA' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#57606a', textTransform: 'uppercase' }}>Total Panjang Pekerjaan</p>
            {editingTotal ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input type="number" min={1} value={totalInput} onChange={(e) => setTotalInput(e.target.value)}
                  placeholder="mis. 500"
                  style={{ width: 110, padding: '4px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }} />
                <button type="button" onClick={() => void handleSaveTotal()} disabled={savingTotal}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                  {savingTotal ? '…' : 'Simpan'}
                </button>
                <button type="button" onClick={() => setEditingTotal(false)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontSize: 11 }}>
                  Batal
                </button>
              </div>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: '#111' }}>
                {totalPanjang > 0 ? `${totalPanjang.toLocaleString('id-ID')} meter` : 'Belum diatur'}
                {canSetTotal && (
                  <button type="button" onClick={() => { setTotalInput(totalPanjang > 0 ? String(totalPanjang) : ''); setEditingTotal(true); }}
                    style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontSize: 10, fontWeight: 600, color: '#0969DA' }}>
                    ✏️ {totalPanjang > 0 ? 'Ubah' : 'Atur'}
                  </button>
                )}
              </p>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#57606a', textTransform: 'uppercase' }}>Progress Pekerjaan</p>
            {progressPct != null ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: '#57606a' }}>{meterDoneTotal.toLocaleString('id-ID')} m selesai</span>
                  <span style={{ fontWeight: 800, color: progressPct >= 100 ? '#1a7f37' : '#0969DA' }}>{progressPct.toFixed(progressPct % 1 === 0 ? 0 : 1)}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: '#EAEEF2', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progressPct}%`, background: progressPct >= 100 ? '#1a7f37' : '#0969DA', borderRadius: 999, transition: 'width 300ms' }} />
                </div>
              </div>
            ) : (
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8c959f' }}>Atur total panjang pekerjaan untuk melihat progress (%)</p>
            )}
          </div>
        </div>
      )}

      {/* iFORTE: status RFSD — wajib sebelum lanjut ke Documentation & Acceptance */}
      {isIforte && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: hasRfsd ? '#DAFBE1' : '#FFF8C5', fontSize: 11, fontWeight: 600, color: hasRfsd ? '#1a7f37' : '#9a6700', marginBottom: 10 }}>
          {hasRfsd ? '📦 RFSD sudah diunggah — fase dapat diselesaikan' : '📦 RFSD (Ready For Sales Document) wajib diunggah sebelum lanjut ke Documentation & Acceptance'}
        </div>
      )}

      {/* Integra V2: Implementation tabs — Daily Log (Galian & KU) / Transaction Log / Log Aktivitas */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid #EAEEF2' }}>
        {([
          { k: 'daily' as const, label: '📍 Daily Log' },
          { k: 'transaction' as const, label: '💰 Transaction Log' },
          { k: 'activity' as const, label: '🗂️ Log Aktivitas' },
        ]).map((t) => (
          <button key={t.k} type="button" onClick={() => setImplTab(t.k)}
            style={{ padding: '7px 12px', border: 'none', background: 'none', borderBottom: `2px solid ${implTab === t.k ? '#0969DA' : 'transparent'}`, color: implTab === t.k ? '#0969DA' : '#57606a', fontWeight: implTab === t.k ? 700 : 500, fontSize: 12, cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {implTab === 'transaction' && <TransactionLogSection project={project} onRefresh={onRefresh} userRole={userRole} />}

      {/* Integra V2: Folder-based Daily Log — shown for both Galian and KU */}
      {implTab === 'daily' && (
        <SpanSection project={project} onRefresh={onRefresh} isAdmin={isAdmin} mode={implType ?? undefined}
          canLog={isAdmin || (isIforte && (isPmFttt || isSurveyor))} />
      )}

      {implTab === 'activity' && (
      <>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Log Implementasi ({logs.length})</p>

      {/* List existing logs */}
      {logs.length === 0 && (
        <p style={{ fontSize: 12, color: '#57606a', marginBottom: 8 }}>Belum ada log implementasi. Tambahkan foto progress, dokumen monitoring, atau catatan.</p>
      )}
      {logs.map((log) => (
        <div key={log.id} style={{ background: '#F6F8FA', borderRadius: 8, padding: 10, marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18 }}>{log.logType === 'PHOTO' ? '📷' : log.logType === 'MONITORING_DOC' ? '📊' : log.logType === 'RFSD' ? '📦' : '📝'}</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{LOG_LABELS[log.logType]}</p>
            {log.caption && <p style={{ margin: '2px 0 0', fontSize: 12 }}>{log.caption}</p>}
            {Number(log.meterDone ?? 0) > 0 && (
              <p style={{ margin: '2px 0 0', fontSize: 11, fontWeight: 700, color: '#0969DA' }}>
                Panjang Pekerjaan Selesai: {Number(log.meterDone).toLocaleString('id-ID')} m
              </p>
            )}
            {log.notes   && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{log.notes}</p>}
            {/* C7-TI1/PST2: Display timestamp + user + role for audit trail */}
            <p style={{ margin: '3px 0 0', fontSize: 10, color: '#8c959f' }}>
              {fmtDateTime(log.createdAt)} · {log.uploadedBy.name}
              {log.uploadedBy.role && (
                <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 4, background: '#EAEEF2', fontSize: 9 }}>
                  {log.uploadedBy.role}
                </span>
              )}
            </p>
          </div>
          {log.fileUrl && (
            <a href={fixFileUrl(log.fileUrl)} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#0969DA', whiteSpace: 'nowrap' }}>
              {log.logType === 'PHOTO' ? 'Lihat Foto' : 'Download'}
            </a>
          )}
        </div>
      ))}

      {/* C7-TI5/PST: Status banner when lapangan done */}
      {lapanganDone && (
        <div style={{ background: '#FFF8C5', border: '1px solid #d4a017', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#9a6700' }}>
            ✅ Pekerjaan lapangan ditandai selesai
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#9a6700' }}>
            {isAdmin ? 'Silakan upload Dokumen Monitoring, kemudian selesaikan fase.' : 'Menunggu Admin upload Dokumen Monitoring.'}
          </p>
        </div>
      )}

      {/* Mark lapangan done — PST/iFORTE: Surveyor sends to Admin; TI: Admin-only button below */}
      {isSurveyor && !isTI && !lapanganDone && logs.length > 0 && (
        <div style={{ background: '#DAFBE1', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 8 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1a7f37' }}>
            Pekerjaan lapangan sudah selesai?
          </p>
          <button type="button" onClick={() => void handleMarkDone()} disabled={markingDone}
            style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {markingDone ? 'Memproses…' : '✅ Selesai Fase → Implementation'}
          </button>
        </div>
      )}

      {/* C7-TI5: Admin button — confirm lapangan done (TI flow: Admin marks and uploads monitoring doc) */}
      {isAdmin && !lapanganDone && logs.length > 0 && (
        <div style={{ background: '#DAFBE1', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginTop: 8, marginBottom: 8 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: '#1a7f37' }}>
            Pekerjaan lapangan sudah selesai?
          </p>
          <button type="button" onClick={() => void handleMarkDone()} disabled={markingDone}
            style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#1a7f37', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {markingDone ? 'Memproses…' : '✅ Tandai Pekerjaan Lapangan Selesai'}
          </button>
        </div>
      )}

      </>
      )}

      {/* Add log form — Daily Log Span tab */}
      {implTab === 'daily' && (canUpload || canNote) && (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>Tambah Log Implementasi</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={logType} onChange={(e) => setLogType(e.target.value as typeof logType)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
              {canUpload && <option value="PHOTO">📷 Foto Progress</option>}
              {canMonitoring && <option value="MONITORING_DOC">📊 Dokumen Monitoring (Excel/PDF)</option>}
              {isIforte && isAdmin && <option value="RFSD">📦 RFSD — Ready For Sales Document</option>}
              <option value="NOTE">📝 Catatan Progress</option>
            </select>
            {!canMonitoring && userRole !== 'PM_FTTT' && (
              <span style={{ fontSize: 11, color: '#8c959f', alignSelf: 'center' }}>
                📊 Dokumen Monitoring diupload oleh Admin
              </span>
            )}
          </div>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={logType === 'NOTE' ? 'Judul catatan…' : 'Keterangan / caption…'}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }} />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Detail catatan / keterangan tambahan (opsional)…"
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box', resize: 'vertical' }} />

          {logType === 'NOTE' ? (
            <button type="button" onClick={() => { void handleAdd(); }} disabled={uploading || !caption.trim()}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              {uploading ? 'Menyimpan…' : '💾 Simpan Catatan'}
            </button>
          ) : (
            <>
              {/* Issue #1: PHOTO supports multiple files (max 20MB each); MONITORING_DOC single file */}
              <input ref={fileRef} type="file"
                accept={logType === 'PHOTO' ? '.jpg,.jpeg,.png,.webp' : '.xlsx,.xls,.pdf'}
                multiple={logType === 'PHOTO'}
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files && e.target.files.length > 0) void handleAdd(e.target.files); }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: logType === 'RFSD' ? '#1a7f37' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                {uploading ? (uploadProgress || 'Mengunggah…') : logType === 'PHOTO' ? '📷 Upload Foto (dapat pilih banyak)' : logType === 'RFSD' ? '📦 Upload RFSD' : '+ Upload Dokumen'}
              </button>
              {logType === 'PHOTO' && <span style={{ fontSize: 11, color: '#57606a', alignSelf: 'center' }}>Pilih 1 atau lebih foto • maks 20 MB/foto</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Documentation & Acceptance — per-lifecycle config ───────────────────────
// Admin Project uploads; PM FTTT reviews/approves
const DOCUMENTATION_DOCS: Record<string, {
  key: string; label: string; desc: string;
  generateForm: boolean; required: boolean;
}[]> = {
  TELKOM_INFRA: [
    { key: 'BACT',            label: 'BACT',          desc: 'Berita Acara Commissioning Test dari Telkom Infra',   generateForm: false, required: true },
    { key: 'BAUT',            label: 'BAUT',           desc: 'Berita Acara Uji Terima — upload file',               generateForm: false, required: true },
    { key: 'BAUT_REKONSILIASI', label: 'BA Rekonsiliasi', desc: 'Berita Acara Rekonsiliasi — upload file',          generateForm: false, required: true },
  ],
  PST: [
    { key: 'BACT',            label: 'BACT',          desc: 'Berita Acara Commissioning Test dari PST',             generateForm: false, required: true },
    { key: 'BAUT',            label: 'BAUT',           desc: 'Berita Acara Uji Terima — upload file',               generateForm: false, required: true },
    { key: 'BAUT_REKONSILIASI', label: 'BA Rekonsiliasi', desc: 'Berita Acara Rekonsiliasi — upload file',          generateForm: false, required: true },
  ],
  // iFORTE: seluruh dokumen Documentation & Acceptance bersifat opsional (non-mandatory)
  IFORTE: [
    { key: 'ATP',         label: 'ATP (Opsional)',                   desc: 'Dokumen ATP (Acceptance Test Protocol) dari iFORTE',            generateForm: false, required: false },
    { key: 'DOKUMENTASI', label: 'Dokumentasi Pekerjaan (Opsional)', desc: 'Dokumentasi hasil pekerjaan implementasi',                      generateForm: false, required: false },
    { key: 'EVIDENCE',    label: 'Evidence (Opsional)',              desc: 'Evidence pendukung dan foto project',                           generateForm: false, required: false },
    { key: 'PUNCH_LIST',  label: 'Punch List (Opsional)', desc: 'Temuan pada saat pelaksanaan ATP fisik — hanya bila ada temuan', generateForm: false, required: false },
  ],
};

// ─── Reconciliation & Billing Section (Issue #4) ─────────────────────────────
// Company-specific document definitions for Reconciliation phase
// C5-Issue1/3/4: All Generate Form removed; Good Receipt removed; Jaminan+Invoice moved to Closing
const RECON_DOCS: Record<string, {
  key: string; label: string; desc: string;
  uploaderRole: string[]; requiresApproval: boolean;
}[]> = {
  TELKOM_INFRA: [
    // Admin Project uploads; PM FTTT reviews/approves
    { key: 'RISALAH_RAPAT_MOM',       label: 'Risalah Rapat / MOM',      desc: 'Minutes of Meeting rekonsiliasi project bersama Telkom Infra', uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BOQ_REKONSILIASI',         label: 'BOQ Rekonsiliasi',          desc: 'BOQ final hasil rekonsiliasi sesuai kondisi lapangan aktual',  uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BA_PENUTUPAN',             label: 'BA Penutupan',              desc: 'Berita Acara Penutupan Project',                               uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BAPP_TI',                  label: 'BAPP',                      desc: 'Berita Acara Pemeriksaan Pekerjaan',                           uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BAST_1_TI',                label: 'BAST 1',                    desc: 'Berita Acara Serah Terima 1 dari Telkom Infra',                uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'NOTA_DINAS',               label: 'Nota Dinas',                desc: 'Nota Dinas terkait rekonsiliasi project',                      uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'NOTA_DINAS_TIM_UJI_TERIMA', label: 'Nota Dinas Tim Uji Terima', desc: 'Nota Dinas Tim Uji Terima dari Telkom Infra',               uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'PO_TI',                    label: 'PO',                        desc: 'Purchase Order dari Telkom Infra',                             uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'AMANDEMEN_1_TI',           label: 'Amandemen 1',               desc: 'Dokumen Amandemen 1 dari Telkom Infra',                        uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'AMANDEMEN_2_TI',           label: 'Amandemen 2',               desc: 'Dokumen Amandemen 2 dari Telkom Infra',                        uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    // NOTE: Jaminan Pemeliharaan & Invoice Final are in Project Closing phase (not here)
  ],
  PST: [
    // Admin Project uploads; PM FTTT reviews/approves
    { key: 'REKONSILIASI',     label: 'Rekonsiliasi',  desc: 'Penyamaan DRM sebelum implementasi vs actual lapangan',  uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BAST',             label: 'BAST',          desc: 'Berita Acara Serah Terima PST',                          uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'GOOD_RECEIPT_PST', label: 'Good Receipt',  desc: 'Completion Cert. GERN & Lampiran Smile',                 uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    // NOTE: Invoice PST moved to Project Closing phase
  ],
  // iFORTE (Testing Issues iForte): Endorsement (wajib, approval) + BAST/Termin MCV
  // (wajib) + BA Justifikasi (opsional, hanya bila BOQ ILT ≠ BOQ iFORTE).
  // PO Final terbit via sistem iFORTE (tidak diupload); Invoice pindah ke Project Closing.
  IFORTE: [
    { key: 'ENDORSEMENT',    label: 'Endorsement',               desc: 'Dokumen Endorsement — diajukan juga pada sistem iFORTE',                      uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BA_JUSTIFIKASI', label: 'BA Justifikasi (Opsional)', desc: 'Hanya bila terdapat perbedaan antara BOQ ILT dan BOQ iFORTE — wajib disetujui PM bila diunggah', uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
    { key: 'BAST_TERMIN_MCV', label: 'BAST / Termin MCV',        desc: 'Dasar proses penagihan (billing) — wajib disetujui PM FTTT',   uploaderRole: ['ADMIN', 'GENERAL_MANAGER'], requiresApproval: true },
  ],
};

function ReconciliationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const docs = RECON_DOCS[project.ftttCompany] ?? [];
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [formContents, setFormContents] = useState<Record<string, string>>({});
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', PENDING_ADMIN: '#0969DA', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', PENDING_ADMIN: 'Menunggu Admin', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  const existing = (key: string) => project.reconDocs?.find((d) => d.docKey === key) ?? null;

  const canUploadForKey = (uploaderRoles: string[]) =>
    uploaderRoles.includes(userRole) || userRole === 'GENERAL_MANAGER';

  const handleUpload = async (key: string, file: File) => {
    setUploadingKey(key);
    const fd = new FormData();
    fd.append('docKey', key);
    fd.append('file', file);
    if (notes[key]) fd.append('notes', notes[key]);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/recon-docs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen berhasil diunggah');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleGenerateForm = async (key: string) => {
    const content = formContents[key]?.trim();
    if (!content) { toast.error('Isi dokumen wajib diisi'); return; }
    setUploadingKey(key);
    const fd = new FormData();
    fd.append('docKey', key);
    fd.append('formContent', content);
    if (notes[key]) fd.append('notes', notes[key]);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/recon-docs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen berhasil disimpan — menunggu persetujuan');
      setFormContents((prev) => ({ ...prev, [key]: '' }));
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  const handleApprove = async (docId: string, approved: boolean, rejNotes?: string) => {
    const res = await apiFetch(`/fttt-projects/recon-docs/${docId}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, rejectionNotes: rejNotes }),
    }, user?.id);
    if (res.ok) { toast.success(approved ? 'Disetujui' : 'Ditolak'); onRefresh(); }
    else { const e = await res.json().catch(() => ({})); toast.error((e as {message?: string}).message ?? 'Gagal'); }
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>
        Dokumen Rekonsiliasi & Billing — {project.ftttCompany === 'TELKOM_INFRA' ? 'Telkom Infra' : project.ftttCompany === 'PST' ? 'PST' : 'iFORTE'}
      </p>

      {docs.map((doc) => {
        const rec = existing(doc.key);
        const canUpload = canUploadForKey(doc.uploaderRole);
        const isUploading = uploadingKey === doc.key;

        return (
          <div key={doc.key} style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{doc.label}</span>
                  <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>
                    {doc.uploaderRole.join(' / ')}
                  </span>
                  {rec && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[rec.approvalStatus] ?? '#57606a' }}>
                      {STATUS_LABELS[rec.approvalStatus] ?? rec.approvalStatus}
                    </span>
                  )}
                  {!rec && <span style={{ fontSize: 10, color: '#8c959f' }}>Belum diunggah</span>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>{doc.desc}</p>
                {rec?.notes && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>📝 {rec.notes}</p>}
                {rec?.approvalStatus === 'REJECTED' && rec.rejectionNotes && (
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: '#cf222e', fontStyle: 'italic' }}>Ditolak: {rec.rejectionNotes}</p>
                )}
                {rec?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {rec.uploadedBy.name}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {rec?.fileUrl && <a href={fixFileUrl(rec.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}

                {/* PM approve/reject with mandatory reason */}
                {userRole === 'PM_FTTT' && rec && rec.approvalStatus === 'PENDING_PM' && doc.requiresApproval && (
                  <>
                    <button type="button" onClick={() => void handleApprove(rec.id, true)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓</button>
                    <button type="button" onClick={() => { setRejectTarget(rec.id); setRejectReason(''); }}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗</button>
                  </>
                )}
                {(userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER') && rec && rec.approvalStatus === 'PENDING_ADMIN' && doc.requiresApproval && (
                  <>
                    <button type="button" onClick={() => void handleApprove(rec.id, true)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Setujui</button>
                    <button type="button" onClick={() => { setRejectTarget(rec.id); setRejectReason(''); }}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗ Tolak</button>
                  </>
                )}

                {/* Upload / Replace button — C5-Issue1: all docs are now Upload File */}
                {canUpload && (!rec || rec.approvalStatus === 'REJECTED') && (
                  <>
                    <input
                      ref={(el) => { fileRefs.current[doc.key] = el; }}
                      type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(doc.key, f); }} />
                    <button type="button"
                      onClick={() => fileRefs.current[doc.key]?.click()} disabled={isUploading}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: rec ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {isUploading ? '…' : rec ? '🔄 Ganti' : '+ Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Rejection reason dialog */}
      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#cf222e' }}>Alasan Penolakan</h3>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4}
              placeholder="Tuliskan alasan penolakan… (wajib)"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRejectTarget(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer' }}>Batal</button>
              <button type="button" onClick={() => { if (rejectReason.trim()) { void handleApprove(rejectTarget, false, rejectReason.trim()); setRejectTarget(null); setRejectReason(''); } }}
                disabled={!rejectReason.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectReason.trim() ? '#cf222e' : '#8C959F', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Konfirmasi Tolak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Procurement Section (PST-5: PM uploads PO between Preparation and Implementation) ─
function ProcurementSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  // Issue 8: Finance uploads PO (not PM FTTT)
  const canUpload = userRole === 'FINANCE' || userRole === 'GENERAL_MANAGER';
  const [uploading, setUploadingKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const poProcurement = project.reconDocs?.find((d) => d.docKey === 'PO_PROCUREMENT') ?? null;

  const handleUpload = async (file: File) => {
    setUploadingKey('PO_PROCUREMENT');
    const fd = new FormData();
    fd.append('docKey', 'PO_PROCUREMENT');
    fd.append('file', file);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/recon-docs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Purchase Order berhasil diunggah');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingKey(null); }
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Procurement — Purchase Order</p>
      <p style={{ fontSize: 12, color: '#57606a', marginBottom: 12 }}>
        Finance wajib meng-upload dokumen Purchase Order (PO) sebelum fase ini dapat diselesaikan dan project berlanjut ke Implementation.
      </p>

      <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, border: '1px solid #EAEEF2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>📄 Purchase Order (PO)</span>
              <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Finance</span>
              {poProcurement
                ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1a7f37' }}>✓ Diunggah</span>
                : <span style={{ fontSize: 10, color: '#cf222e', fontWeight: 600 }}>⚠️ WAJIB — belum diunggah</span>}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Dokumen Purchase Order yang telah diterbitkan</p>
            {poProcurement?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {poProcurement.uploadedBy.name}</p>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {poProcurement?.fileUrl && <a href={fixFileUrl(poProcurement.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
            {canUpload && (
              <>
                <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading === 'PO_PROCUREMENT'}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: poProcurement ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                  {uploading === 'PO_PROCUREMENT' ? '…' : poProcurement ? '🔄 Ganti' : '+ Upload PO'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Project Closing Section ──────────────────────────────────────────────────
// Issue 7 (TI): Only Jaminan Pemeliharaan + Invoice Final (Finance); no BAST II/Evidence/Catatan
// Issue 12 (PST): Finance uploads Invoice + Jaminan Pemeliharaan + Jaminan Pelaksanaan; Admin confirms
function ClosingSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  // Admin can manage closing activities (BAST II for iFORTE)
  const canUpload    = ['ADMIN', 'GENERAL_MANAGER'].includes(userRole);
  const canApprove   = ['PM_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(userRole);
  const isFinance    = userRole === 'FINANCE';
  const isTI         = project.ftttCompany === 'TELKOM_INFRA';
  const isPST        = project.ftttCompany === 'PST';
  const isIforte     = project.ftttCompany === 'IFORTE';

  // C6-TI3: Maintenance period gate — Admin must confirm before uploads are enabled (iFORTE)
  const [maintenanceConfirmed, setMaintenanceConfirmed] = useState(false);
  const uploadEnabled = canUpload && maintenanceConfirmed;

  // JLM: persisted maintenance confirmation (TI + PST) + end-date reminder
  const maintConfirmed = !!project.maintenanceConfirmedAt;
  const maintEndDate   = project.maintenanceEndDate ? new Date(project.maintenanceEndDate) : null;
  const maintDaysLeft  = maintEndDate ? Math.ceil((maintEndDate.getTime() - Date.now()) / 86400000) : null;
  const showMaintReminder = (isTI || isPST) && !!maintEndDate && !maintConfirmed && maintDaysLeft !== null && maintDaysLeft <= 3;
  const [confirming, setConfirming] = useState(false);
  const [maintAgree, setMaintAgree] = useState(false);
  const [maintEndInput, setMaintEndInput] = useState(
    project.maintenanceEndDate ? project.maintenanceEndDate.slice(0, 10) : '',
  );

  const handleConfirmMaintenance = async () => {
    setConfirming(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/confirm-maintenance`, { method: 'POST' }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Konfirmasi penyelesaian masa pemeliharaan tersimpan');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setConfirming(false); }
  };

  const logs: FtttClosingLog[] = project.closingLogs ?? [];
  const bastII    = logs.find((l) => l.logType === 'BAST_II') ?? null;
  const evidences = logs.filter((l) => l.logType === 'EVIDENCE');
  const notes_list= logs.filter((l) => l.logType === 'NOTE');

  // TI closing docs stored in reconDocs
  const jaminanPemeliharaan    = project.reconDocs?.find((d) => d.docKey === 'JAMINAN_PEMELIHARAAN') ?? null;
  const invoiceFinal           = project.reconDocs?.find((d) => d.docKey === 'INVOICE_FINAL') ?? null;
  // PST closing docs stored in reconDocs
  const invoicePstClosing      = project.reconDocs?.find((d) => d.docKey === 'INVOICE_PST_CLOSING') ?? null;
  const jaminanPemeliharaanPst = project.reconDocs?.find((d) => d.docKey === 'JAMINAN_PEMELIHARAAN_PST') ?? null;
  const jaminanPelaksanaanPst  = project.reconDocs?.find((d) => d.docKey === 'JAMINAN_PELAKSANAAN_PST') ?? null;
  // iFORTE closing (Testing Issues iForte): Finance uploads Invoice (dasar: BAST/Termin MCV)
  const invoiceIforte          = project.reconDocs?.find((d) => d.docKey === 'INVOICE_IFORTE') ?? null;
  const paymentStatus          = project.paymentStatus ?? null;
  const [settingPayment, setSettingPayment] = useState(false);
  const invoiceIforteRef       = useRef<HTMLInputElement>(null);

  const handleSetPayment = async (status: 'UNPAID' | 'PAID') => {
    setSettingPayment(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/payment-status`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success(status === 'PAID' ? 'Pembayaran ditandai LUNAS' : 'Status pembayaran: Belum Lunas');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setSettingPayment(false); }
  };

  const [logType, setLogType] = useState<'BAST_II' | 'EVIDENCE' | 'NOTE'>('BAST_II');
  const [caption, setCaption] = useState('');
  const [notes,   setNotes]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadingReconKey, setUploadingReconKey] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const bastiiFileRef        = useRef<HTMLInputElement>(null);
  const jaminanFileRef       = useRef<HTMLInputElement>(null);
  const invoiceFileRef       = useRef<HTMLInputElement>(null);
  const jaminanPemPstRef     = useRef<HTMLInputElement>(null);
  const jaminanPelPstRef     = useRef<HTMLInputElement>(null);
  const invoicePstRef        = useRef<HTMLInputElement>(null);

  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  // Upload Jaminan Pemeliharaan or Invoice Final (reconDocs)
  // JLM: maintenance end date is sent together with the Jaminan Pemeliharaan upload
  const JAMINAN_PEM_KEYS = ['JAMINAN_PEMELIHARAAN', 'JAMINAN_PEMELIHARAAN_PST'];
  const handleReconUpload = async (docKey: string, file: File) => {
    if (JAMINAN_PEM_KEYS.includes(docKey) && !maintEndInput && !project.maintenanceEndDate) {
      toast.error('Isi Tanggal Berakhir Masa Pemeliharaan terlebih dahulu');
      return;
    }
    setUploadingReconKey(docKey);
    const fd = new FormData();
    fd.append('docKey', docKey);
    fd.append('file', file);
    if (JAMINAN_PEM_KEYS.includes(docKey) && maintEndInput) fd.append('maintenanceEndDate', maintEndInput);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/recon-docs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Dokumen berhasil diunggah');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploadingReconKey(null); }
  };

  const handleUpload = async (files?: FileList | null) => {
    const fileArr = files ? Array.from(files) : [];
    setUploading(true);
    try {
      if (logType === 'NOTE') {
        const fd = new FormData();
        fd.append('logType', 'NOTE');
        if (caption) fd.append('caption', caption);
        if (notes)   fd.append('notes', notes);
        const res = await apiFetch(`/fttt-projects/${project.id}/closing-logs`, { method: 'POST', body: fd }, user?.id);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
        toast.success('Catatan berhasil disimpan');
      } else if (fileArr.length > 0) {
        for (let i = 0; i < fileArr.length; i++) {
          if (fileArr.length > 1) setUploadProgress(`Mengunggah ${i + 1}/${fileArr.length}…`);
          const fd = new FormData();
          fd.append('logType', logType);
          fd.append('caption', caption || (logType === 'BAST_II' ? 'BAST II' : `Evidence ${i + 1}`));
          if (notes) fd.append('notes', notes);
          fd.append('file', fileArr[i]);
          const res = await apiFetch(`/fttt-projects/${project.id}/closing-logs`, { method: 'POST', body: fd }, user?.id);
          if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as {message?: string}).message ?? 'Gagal'); }
        }
        toast.success(fileArr.length > 1 ? `${fileArr.length} file berhasil diunggah` : 'Dokumen berhasil diunggah');
      }
      setCaption(''); setNotes(''); setUploadProgress(''); onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); setUploadProgress(''); }
  };

  const handleApprove = async (logId: string, approved: boolean, rejNotes?: string) => {
    const res = await apiFetch(`/fttt-projects/closing-logs/${logId}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, rejectionNotes: rejNotes }),
    }, user?.id);
    if (res.ok) { toast.success(approved ? 'BAST II disetujui' : 'BAST II ditolak'); onRefresh(); }
    else { const e = await res.json().catch(() => ({})); toast.error((e as {message?: string}).message ?? 'Gagal'); }
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Aktivitas Project Closing</p>
      <p style={{ fontSize: 12, color: '#57606a', marginBottom: 10 }}>
        Serah terima project kepada client setelah masa pemeliharaan selesai. Hanya Admin yang dapat mengelola dokumen fase ini.
      </p>

      {/* JLM: maintenance end-date reminder (TI + PST) */}
      {showMaintReminder && (
        <div style={{ background: maintDaysLeft !== null && maintDaysLeft <= 0 ? '#FFEBE9' : '#FFF8C5', border: `1px solid ${maintDaysLeft !== null && maintDaysLeft <= 0 ? '#cf222e' : '#d4a017'}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: maintDaysLeft !== null && maintDaysLeft <= 0 ? '#cf222e' : '#9a6700' }}>
            ⏰ {maintDaysLeft !== null && maintDaysLeft <= 0 ? 'Masa pemeliharaan telah berakhir' : 'Masa pemeliharaan akan segera berakhir'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: maintDaysLeft !== null && maintDaysLeft <= 0 ? '#a40e26' : '#9a6700' }}>
            Berakhir: {maintEndDate?.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}
            {maintDaysLeft !== null && maintDaysLeft > 0 ? ` (${maintDaysLeft} hari lagi)` : ''}. Silakan lakukan konfirmasi penyelesaian masa pemeliharaan untuk melanjutkan proses Project Closing.
          </p>
        </div>
      )}

      {/* JLM: Finance inputs the maintenance end date with the Jaminan Pemeliharaan upload (TI + PST) */}
      {isFinance && (isTI || isPST) && (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#0969DA', marginBottom: 6 }}>
            🗓️ Tanggal Berakhir Masa Pemeliharaan (wajib sebelum upload Jaminan Pemeliharaan)
          </label>
          <input type="date" value={maintEndInput} onChange={(e) => setMaintEndInput(e.target.value)}
            style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #D0D7DE', fontSize: 12 }} />
          {project.maintenanceEndDate && (
            <span style={{ fontSize: 11, color: '#57606a', marginLeft: 8 }}>
              Tersimpan: {new Date(project.maintenanceEndDate).toLocaleDateString('id-ID')}
            </span>
          )}
        </div>
      )}

      {/* JLM: Admin maintenance-completion checklist gate (TI + PST) */}
      {(isTI || isPST) && canUpload && !maintConfirmed && (
        <div style={{ background: '#FFF8C5', border: '1px solid #d4a017', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 13, color: '#9a6700' }}>
            ⚠️ Konfirmasi Penyelesaian Masa Pemeliharaan
          </p>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#9a6700' }}>
            Project hanya dapat diselesaikan (Closed) setelah Admin Project mengkonfirmasi bahwa masa pemeliharaan telah selesai.
          </p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={maintAgree} onChange={(e) => setMaintAgree(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, cursor: 'pointer' }} />
            <span style={{ fontSize: 12, color: '#9a6700', fontWeight: 600 }}>
              Saya menyatakan bahwa masa pemeliharaan project telah selesai dan seluruh kewajiban pemeliharaan telah dipenuhi.
            </span>
          </label>
          <button type="button" disabled={!maintAgree || confirming} onClick={() => void handleConfirmMaintenance()}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: !maintAgree || confirming ? '#E5E7EB' : '#1a7f37', color: !maintAgree || confirming ? '#9CA3AF' : '#fff', fontWeight: 700, fontSize: 12, cursor: !maintAgree || confirming ? 'not-allowed' : 'pointer' }}>
            {confirming ? 'Menyimpan…' : '✓ Konfirmasi Penyelesaian'}
          </button>
        </div>
      )}
      {(isTI || isPST) && maintConfirmed && (
        <div style={{ background: '#DAFBE1', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: '#1a7f37' }}>
          ✅ Masa pemeliharaan telah dikonfirmasi selesai
          {project.maintenanceConfirmedAt ? ` pada ${new Date(project.maintenanceConfirmedAt).toLocaleDateString('id-ID')}` : ''} — Project Closing dapat diselesaikan.
        </div>
      )}

      {!isFinance && (isTI || isPST) && (
        <div style={{ background: '#F6F8FA', border: '1px solid #D0D7DE', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: '#57606a' }}>
          ℹ️ Dokumen Project Closing diunggah oleh Finance.
        </div>
      )}

      {/* ── iFORTE (Testing Issues iForte): Invoice + monitoring status pembayaran ── */}
      {isIforte && (
        <>
          {!isFinance && (
            <div style={{ background: '#F6F8FA', border: '1px solid #D0D7DE', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12, color: '#57606a' }}>
              ℹ️ Invoice diunggah oleh Finance berdasarkan dokumen BAST / Termin MCV, kemudian status pembayaran dimonitor hingga LUNAS.
            </div>
          )}

          {/* Invoice */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>🧾 Invoice</span>
                  <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Finance</span>
                  {invoiceIforte
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1a7f37' }}>✓ Diunggah</span>
                    : <span style={{ fontSize: 10, color: '#cf222e', fontWeight: 600 }}>⚠️ WAJIB — belum diunggah</span>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Diterbitkan berdasarkan dokumen BAST / Termin MCV</p>
                {invoiceIforte?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {invoiceIforte.uploadedBy.name}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {invoiceIforte?.fileUrl && <a href={fixFileUrl(invoiceIforte.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
                {isFinance && (
                  <>
                    <input ref={invoiceIforteRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReconUpload('INVOICE_IFORTE', f); }} />
                    <button type="button" onClick={() => invoiceIforteRef.current?.click()} disabled={uploadingReconKey === 'INVOICE_IFORTE'}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: invoiceIforte ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {uploadingReconKey === 'INVOICE_IFORTE' ? '…' : invoiceIforte ? '🔄 Ganti' : '+ Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Monitoring status pembayaran */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>💳 Status Pembayaran</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999,
                    background: paymentStatus === 'PAID' ? '#DAFBE1' : '#FFF8C5',
                    color: paymentStatus === 'PAID' ? '#1a7f37' : '#9a6700',
                  }}>
                    {paymentStatus === 'PAID' ? '✓ LUNAS (PAID)' : '⏳ BELUM LUNAS'}
                  </span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>
                  Project berubah menjadi Closed setelah invoice diunggah dan pembayaran ditandai LUNAS, lalu Admin menyelesaikan fase.
                </p>
              </div>
              {(isFinance || canUpload) && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {paymentStatus !== 'PAID' ? (
                    <button type="button" onClick={() => void handleSetPayment('PAID')} disabled={settingPayment || !invoiceIforte}
                      title={!invoiceIforte ? 'Upload Invoice terlebih dahulu' : ''}
                      style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: !invoiceIforte ? '#8C959F' : '#1a7f37', color: '#fff', fontWeight: 700, cursor: !invoiceIforte ? 'not-allowed' : 'pointer', fontSize: 12 }}>
                      {settingPayment ? '…' : '✅ Tandai LUNAS'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => void handleSetPayment('UNPAID')} disabled={settingPayment}
                      style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', color: '#57606a', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                      {settingPayment ? '…' : '↩️ Batalkan LUNAS'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── C5-Issue3: Jaminan Pemeliharaan + Invoice Final (Telkom Infra only, Finance) ── */}
      {isTI && (
        <>
          {/* Jaminan Pemeliharaan */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>🔒 Jaminan Pemeliharaan</span>
                  <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Finance</span>
                  {jaminanPemeliharaan
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1a7f37' }}>✓ Diunggah</span>
                    : <span style={{ fontSize: 10, color: '#cf222e', fontWeight: 600 }}>⚠️ WAJIB — belum diunggah</span>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Dokumen jaminan masa pemeliharaan project</p>
                {jaminanPemeliharaan?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {jaminanPemeliharaan.uploadedBy.name}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {jaminanPemeliharaan?.fileUrl && <a href={fixFileUrl(jaminanPemeliharaan.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
                {/* C7.3: Finance uploads Jaminan independently — no maintenance confirmation needed */}
                {isFinance && (
                  <>
                    <input ref={jaminanFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReconUpload('JAMINAN_PEMELIHARAAN', f); }} />
                    <button type="button" onClick={() => jaminanFileRef.current?.click()} disabled={uploadingReconKey === 'JAMINAN_PEMELIHARAAN'}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: jaminanPemeliharaan ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {uploadingReconKey === 'JAMINAN_PEMELIHARAAN' ? '…' : jaminanPemeliharaan ? '🔄 Ganti' : '+ Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Invoice Final */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>🧾 Invoice Final</span>
                  <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Finance</span>
                  {invoiceFinal
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1a7f37' }}>✓ Diunggah</span>
                    : <span style={{ fontSize: 10, color: '#cf222e', fontWeight: 600 }}>⚠️ WAJIB — belum diunggah</span>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Tagihan akhir project kepada Telkom Infra</p>
                {invoiceFinal?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {invoiceFinal.uploadedBy.name}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {invoiceFinal?.fileUrl && <a href={fixFileUrl(invoiceFinal.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
                {/* C7.3: Finance uploads Invoice independently — no maintenance confirmation needed */}
                {isFinance && (
                  <>
                    <input ref={invoiceFileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReconUpload('INVOICE_FINAL', f); }} />
                    <button type="button" onClick={() => invoiceFileRef.current?.click()} disabled={uploadingReconKey === 'INVOICE_FINAL'}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: invoiceFinal ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {uploadingReconKey === 'INVOICE_FINAL' ? '…' : invoiceFinal ? '🔄 Ganti' : '+ Upload'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── PST Closing: Finance uploads Invoice + Jaminan Pemeliharaan + Jaminan Pelaksanaan ── */}
      {isPST && (
        <>
          {[
            { key: 'INVOICE_PST_CLOSING', label: '🧾 Invoice', desc: 'Tagihan akhir project PST', doc: invoicePstClosing, ref: invoicePstRef },
            { key: 'JAMINAN_PEMELIHARAAN_PST', label: '🔒 Jaminan Pemeliharaan', desc: 'Dokumen jaminan masa pemeliharaan PST', doc: jaminanPemeliharaanPst, ref: jaminanPemPstRef },
            { key: 'JAMINAN_PELAKSANAAN_PST', label: '🔒 Jaminan Pelaksanaan', desc: 'Dokumen jaminan pelaksanaan PST', doc: jaminanPelaksanaanPst, ref: jaminanPelPstRef },
          ].map(({ key, label, desc, doc, ref }) => (
            <div key={key} style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                    <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Finance</span>
                    {doc ? <span style={{ fontSize: 10, fontWeight: 700, color: '#1a7f37' }}>✓ Diunggah</span>
                         : <span style={{ fontSize: 10, color: '#cf222e', fontWeight: 600 }}>⚠️ WAJIB — belum diunggah</span>}
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>{desc}</p>
                  {doc?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {doc.uploadedBy.name}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {doc?.fileUrl && <a href={fixFileUrl(doc.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
                  {isFinance && (
                    <>
                      <input ref={ref} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReconUpload(key, f); }} />
                      <button type="button" onClick={() => ref.current?.click()} disabled={uploadingReconKey === key}
                        style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: doc ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                        {uploadingReconKey === key ? '…' : doc ? '🔄 Ganti' : '+ Upload'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── iFORTE legacy: BAST II / Evidence / Catatan — hanya tampil untuk project
          lama yang sudah punya data closing log (proses baru memakai Invoice + Payment) ── */}
      {isIforte && logs.length > 0 && (
        <>
          {/* BAST II */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>📄 BAST II</span>
                  <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Admin</span>
                  {bastII?.approvalStatus && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[bastII.approvalStatus] }}>
                      {STATUS_LABELS[bastII.approvalStatus]}
                    </span>
                  )}
                  {!bastII && <span style={{ fontSize: 10, color: '#8c959f' }}>Belum diunggah</span>}
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Berita Acara Serah Terima II — perlu disetujui PM FTTT</p>
                {bastII?.notes && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>📝 {bastII.notes}</p>}
                {bastII?.approvalStatus === 'REJECTED' && bastII.rejectionNotes && (
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: '#cf222e', fontStyle: 'italic' }}>Ditolak: {bastII.rejectionNotes}</p>
                )}
                {bastII?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {bastII.uploadedBy.name}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                {bastII?.fileUrl && <a href={fixFileUrl(bastII.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
                {canApprove && bastII?.approvalStatus === 'PENDING_PM' && (
                  <>
                    <button type="button" onClick={() => void handleApprove(bastII.id, true)}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Setujui</button>
                    <button type="button" onClick={() => { setRejectTarget(bastII.id); setRejectReason(''); }}
                      style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗ Tolak</button>
                  </>
                )}
                {uploadEnabled && (!bastII || bastII.approvalStatus === 'REJECTED') && (
                  <>
                    <input ref={bastiiFileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { setLogType('BAST_II'); void handleUpload(e.target.files); }} />
                    <button type="button" onClick={() => { setLogType('BAST_II'); bastiiFileRef.current?.click(); }} disabled={uploading}
                      style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: bastII ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                      {uploading && logType === 'BAST_II' ? '…' : bastII ? '🔄 Ganti BAST II' : '+ Upload BAST II'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Evidence Photos */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>
              📷 Evidence Serah Terima
              <span style={{ fontWeight: 400, fontSize: 12, color: '#57606a', marginLeft: 8 }}>({evidences.length} foto)</span>
            </p>
            {evidences.map((ev) => (
              <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #EAEEF2', marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>📷</span>
                <div style={{ flex: 1 }}>
                  {ev.caption && <p style={{ margin: 0, fontSize: 12 }}>{ev.caption}</p>}
                  <p style={{ margin: 0, fontSize: 10, color: '#8c959f' }}>oleh {ev.uploadedBy.name}</p>
                </div>
                {ev.fileUrl && <a href={fixFileUrl(ev.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
              </div>
            ))}
            {uploadEnabled && (
              <>
                <input type="file" id="evidence-file-input" multiple accept=".jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                  onChange={(e) => { setLogType('EVIDENCE'); void handleUpload(e.target.files); }} />
                <button type="button" onClick={() => { setLogType('EVIDENCE'); document.getElementById('evidence-file-input')?.click(); }}
                  disabled={uploading}
                  style={{ marginTop: 8, padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {uploading && logType === 'EVIDENCE' ? (uploadProgress || 'Mengunggah…') : '📷 Upload Evidence (dapat pilih banyak)'}
                </button>
              </>
            )}
          </div>

          {/* Closing Notes */}
          <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>
              📝 Catatan Penutupan
              <span style={{ fontWeight: 400, fontSize: 12, color: '#57606a', marginLeft: 8 }}>({notes_list.length} catatan)</span>
            </p>
            {notes_list.map((n) => (
              <div key={n.id} style={{ padding: '6px 8px', background: '#fff', borderRadius: 6, marginBottom: 4, border: '1px solid #EAEEF2' }}>
                {n.caption && <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{n.caption}</p>}
                {n.notes && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#57606a' }}>{n.notes}</p>}
                <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {n.uploadedBy.name}</p>
              </div>
            ))}
            {uploadEnabled && (
              <div style={{ marginTop: 8 }}>
                <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Judul catatan (opsional)"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }} />
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                  placeholder="Validasi masa pemeliharaan selesai, kondisi akhir project, catatan serah terima…"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 6, boxSizing: 'border-box', resize: 'vertical' }} />
                <button type="button" onClick={() => { setLogType('NOTE'); void handleUpload(); }} disabled={uploading || (!caption.trim() && !notes.trim())}
                  style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {uploading && logType === 'NOTE' ? 'Menyimpan…' : '+ Simpan Catatan'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Rejection reason dialog for BAST II */}
      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#cf222e' }}>Alasan Penolakan BAST II</h3>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4}
              placeholder="Tuliskan alasan penolakan BAST II… (wajib)"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setRejectTarget(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer' }}>Batal</button>
              <button type="button"
                onClick={() => { if (rejectReason.trim()) { void handleApprove(rejectTarget, false, rejectReason.trim()); setRejectTarget(null); } }}
                disabled={!rejectReason.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectReason.trim() ? '#cf222e' : '#8C959F', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Konfirmasi Tolak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Detail Page ─────────────────────────────────────────────────────────
export default function FtttProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [project, setProject] = useState<FtttProject | null>(null);
  const [readiness, setReadiness] = useState<{ ready: boolean; blockedReasons: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/fttt-projects/${id}`, {}, user?.id);
      if (!res.ok) return;
      const data = await res.json() as FtttProject;
      setProject(data);

      // Load readiness
      const r2 = await apiFetch(`/fttt-projects/${id}/phase-readiness`, {}, user?.id);
      if (r2.ok) setReadiness(await r2.json());
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => { void load(); }, [load]);

  // Live update via socket
  useEffect(() => {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    const socket: Socket = io(API_HOST, { auth: { token } });
    socketRef.current = socket;
    socket.on('fttt:phase_advanced', (payload: any) => {
      if (payload.projectId === id) void load();
    });
    return () => { socket.disconnect(); };
  }, [id, load]);

  const handleAdvance = async () => {
    setAdvancing(true);
    try {
      const res = await apiFetch(`/fttt-projects/${id}/advance-phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, user?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        toast.error(err.message ?? 'Gagal advance phase');
        return;
      }
      toast.success('Phase berhasil diselesaikan');
      void load();
    } finally {
      setAdvancing(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#57606a' }}>Memuat project…</div>;
  if (!project)  return <div style={{ padding: 40, textAlign: 'center', color: '#cf222e' }}>Project tidak ditemukan.</div>;

  const statusCfg = FTTT_PROJECT_STATUS_LABELS[project.status] ?? { label: project.status, color: 'gray' };
  const colorMap: Record<string, { bg: string; text: string }> = {
    blue:   { bg: '#DDF4FF', text: '#0969DA' },
    green:  { bg: '#DAFBE1', text: '#1a7f37' },
    orange: { bg: '#FFF8C5', text: '#9a6700' },
    red:    { bg: '#FFEBE9', text: '#cf222e' },
    gray:   { bg: '#F6F8FA', text: '#57606a' },
  };
  const sc = colorMap[statusCfg.color] ?? colorMap.gray;

  const isCompletedOrCancelled = ['COMPLETED', 'CANCELLED'].includes(project.status);
  const currentProgress = project.phaseProgresses.find((p) => p.phase === project.currentPhase);
  const isPm  = project.pmId === user?.id || user?.role === 'PM_FTTT';
  const userRole = user?.role ?? '';
  // v2: Surveyor FTTT only sees Validation & Survey activities (parallel survey OK)
  const isSurveyorFttt = userRole === 'SURVEYOR_FTTT';
  // Integra V2/V3: Bulky Project only manages Initiation lifecycle — operational
  // phase actions (Survey, Implementation, etc.) belong to its Sites
  const isBulky = project.hierarchyLevel === 'BULKY';
  const bulkySiteInitProg = project.phaseProgresses.find((p) => p.phase === 'SITE_INITIATION');
  const bulkyInitiationDone =
    isBulky &&
    (bulkySiteInitProg?.status === 'COMPLETED' ||
      !BULKY_PHASES.includes(project.currentPhase));
  const canShowAdvance =
    !isCompletedOrCancelled &&
    !isSurveyorFttt &&
    readiness &&
    !(isBulky && bulkyInitiationDone) &&
    (() => {
      // C5: Implementation — Admin only
      if (project.currentPhase === 'IMPLEMENTATION' && userRole !== 'ADMIN' && userRole !== 'GENERAL_MANAGER') return false;
      // C6-TI2: Documentation & Reconciliation — PM FTTT + Admin only
      if ((project.currentPhase === 'DOCUMENTATION' || project.currentPhase === 'RECONCILIATION') &&
          userRole === 'SURVEYOR_FTTT') return false;
      // JLM: Project Closing — Admin only (after maintenance confirmation)
      if (project.currentPhase === 'CLOSING' && userRole !== 'ADMIN' && userRole !== 'GENERAL_MANAGER') return false;
      return true;
    })();

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      {project.hierarchyLevel === 'SITE' && project.parentId ? (
        <Link href={`/fttt-projects/${project.parentId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16, textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Kembali ke Bulky Project
        </Link>
      ) : (
        <Link href="/fttt-projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16, textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Daftar FTTT Projects
        </Link>
      )}

      {/* Header */}
      <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FFF8C5', color: '#9a6700' }}>FTTT</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#DDF4FF', color: '#0969DA' }}>
                {FTTT_COMPANY_LABELS[project.ftttCompany]}
              </span>
              {isBulky && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F0F8FF', color: '#0550AE' }}>
                  Parent / Bulky
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.text }}>
                {statusCfg.label}
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              {project.projectName ?? `Project ${project.id.slice(-6).toUpperCase()}`}
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#57606a' }}>
              PM: {project.pm?.name} · {FTTT_DOC_TYPE_LABELS[project.triggerDocType]} ·{' '}
              <a href={fixFileUrl(project.triggerDocUrl)} target="_blank" rel="noopener noreferrer" style={{ color: '#0969DA' }}>
                Lihat dokumen triggering ↗
              </a>
              {/* Issue 13: Replace trigger doc in INITIATION phase */}
              {project.currentPhase === 'INITIATION' && (userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER' || userRole === 'PM_FTTT') && (
                <>
                  <input id="trigger-doc-replace" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      const fd = new FormData(); fd.append('file', f);
                      try {
                        const res = await apiFetch(`/fttt-projects/${project.id}/trigger-doc`, { method: 'PUT', body: fd }, user?.id);
                        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
                        toast.success('Dokumen triggering berhasil diganti'); void load();
                      } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
                    }} />
                  <button type="button" onClick={() => document.getElementById('trigger-doc-replace')?.click()}
                    style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, border: '1px solid #D0D7DE', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#57606a' }}>
                    🔄 Ganti
                  </button>
                </>
              )}
            </p>
          </div>
          {/* Integra V3: hide Selesaikan Fase on Parent after Initiation + Site Initiation */}
          {canShowAdvance && (
            <button
              onClick={handleAdvance}
              disabled={advancing || !readiness.ready}
              title={readiness.ready ? 'Selesaikan fase ini dan lanjut ke berikutnya' : readiness.blockedReasons.join('; ')}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13,
                background: readiness.ready ? '#1a7f37' : '#D0D7DE',
                color: readiness.ready ? '#fff' : '#8C959F',
                cursor: readiness.ready && !advancing ? 'pointer' : 'not-allowed',
              }}
            >
              {advancing ? 'Memproses…' : `Selesaikan Fase → ${FTTT_PHASE_LABELS[project.currentPhase]}`}
            </button>
          )}
          {isBulky && bulkyInitiationDone && !isSurveyorFttt && (
            <div style={{ padding: '8px 14px', borderRadius: 8, background: '#DAFBE1', border: '1px solid #1a7f37', fontSize: 12, color: '#1a7f37' }}>
              Parent Initiation selesai — lanjutkan lifecycle operasional di masing-masing Child Site.
            </div>
          )}
          {/* Role-gated info messages */}
          {!isCompletedOrCancelled && !isSurveyorFttt && !isBulky && project.currentPhase === 'IMPLEMENTATION' &&
            userRole !== 'ADMIN' && userRole !== 'GENERAL_MANAGER' && (
            <div style={{ padding: '8px 14px', borderRadius: 8, background: '#F6F8FA', border: '1px solid #D0D7DE', fontSize: 12, color: '#57606a' }}>
              🔒 Penyelesaian fase Implementation hanya dapat dilakukan oleh Admin
            </div>
          )}
          {!isCompletedOrCancelled && isSurveyorFttt && (
            <div style={{ padding: '8px 14px', borderRadius: 8, background: '#F0F8FF', border: '1px solid #0969DA', fontSize: 12, color: '#0969DA' }}>
              👷 Ruang lingkup Anda: Validation &amp; Survey (termasuk survey bertahap paralel). Aktivitas fase lain disembunyikan.
            </div>
          )}
        </div>

        {/* Blocked reasons — not relevant for Surveyor (they don't advance phases) */}
        {!isSurveyorFttt && !bulkyInitiationDone && readiness && !readiness.ready && readiness.blockedReasons.length > 0 && (
          <div style={{ marginTop: 12, padding: 10, background: '#FFF8C5', borderRadius: 8, border: '1px solid #d4a017' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#9a6700' }}>Fase belum bisa diselesaikan:</p>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
              {readiness.blockedReasons.map((r, i) => (
                <li key={i} style={{ fontSize: 12, color: '#9a6700' }}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Live progress bar */}
      <LiveProgressBar project={project} />

      {/* Phase timeline — Integra V3: hidden on Parent Bulky; Surveyor sees compact survey status on Sites */}
      {!isBulky && (
      <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>
          {isSurveyorFttt ? 'Status Validation & Survey' : 'Timeline Fase'}
        </p>
        {(() => {
          const scopedPhases = SITE_OPERATIONAL_PHASES;
          return isSurveyorFttt ? scopedPhases.filter((p) => p === 'SURVEY') : scopedPhases;
        })().map((phase) => {
          const prog = project.phaseProgresses.find((p) => p.phase === phase);
          if (!prog) return null;
          const isCurrentPhase = phase === project.currentPhase;
          const sites = project.surveySites ?? [];
          const sitesDone = sites.filter((s) => s.status === 'DONE').length;
          return (
            <div key={phase} style={{
              display: 'flex', gap: 12, padding: '10px 0',
              borderBottom: '1px solid #EAEEF2', alignItems: 'flex-start',
              opacity: prog.status === 'SKIPPED' ? 0.4 : 1,
            }}>
              <div style={{ marginTop: 2 }}><PhaseIcon status={prog.status} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: isCurrentPhase || isSurveyorFttt ? 700 : 500 }}>
                    {FTTT_PHASE_LABELS[phase]}
                    {prog.status === 'SKIPPED' && <span style={{ fontSize: 11, marginLeft: 6, color: '#8c959f' }}>— Dilewati</span>}
                    {isCurrentPhase && !isSurveyorFttt && <span style={{ fontSize: 11, marginLeft: 6, color: '#0969DA', fontWeight: 600 }}>← Fase aktif</span>}
                  </span>
                  {prog.completedAt && <span style={{ fontSize: 11, color: '#57606a' }}>{fmt(prog.completedAt)}</span>}
                </div>
                {isSurveyorFttt && sites.length > 0 && (
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#57606a' }}>
                    Progress site: {sitesDone}/{sites.length}
                    {sitesDone === sites.length ? ' · Completed' : ' · Berjalan paralel dengan fase project'}
                  </p>
                )}
                {prog.notes && !isSurveyorFttt && <p style={{ margin: '3px 0 0', fontSize: 12, color: '#57606a' }}>{prog.notes}</p>}
              </div>
            </div>
          );
        })}
        {isSurveyorFttt && (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: '#8c959f' }}>
            Fase aktif project: {FTTT_PHASE_LABELS[project.currentPhase]} — survey dapat dilanjutkan meski project sudah di fase lain.
          </p>
        )}
      </div>
      )}

      {/* Current phase actions */}
      {!isCompletedOrCancelled && (
        <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20 }}>
          <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 14 }}>
            {isBulky
              ? (bulkyInitiationDone ? 'Monitoring Parent Project' : `Aktivitas Fase: ${FTTT_PHASE_LABELS[project.currentPhase]}`)
              : isSurveyorFttt
                ? 'Aktivitas Validation & Survey'
                : `Aktivitas Fase: ${FTTT_PHASE_LABELS[project.currentPhase]}`}
          </p>

          {/* Integra V3: always show Child Site list on Bulky (fix: children disappeared after leaving SITE_INITIATION) */}
          {isBulky && (project.currentPhase === 'SITE_INITIATION' || bulkyInitiationDone || (project.children?.length ?? 0) > 0) && (
            <div style={{ marginBottom: 20 }}>
              <SiteInitiationSection
                project={project}
                onRefresh={load}
                userRole={user?.role ?? ''}
                monitoringOnly={bulkyInitiationDone}
              />
            </div>
          )}

          {isBulky && project.currentPhase === 'INITIATION' && !bulkyInitiationDone && (
            <p style={{ fontSize: 13, color: '#57606a' }}>
              Validasi dokumen triggering, lalu klik &quot;Selesaikan Fase&quot; untuk masuk ke Site Initiation.
            </p>
          )}

          {/* Survey — for Surveyor always (parallel); for others only on SURVEY / unfinished sites.
              Bulky Project itself never runs Survey — that belongs to its Sites. */}
          {!isBulky && (() => {
            const onSurvey = project.currentPhase === 'SURVEY';
            const continuePartial =
              project.status === 'ACTIVE' &&
              !onSurvey &&
              project.currentPhase !== 'INITIATION' &&
              (project.surveySites?.length ?? 0) > 0 &&
              (project.surveySites ?? []).some((s) => s.status !== 'DONE');
            // Surveyor always works on survey once project left INITIATION
            const showForSurveyor =
              isSurveyorFttt &&
              project.status === 'ACTIVE' &&
              project.currentPhase !== 'INITIATION';
            if (!showForSurveyor && !onSurvey && !continuePartial) return null;
            return (
              <SurveySection
                project={project}
                onRefresh={load}
                continueMode={!onSurvey}
              />
            );
          })()}

          {/* Non-survey lifecycle activities — hidden from Surveyor FTTT, and hidden
              for Bulky Project (operational work belongs to its Sites) */}
          {!isSurveyorFttt && !isBulky && (
            <>
              {/* Preparation — DRM for PST */}
              {project.currentPhase === 'PREPARATION' && project.ftttCompany === 'PST' && (
                <DrmSection project={project} onRefresh={load} />
              )}

              {/* Preparation — Jaminan for Telkom Infra */}
              {project.currentPhase === 'PREPARATION' && project.ftttCompany === 'TELKOM_INFRA' && (
                <JaminanSection project={project} onRefresh={load} />
              )}

              {/* Integra V1: Supporting Document (Opsional) — all companies on Preparation, not just iFORTE */}
              {project.currentPhase === 'PREPARATION' && (
                <div style={{ marginTop: project.ftttCompany === 'IFORTE' ? 0 : 16, borderTop: project.ftttCompany === 'IFORTE' ? 'none' : '1px solid #EAEEF2', paddingTop: project.ftttCompany === 'IFORTE' ? 0 : 12 }}>
                  <SupportingDocSection project={project} onRefresh={load} userRole={user?.role ?? ''} />
                </div>
              )}

              {/* C6-PST5: Procurement phase — PM uploads PO (PST only) */}
              {project.currentPhase === 'PROCUREMENT' && (
                <ProcurementSection project={project} onRefresh={load} userRole={userRole} />
              )}

              {/* Documentation — all companies (C6-TI2: PM FTTT owns) */}
              {project.currentPhase === 'DOCUMENTATION' && (
                <DocumentationSection project={project} onRefresh={load} userRole={userRole} />
              )}

              {/* Reconciliation & Billing — all companies (C6-TI2: PM FTTT owns) */}
              {project.currentPhase === 'RECONCILIATION' && (
                <ReconciliationSection project={project} onRefresh={load} userRole={userRole} />
              )}

              {/* Implementation phase */}
              {project.currentPhase === 'IMPLEMENTATION' && (
                <ImplementationSection project={project} onRefresh={load} userRole={userRole} />
              )}

              {/* CLOSING phase — BAST II, evidence, notes (C6-TI3: Admin-only + maintenance gate) */}
              {project.currentPhase === 'CLOSING' && (
                <ClosingSection project={project} onRefresh={load} userRole={userRole} />
              )}

              {!['SURVEY', 'PREPARATION', 'PROCUREMENT', 'DOCUMENTATION', 'RECONCILIATION', 'IMPLEMENTATION', 'CLOSING'].includes(project.currentPhase) && (
                <p style={{ fontSize: 13, color: '#57606a' }}>
                  Koordinasikan kegiatan di fase ini. Klik tombol &quot;Selesaikan Fase&quot; di atas setelah semua aktivitas selesai.
                </p>
              )}

              {/* DRM history always visible for PST */}
              {project.ftttCompany === 'PST' && project.drmDocuments.length > 0 && project.currentPhase !== 'PREPARATION' && (
                <div style={{ marginTop: 16, borderTop: '1px solid #EAEEF2', paddingTop: 12 }}>
                  <DrmSection project={project} onRefresh={load} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Completed summary */}
      {project.status === 'COMPLETED' && (
        <div style={{ background: '#DAFBE1', border: '1px solid #1a7f37', borderRadius: 12, padding: 20, marginTop: 16, textAlign: 'center' }}>
          <CheckCircle size={32} color="#1a7f37" style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: '#1a7f37' }}>Project Selesai 🎉</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#57606a' }}>Semua fase lifecycle FTTT telah berhasil diselesaikan.</p>
        </div>
      )}
    </div>
  );
}
