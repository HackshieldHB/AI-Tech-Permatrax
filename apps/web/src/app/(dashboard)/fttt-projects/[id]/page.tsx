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
  FTTT_COMPANY_LABELS,
  FTTT_PHASE_LABELS,
  FTTT_PROJECT_STATUS_LABELS,
  FTTT_DOC_TYPE_LABELS,
} from '../../../../types/api.types';
import { io, Socket } from 'socket.io-client';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PHASE_ORDER: FtttPhase[] = [
  'INITIATION', 'SURVEY', 'PREPARATION', 'IMPLEMENTATION',
  'DOCUMENTATION', 'RECONCILIATION', 'CLOSING',
];

function fmt(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PhaseIcon({ status }: { status: FtttPhaseStatus }) {
  if (status === 'COMPLETED') return <CheckCircle size={18} color="#1a7f37" />;
  if (status === 'ACTIVE')    return <Circle size={18} color="#0969DA" fill="#DDF4FF" />;
  if (status === 'SKIPPED')   return <SkipForward size={18} color="#57606a" />;
  return <Lock size={18} color="#D0D7DE" />;
}

// ─── Live Progress Bar ────────────────────────────────────────────────────────
function LiveProgressBar({ project }: { project: FtttProject }) {
  const visible = project.phaseProgresses.filter((p) => p.status !== 'SKIPPED');
  const completed = visible.filter((p) => p.status === 'COMPLETED').length;
  const pct = visible.length > 0 ? Math.round((completed / visible.length) * 100) : 0;

  return (
    <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Overall Progress</span>
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
      {/* Phase stepper */}
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', gap: 0, paddingBottom: 4 }}>
        {PHASE_ORDER.map((phase, idx) => {
          const progress = project.phaseProgresses.find((p) => p.phase === phase);
          if (!progress) return null;
          const isLast = idx === PHASE_ORDER.length - 1;
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
                  {FTTT_PHASE_LABELS[phase].split(' ')[0]}
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
function SurveySection({ project, onRefresh }: { project: FtttProject; onRefresh: () => void }) {
  const { user } = useAuthStore();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState('photo');
  const [caption, setCaption] = useState('');

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fileType', fileType);
    if (caption) fd.append('caption', caption);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/survey-uploads`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Bukti survei berhasil diunggah');
      onRefresh();
      setCaption('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Bukti Survei ({project.surveyUploads.length})</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={fileType} onChange={(e) => setFileType(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
          <option value="photo">Foto</option>
          <option value="supporting_file">File Pendukung</option>
          <option value="survey_evidence">Bukti Survei</option>
          <option value="operational_notes">Catatan Lapangan</option>
        </select>
        <input
          value={caption} onChange={(e) => setCaption(e.target.value)}
          placeholder="Keterangan (opsional)" style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 120 }}
        />
        <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
        <button
          onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#F6F8FA', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Upload size={13} /> {uploading ? 'Mengunggah…' : 'Upload'}
        </button>
      </div>
      {project.surveyUploads.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {project.surveyUploads.map((u) => (
            <a key={u.id} href={fixFileUrl(u.fileUrl)} target="_blank" rel="noopener noreferrer"
              style={{ padding: '6px 10px', border: '1px solid #D0D7DE', borderRadius: 6, fontSize: 12, textDecoration: 'none', color: '#0969DA', display: 'flex', alignItems: 'center', gap: 4 }}>
              <FileText size={12} /> {u.fileType}{u.caption ? ` — ${u.caption}` : ''}
            </a>
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
  const [docType, setDocType] = useState('BOQ_INITIAL');
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    if (notes) fd.append('notes', notes);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/drm-documents`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal upload');
      toast.success('Dokumen DRM berhasil diunggah');
      onRefresh();
      setNotes('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setUploading(false);
    }
  };

  // Group by docType
  const grouped = project.drmDocuments.reduce<Record<string, typeof project.drmDocuments>>((acc, d) => {
    (acc[d.docType] = acc[d.docType] ?? []).push(d);
    return acc;
  }, {});

  const DRM_LABELS: Record<string, string> = {
    BOQ_INITIAL: 'BOQ Awal', TOS_INITIAL: 'TOS Awal', DRM_RESULT: 'Hasil DRM', ACTUAL: 'Aktual',
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>DRM Management — Riwayat Dokumen</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
          <option value="BOQ_INITIAL">BOQ Awal</option>
          <option value="TOS_INITIAL">TOS Awal</option>
          <option value="DRM_RESULT">Hasil DRM</option>
          <option value="ACTUAL">Aktual</option>
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan (opsional)" style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 120 }} />
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#F6F8FA', cursor: 'pointer', fontSize: 12 }}>
          {uploading ? 'Mengunggah…' : 'Upload'}
        </button>
      </div>
      {Object.entries(grouped).map(([type, docs]) => (
        <div key={type} style={{ marginBottom: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#57606a', margin: '0 0 4px' }}>{DRM_LABELS[type] ?? type}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {docs.map((d) => (
              <a key={d.id} href={fixFileUrl(d.fileUrl)} target="_blank" rel="noopener noreferrer"
                style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, textDecoration: 'none', color: '#0969DA', display: 'flex', alignItems: 'center', gap: 4 }}>
                <FileText size={11} /> v{d.version} {d.notes ? `— ${d.notes}` : ''} <ExternalLink size={10} />
              </a>
            ))}
          </div>
        </div>
      ))}
      {project.drmDocuments.length === 0 && <p style={{ fontSize: 12, color: '#8c959f' }}>Belum ada dokumen DRM.</p>}
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
// Each lifecycle (Telkom Infra / PST / iFORTE) has its own required document set.
// Upload docs: Surveyor uploads file.  Generate Form docs: Surveyor fills textarea.
// PM then reviews, Admin confirms.
function DocumentationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const canUploadDocs  = userRole === 'SURVEYOR_FTTT' || userRole === 'GENERAL_MANAGER';
  const canReplaceDocs = userRole === 'SURVEYOR_FTTT';
  const canPmApprove   = userRole === 'PM_FTTT';
  const canAdminApprove = userRole === 'ADMIN';

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
  const allDone = requiredDocs.every((d) => (approvedKeys as Set<string>).has(d.key));

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
          Upload docs dilakukan oleh Surveyor FTTT; Generate Form docs diisi melalui sistem.
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
                      {isUploading ? '…' : '🔄 Ganti File'}
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
              Berikan alasan yang jelas agar Surveyor FTTT dapat melakukan perbaikan yang tepat.
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

      {/* Info for PM / Admin — read-only notice */}
      {!canUploadDocs && (canPmApprove || canAdminApprove) && (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 8, padding: 10, marginTop: 6, fontSize: 12, color: '#0969DA' }}>
          ℹ️ Anda dapat mereview dan approve/reject dokumen pada setiap card di atas. Upload dokumen baru hanya dapat dilakukan oleh Surveyor FTTT.
        </div>
      )}
    </div>
  );
}

// ─── Implementation phase section — Issue #1: multi-photo support ─────────────
function ImplementationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const canUpload = userRole === 'SURVEYOR_FTTT' || userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER';
  const canNote   = canUpload || userRole === 'PM_FTTT'; // PM can add notes too

  const [logType, setLogType] = useState<'PHOTO' | 'MONITORING_DOC' | 'NOTE'>('PHOTO');
  const [caption, setCaption] = useState('');
  const [notes, setNotes]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>(''); // e.g. "Mengunggah 2/5..."
  const fileRef = useRef<HTMLInputElement>(null);

  const LOG_LABELS = { PHOTO: '📷 Foto Progress', MONITORING_DOC: '📊 Dokumen Monitoring', NOTE: '📝 Catatan Progress' };

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

  const logs = project.implementationLogs ?? [];

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Log Implementasi ({logs.length})</p>

      {/* List existing logs */}
      {logs.length === 0 && (
        <p style={{ fontSize: 12, color: '#57606a', marginBottom: 8 }}>Belum ada log implementasi. Tambahkan foto progress, dokumen monitoring, atau catatan.</p>
      )}
      {logs.map((log) => (
        <div key={log.id} style={{ background: '#F6F8FA', borderRadius: 8, padding: 10, marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 18 }}>{log.logType === 'PHOTO' ? '📷' : log.logType === 'MONITORING_DOC' ? '📊' : '📝'}</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{LOG_LABELS[log.logType]}</p>
            {log.caption && <p style={{ margin: '2px 0 0', fontSize: 12 }}>{log.caption}</p>}
            {log.notes   && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{log.notes}</p>}
            <p style={{ margin: '3px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {log.uploadedBy.name}</p>
          </div>
          {log.fileUrl && (
            <a href={fixFileUrl(log.fileUrl)} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#0969DA', whiteSpace: 'nowrap' }}>
              {log.logType === 'PHOTO' ? 'Lihat Foto' : 'Download'}
            </a>
          )}
        </div>
      ))}

      {/* Add log form */}
      {(canUpload || canNote) && (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>Tambah Log Implementasi</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={logType} onChange={(e) => setLogType(e.target.value as typeof logType)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
              {canUpload && <option value="PHOTO">📷 Foto Progress</option>}
              {canUpload && <option value="MONITORING_DOC">📊 Dokumen Monitoring (Excel/PDF)</option>}
              <option value="NOTE">📝 Catatan Progress</option>
            </select>
          </div>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={logType === 'NOTE' ? 'Judul catatan…' : 'Keterangan / caption…'}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }} />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="Detail catatan / keterangan tambahan (opsional)…"
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box', resize: 'vertical' }} />

          {logType === 'NOTE' ? (
            <button type="button" onClick={() => { void handleAdd(); }} disabled={uploading || !caption.trim()}
              style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
              {uploading ? 'Menyimpan…' : '+ Simpan Catatan'}

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
                style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                {uploading ? (uploadProgress || 'Mengunggah…') : logType === 'PHOTO' ? '📷 Upload Foto (dapat pilih banyak)' : '+ Upload Dokumen'}
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
const DOCUMENTATION_DOCS: Record<string, {
  key: string; label: string; desc: string;
  generateForm: boolean; required: boolean;
}[]> = {
  TELKOM_INFRA: [
    // Upload docs (dari Telkom Infra / pihak eksternal)
    { key: 'KONTRAK',             label: 'Kontrak',                        desc: 'Dokumen kontrak project dari Telkom Infra',                    generateForm: false, required: true  },
    { key: 'PO',                  label: 'PO',                             desc: 'Purchase Order dari Telkom Infra',                              generateForm: false, required: true  },
    { key: 'AMANDEMEN_1',         label: 'Amandemen 1',                    desc: 'Dokumen Amandemen 1 dari Telkom Infra',                         generateForm: false, required: true  },
    { key: 'DOK_PERUBAHAN_WAKTU', label: 'Dok. Perubahan Waktu (NPWP)',    desc: 'Dokumen perubahan waktu pelaksanaan project di NPWP',          generateForm: false, required: true  },
    // Generate Form docs (dibuat oleh ILT, perlu approval PM/Admin)
    { key: 'BAUT_REKONSILIASI',   label: 'BA Rekonsiliasi',                desc: 'Berita Acara Rekonsiliasi — dibuat melalui Generate Form',      generateForm: true,  required: true  },
    { key: 'BAUT',                label: 'BAUT',                           desc: 'Berita Acara Uji Terima — dibuat melalui Generate Form',        generateForm: true,  required: true  },
  ],
  PST: [
    { key: 'ATP',                 label: 'ATP',                            desc: 'Acceptance Test Protocol dari PST',                             generateForm: false, required: true  },
    { key: 'BAUT',                label: 'BAUT',                           desc: 'Berita Acara Uji Terima — dibuat melalui Generate Form',        generateForm: true,  required: true  },
  ],
  IFORTE: [
    { key: 'ATP',                 label: 'ATP',                            desc: 'Acceptance Test Protocol dari iFORTE',                          generateForm: false, required: true  },
    { key: 'EVIDENCE',            label: 'Evidence',                       desc: 'Dokumentasi evidence dan foto project',                         generateForm: false, required: true  },
  ],
};

// ─── Reconciliation & Billing Section (Issue #4) ─────────────────────────────
// Company-specific document definitions for Reconciliation phase
const RECON_DOCS: Record<string, {
  key: string; label: string; desc: string;
  uploaderRole: string[]; requiresApproval: boolean;
  generateForm?: boolean;  // true = ILT-created doc, filled via form; false/undefined = upload from Telkom Infra
}[]> = {
  TELKOM_INFRA: [
    // ── Generate Form docs (dibuat oleh Mitra Konstruksi / ILT, perlu approval) ──
    { key: 'BAPP_MOM',           label: 'BAPP — Risalah Rapat / MOM',         desc: 'Minutes of Meeting rekonsiliasi project bersama Telkom Infra',        uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true,  generateForm: true },
    { key: 'BAST_BAPWPP_BOQ',    label: 'BAST & BAPWPP — BOQ Perhitungan',    desc: 'BOQ final perhitungan sesuai kondisi lapangan aktual',               uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true,  generateForm: true },
    { key: 'BA_PENUTUPAN',       label: 'BA Penutupan',                        desc: 'Berita Acara Penutupan Project — dibuat oleh ILT',                   uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true,  generateForm: true },
    { key: 'JAMINAN_PEMELIHARAAN', label: 'Jaminan Pemeliharaan',              desc: 'Dokumen jaminan masa pemeliharaan — dibuat oleh ILT / Finance',      uploaderRole: ['FINANCE'],       requiresApproval: false, generateForm: true },
    { key: 'INVOICE_FINAL',      label: 'Invoice Final',                       desc: 'Tagihan akhir project — dibuat Finance sesuai BOQ final',            uploaderRole: ['FINANCE'],       requiresApproval: false, generateForm: true },
    // ── Upload docs (diterima langsung dari Telkom Infra, auto-approved) ──────────
    { key: 'BAPP_AMANDEMEN_2',        label: 'BAPP — Amandemen 2',            desc: 'Amandemen 2 dari Telkom Infra — upload file yang diterima',          uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'BAST_BAPWPP_AMANDEMEN_1', label: 'BAST & BAPWPP — Amandemen 1',  desc: 'Amandemen 1 dari Telkom Infra — upload file yang diterima',          uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'BAST_BAPWPP_AMANDEMEN_2', label: 'BAST & BAPWPP — Amandemen 2',  desc: 'Amandemen 2 dari Telkom Infra — upload file yang diterima',          uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'BAST_BAPWPP_PO',          label: 'BAST & BAPWPP — PO',           desc: 'PO dari Telkom Infra — upload file yang diterima',                   uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'GOOD_RECEIPT',            label: 'Good Receipt',                  desc: 'Completion Certificate GRN & Lampiran SMILE dari Telkom Infra',      uploaderRole: ['ADMIN'],         requiresApproval: false },
  ],
  PST: [
    { key: 'REKONSILIASI', label: 'Rekonsiliasi',          desc: 'Penyamaan DRM sebelum implementasi vs actual lapangan',      uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true },
    { key: 'BAST_1',      label: 'BAST 1',                 desc: 'Jaminan Pemeliharaan & Jaminan Pelaksanaan',                 uploaderRole: ['FINANCE'], requiresApproval: false },
    { key: 'GOOD_RECEIPT_PST', label: 'Good Receipt',      desc: 'Completion Cert. GERN & Lampiran Smile',                    uploaderRole: ['ADMIN'], requiresApproval: false },
    { key: 'INVOICE_PST', label: 'Invoice',                desc: 'Tagihan & Jaminan Masa Pemeliharaan',                       uploaderRole: ['FINANCE'], requiresApproval: false },
  ],
  IFORTE: [
    { key: 'PUNCHLIST',   label: 'Punchlist',              desc: 'Minor issue ditemukan — catatan & foto sebelum & sesudah diperbaiki', uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'ENDORSEMENT', label: 'Endorsement',            desc: 'Rekonsiliasi BOQ versi iFORTE bersama Surveyor',            uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true },
    { key: 'PO_FINAL',    label: 'PO Final',               desc: 'Diunggah setelah proses Sanggah clear',                     uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'PSS',         label: 'PSS',                    desc: 'Upload dokumen ke sistem iFORTE',                           uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: false },
    { key: 'MCV',         label: 'MCV',                    desc: 'Update progress di sistem iFORTE dengan dokumen pendukung',  uploaderRole: ['ADMIN'], requiresApproval: false },
    { key: 'INVOICE_IFORTE', label: 'Invoice',             desc: 'Tagihan sesuai termin',                                     uploaderRole: ['FINANCE'], requiresApproval: false },
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
                    <span style={{ fontSize: 10, fontWeight: 700, color:
                      // Fix #1: no-approval docs that still show PENDING_PM (legacy data) → treat as uploaded
                      (!doc.requiresApproval && rec.approvalStatus === 'PENDING_PM') ? '#1a7f37'
                      : STATUS_COLORS[rec.approvalStatus] }}>
                      {(!doc.requiresApproval && rec.approvalStatus === 'PENDING_PM') ? '✓ Diunggah' : STATUS_LABELS[rec.approvalStatus]}
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

                {/* Upload/Replace button (for non-Generate-Form docs only) */}
                {canUpload && !doc.generateForm && (!rec || rec.approvalStatus === 'REJECTED') && (
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

            {/* ── Generate Form input (for ILT-created docs) ─────────────────── */}
            {doc.generateForm && canUpload && (!rec || rec.approvalStatus === 'REJECTED') && (
              <div style={{ marginTop: 10, padding: 10, background: '#F0F8FF', borderRadius: 8, border: '1px dashed #0969DA' }}>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#0969DA' }}>
                  📝 Generate Form — Isi konten dokumen ini
                </p>
                <p style={{ margin: '0 0 6px', fontSize: 10, color: '#57606a' }}>
                  Dokumen ini dibuat oleh ILT melalui sistem. Isi form di bawah, lalu kirim untuk review PM/Admin.
                  {rec?.approvalStatus === 'REJECTED' ? ' (dokumen ditolak — perbaiki dan kirim ulang)' : ''}
                </p>
                <textarea
                  value={formContents[doc.key] ?? (rec?.formContent ?? '')}
                  onChange={(e) => setFormContents((prev) => ({ ...prev, [doc.key]: e.target.value }))}
                  rows={4}
                  placeholder={`Masukkan isi / data ${doc.label}…\nContoh: tanggal, pihak yang hadir, poin-poin yang disepakati, nilai BOQ, dll.`}
                  style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #0969DA', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }}
                />
                <input
                  value={notes[doc.key] ?? ''}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [doc.key]: e.target.value }))}
                  placeholder="Catatan tambahan (opsional)"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <button type="button"
                  onClick={() => void handleGenerateForm(doc.key)}
                  disabled={isUploading || !(formContents[doc.key]?.trim())}
                  style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: (formContents[doc.key]?.trim()) ? '#0969DA' : '#D0D7DE', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {isUploading ? 'Menyimpan…' : rec ? '🔄 Kirim Ulang' : '✉️ Kirim ke PM untuk Disetujui'}
                </button>
              </div>
            )}

            {/* Show saved form content (approved/pending) */}
            {doc.generateForm && rec && rec.formContent && rec.approvalStatus !== 'REJECTED' && (
              <div style={{ marginTop: 8, padding: 8, background: '#F6F8FA', borderRadius: 6, border: '1px solid #EAEEF2' }}>
                <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: '#57606a' }}>Isi Dokumen (Generate Form):</p>
                <p style={{ margin: 0, fontSize: 11, color: '#24292f', whiteSpace: 'pre-wrap' }}>{rec.formContent}</p>
              </div>
            )}
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

// ─── Project Closing Section ───────────────────────────────────────────────────
// BAST II (formal handover doc, needs PM approval) + evidence photos + notes
function ClosingSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  const canUpload    = ['SURVEYOR_FTTT', 'PM_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(userRole);
  const canApprove   = ['PM_FTTT', 'ADMIN', 'GENERAL_MANAGER'].includes(userRole);

  const logs: FtttClosingLog[] = project.closingLogs ?? [];
  const bastII    = logs.find((l) => l.logType === 'BAST_II') ?? null;
  const evidences = logs.filter((l) => l.logType === 'EVIDENCE');
  const notes_list= logs.filter((l) => l.logType === 'NOTE');

  const [logType, setLogType] = useState<'BAST_II' | 'EVIDENCE' | 'NOTE'>('BAST_II');
  const [caption, setCaption] = useState('');
  const [notes,   setNotes]   = useState('');
  const [bastIIFormContent, setBastIIFormContent] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  const handleBastIIForm = async () => {
    if (!bastIIFormContent.trim()) { toast.error('Isi dokumen BAST II wajib diisi'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logType', 'BAST_II');
      fd.append('formContent', bastIIFormContent.trim());
      fd.append('caption', 'BAST II');
      const res = await apiFetch(`/fttt-projects/${project.id}/closing-logs`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('BAST II berhasil disimpan — menunggu persetujuan PM');
      setBastIIFormContent('');
      onRefresh();
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); }
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
      <p style={{ fontSize: 12, color: '#57606a', marginBottom: 16 }}>
        Serah terima project 100% kepada Telkom Infra setelah masa pemeliharaan selesai.
      </p>

      {/* ── BAST II ── */}
      <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>📄 BAST II</span>
              <span style={{ fontSize: 11, color: '#57606a', background: '#EDF2F4', padding: '2px 6px', borderRadius: 4 }}>Surveyor / PM</span>
              {bastII?.approvalStatus && (
                <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[bastII.approvalStatus] }}>
                  {STATUS_LABELS[bastII.approvalStatus]}
                </span>
              )}
              {!bastII && <span style={{ fontSize: 10, color: '#8c959f' }}>Belum diunggah</span>}
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a' }}>Dokumen Berita Acara Serah Terima II — perlu disetujui PM FTTT</p>
            {bastII?.notes && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>📝 {bastII.notes}</p>}
            {bastII?.formContent && (
              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#57606a', background: '#F0F8FF', padding: '4px 6px', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                {bastII.formContent.length > 120 ? bastII.formContent.slice(0, 120) + '…' : bastII.formContent}
              </p>
            )}
            {bastII?.approvalStatus === 'REJECTED' && bastII.rejectionNotes && (
              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#cf222e', fontStyle: 'italic' }}>Ditolak: {bastII.rejectionNotes}</p>
            )}
            {bastII?.uploadedBy && <p style={{ margin: '2px 0 0', fontSize: 10, color: '#8c959f' }}>oleh {bastII.uploadedBy.name}</p>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
            {bastII?.fileUrl && <a href={fixFileUrl(bastII.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
            {/* PM approves/rejects BAST II */}
            {canApprove && bastII?.approvalStatus === 'PENDING_PM' && (
              <>
                <button type="button" onClick={() => void handleApprove(bastII.id, true)}
                  style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Setujui</button>
                <button type="button" onClick={() => { setRejectTarget(bastII.id); setRejectReason(''); }}
                  style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗ Tolak</button>
              </>
            )}
            {/* Surveyor/PM fills Generate Form for BAST II */}
            {canUpload && (!bastII || bastII.approvalStatus === 'REJECTED') && (
              <button type="button"
                onClick={() => { setLogType('BAST_II'); document.getElementById('bastii-form-panel')?.scrollIntoView({ behavior: 'smooth' }); }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px dashed #0969DA', background: bastII ? '#FFF8F0' : '#F0F8FF', color: bastII ? '#7d5a00' : '#0969DA', fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>
                {bastII ? '🔄 Isi Ulang BAST II' : '📝 Generate Form BAST II'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── BAST II Generate Form panel ── */}
      {canUpload && (!bastII || bastII.approvalStatus === 'REJECTED') && (
        <div id="bastii-form-panel" style={{ background: '#F0F8FF', border: '1px dashed #0969DA', borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#0969DA' }}>
            📝 Generate Form — BAST II
            {bastII?.approvalStatus === 'REJECTED' && <span style={{ fontSize: 11, color: '#cf222e', marginLeft: 8 }}>(ditolak — perbaiki dan kirim ulang)</span>}
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#57606a' }}>
            Dokumen Berita Acara Serah Terima II dibuat melalui sistem. Isi data di bawah, lalu kirim ke PM untuk disetujui.
          </p>
          <textarea
            value={bastIIFormContent || (bastII?.formContent ?? '')}
            onChange={(e) => setBastIIFormContent(e.target.value)}
            rows={6}
            placeholder="Isi dokumen BAST II…&#10;(tanggal serah terima, pihak yang terlibat, kondisi akhir project, item yang diserahterimakan, catatan pemeliharaan, dll.)"
            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #0969DA', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
          />
          <button type="button"
            onClick={() => void handleBastIIForm()}
            disabled={uploading || !(bastIIFormContent.trim() || (bastII?.formContent && !bastIIFormContent))}
            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: (bastIIFormContent.trim()) ? '#0969DA' : '#D0D7DE', color: '#fff', fontWeight: 700, cursor: bastIIFormContent.trim() ? 'pointer' : 'not-allowed', fontSize: 13 }}>
            {uploading ? 'Menyimpan…' : bastII ? '🔄 Kirim Ulang BAST II' : '✉️ Kirim ke PM untuk Disetujui'}
          </button>
        </div>
      )}

      {/* ── Evidence Photos ── */}
      <div style={{ background: '#F6F8FA', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #EAEEF2' }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>
          📷 Evidence Serah Terima
          <span style={{ fontWeight: 400, fontSize: 12, color: '#57606a', marginLeft: 8 }}>({evidences.length} foto)</span>
          <span style={{ fontWeight: 400, fontSize: 11, color: '#57606a', marginLeft: 4 }}>— Dokumentasi penyerahan project ke Telkom Infra</span>
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
        {canUpload && (
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

      {/* ── Closing Notes ── */}
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
        {canUpload && (
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

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Link href="/fttt-projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16, textDecoration: 'none' }}>
        <ArrowLeft size={16} /> Daftar FTTT Projects
      </Link>

      {/* Header */}
      <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FFF8C5', color: '#9a6700' }}>FTTT</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#DDF4FF', color: '#0969DA' }}>
                {FTTT_COMPANY_LABELS[project.ftttCompany]}
              </span>
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
            </p>
          </div>
          {!isCompletedOrCancelled && readiness && (
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
        </div>

        {/* Blocked reasons */}
        {readiness && !readiness.ready && readiness.blockedReasons.length > 0 && (
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

      {/* Phase timeline */}
      <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>Timeline Fase</p>
        {PHASE_ORDER.map((phase) => {
          const prog = project.phaseProgresses.find((p) => p.phase === phase);
          if (!prog) return null;
          const isCurrentPhase = phase === project.currentPhase;
          return (
            <div key={phase} style={{
              display: 'flex', gap: 12, padding: '10px 0',
              borderBottom: '1px solid #EAEEF2', alignItems: 'flex-start',
              opacity: prog.status === 'SKIPPED' ? 0.4 : 1,
            }}>
              <div style={{ marginTop: 2 }}><PhaseIcon status={prog.status} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: isCurrentPhase ? 700 : 500 }}>
                    {FTTT_PHASE_LABELS[phase]}
                    {prog.status === 'SKIPPED' && <span style={{ fontSize: 11, marginLeft: 6, color: '#8c959f' }}>— Dilewati</span>}
                    {isCurrentPhase && <span style={{ fontSize: 11, marginLeft: 6, color: '#0969DA', fontWeight: 600 }}>← Fase aktif</span>}
                  </span>
                  {prog.completedAt && <span style={{ fontSize: 11, color: '#57606a' }}>{fmt(prog.completedAt)}</span>}
                </div>
                {prog.notes && <p style={{ margin: '3px 0 0', fontSize: 12, color: '#57606a' }}>{prog.notes}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Current phase actions */}
      {!isCompletedOrCancelled && (
        <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20 }}>
          <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 14 }}>
            Aktivitas Fase: {FTTT_PHASE_LABELS[project.currentPhase]}
          </p>

          {/* Survey — iForte & PST */}
          {project.currentPhase === 'SURVEY' && project.ftttCompany !== 'TELKOM_INFRA' && (
            <SurveySection project={project} onRefresh={load} />
          )}

          {/* Preparation — DRM for PST */}
          {project.currentPhase === 'PREPARATION' && project.ftttCompany === 'PST' && (
            <DrmSection project={project} onRefresh={load} />
          )}

          {/* Preparation — Jaminan for Telkom Infra */}
          {project.currentPhase === 'PREPARATION' && project.ftttCompany === 'TELKOM_INFRA' && (
            <JaminanSection project={project} onRefresh={load} />
          )}

          {/* Documentation — all companies */}
          {project.currentPhase === 'DOCUMENTATION' && (
            <DocumentationSection project={project} onRefresh={load} userRole={userRole} />
          )}

          {/* Issue #4: Reconciliation & Billing — all companies */}
          {project.currentPhase === 'RECONCILIATION' && (
            <ReconciliationSection project={project} onRefresh={load} userRole={userRole} />
          )}

          {/* Sanggah — iForte, available during RECONCILIATION (existing feature) */}
          {project.currentPhase === 'RECONCILIATION' && project.ftttCompany === 'IFORTE' && (
            <div style={{ marginTop: 16, borderTop: '1px solid #EAEEF2', paddingTop: 12 }}>
              <SanggahSection project={project} onRefresh={load} isAdmin={userRole === 'ADMIN'} />
            </div>
          )}

          {/* Issue #4: Implementation phase — photo/doc/note logging by Surveyor */}
          {project.currentPhase === 'IMPLEMENTATION' && (
            <ImplementationSection project={project} onRefresh={load} userRole={userRole} />
          )}

          {/* Generic message for other phases with no special UI */}
          {/* CLOSING phase — BAST II, evidence, notes */}
          {project.currentPhase === 'CLOSING' && (
            <ClosingSection project={project} onRefresh={load} userRole={userRole} />
          )}

          {!['SURVEY', 'PREPARATION', 'DOCUMENTATION', 'RECONCILIATION', 'IMPLEMENTATION', 'CLOSING'].includes(project.currentPhase) && (
            <p style={{ fontSize: 13, color: '#57606a' }}>
              Koordinasikan kegiatan di fase ini. Klik tombol "Selesaikan Fase" di atas setelah semua aktivitas selesai.
            </p>
          )}

          {/* Also show Sanggah history if iForte project */}
          {project.ftttCompany === 'IFORTE' && project.sanggahs.length > 0 && project.currentPhase !== 'RECONCILIATION' && (
            <div style={{ marginTop: 16, borderTop: '1px solid #EAEEF2', paddingTop: 12 }}>
              <SanggahSection project={project} onRefresh={load} isAdmin={userRole === 'ADMIN'} />
            </div>
          )}

          {/* DRM history always visible for PST */}
          {project.ftttCompany === 'PST' && project.drmDocuments.length > 0 && project.currentPhase !== 'PREPARATION' && (
            <div style={{ marginTop: 16, borderTop: '1px solid #EAEEF2', paddingTop: 12 }}>
              <DrmSection project={project} onRefresh={load} />
            </div>
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
