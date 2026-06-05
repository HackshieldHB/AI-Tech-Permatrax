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
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
        Dokumen Jaminan ({project.jaminans.length}/2)
        {allUploaded && <span style={{ marginLeft: 8, fontSize: 11, color: '#1a7f37', fontWeight: 600 }}>✓ Lengkap</span>}
      </p>

      {/* Show uploaded jaminans */}
      {project.jaminans.map((j) => (
        <div key={j.id} style={{ background: '#F0FFF8', border: '1px solid #2DA44E', borderRadius: 8, padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 12 }}>✓ {JAMINAN_LABELS[j.jaminanType as JType] ?? j.jaminanType}</p>
            {j.issuer && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{j.issuer}</p>}
            <p style={{ margin: '2px 0 0', fontSize: 10, color: '#57606a' }}>oleh {j.uploadedBy.name}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {j.fileUrl && <a href={fixFileUrl(j.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>}
            {/* Issue #3: Finance can replace existing doc */}
            {isFinance && (
              <button type="button" onClick={() => { setReplaceFor(j.jaminanType as JType); setActiveType(j.jaminanType as JType); setSelectedFile(null); setIssuer(''); setNotes(''); }}
                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer' }}>
                Ganti
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Show missing types as pending */}
      {missingTypes.map((t) => (
        <div key={t} style={{ background: '#FFF8F0', border: '1px solid #FFA500', borderRadius: 8, padding: 10, marginBottom: 6 }}>
          <p style={{ margin: 0, fontSize: 12, color: '#7d5a00' }}>⏳ {JAMINAN_LABELS[t]} — belum diunggah</p>
        </div>
      ))}

      {/* Upload / Replace form — Finance only */}
      {isFinance && (
        <>
          {/* Upload form: show when there are missing types OR user clicked Replace */}
          {(missingTypes.length > 0 || replaceFor !== null) && (
            <div style={{ border: `1px solid ${replaceFor ? '#FFA500' : '#D0D7DE'}`, borderRadius: 8, padding: 12, marginTop: 8, background: replaceFor ? '#FFFBF0' : '#fff' }}>
              <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>
                {replaceFor ? `Ganti Dokumen: ${JAMINAN_LABELS[replaceFor]}` : 'Upload Jaminan'}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {!replaceFor && (
                  <select value={activeType} onChange={(e) => setActiveType(e.target.value as JType)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
                    {missingTypes.map((t) => <option key={t} value={t}>{JAMINAN_LABELS[t]}</option>)}
                  </select>
                )}
                <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Penerbit (bank/lembaga)"
                  style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 120 }} />
              </div>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan (opsional)"
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 11, cursor: 'pointer', background: '#F6F8FA' }}>
                  {selectedFile ? selectedFile.name.slice(0, 18) + '…' : '+ Pilih File'}
                </button>
                <button type="button" onClick={() => { void handleUpload(replaceFor ?? undefined); }} disabled={submitting}
                  style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: replaceFor ? '#FFA500' : '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
                  {submitting ? 'Menyimpan…' : replaceFor ? 'Ganti Dokumen' : 'Upload'}
                </button>
                {replaceFor && (
                  <button type="button" onClick={() => { setReplaceFor(null); setSelectedFile(null); }}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', background: '#fff', fontSize: 12, cursor: 'pointer' }}>Batal</button>
                )}
              </div>
            </div>
          )}
          {allUploaded && !replaceFor && (
            <p style={{ fontSize: 11, color: '#57606a', marginTop: 8 }}>Kedua dokumen sudah diunggah. Klik "Ganti" untuk mengganti dokumen yang salah.</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Documentation section (Issues #5, #6, #7) ───────────────────────────────
// #5 & #7: Only Surveyor can upload; PM only reviews
// Documentation & Acceptance — Issues #2 (rejection reason), #3 (admin cannot replace)
function DocumentationSection({ project, onRefresh, userRole }: { project: FtttProject; onRefresh: () => void; userRole: string }) {
  const { user } = useAuthStore();
  // Issue #3: Only SURVEYOR_FTTT can upload NEW docs and REPLACE rejected docs; Admin/GM can only approve
  const canUploadDocs  = userRole === 'SURVEYOR_FTTT' || userRole === 'GENERAL_MANAGER';
  const canReplaceDocs = userRole === 'SURVEYOR_FTTT';  // Issue #3: Admin excluded
  const canPmApprove    = userRole === 'PM_FTTT';
  const canAdminApprove = userRole === 'ADMIN';

  const [docType, setDocType] = useState<'ATP' | 'BAUT' | 'SUPPORTING' | 'EVIDENCE'>('ATP');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef    = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  // Issue #2: rejection reason dialog
  const [rejectTarget, setRejectTarget] = useState<string | null>(null); // docId to reject
  const [rejectReason, setRejectReason] = useState('');

  const DOC_LABELS: Record<string, string> = { ATP: 'ATP', BAUT: 'BAUT', SUPPORTING: 'Supporting Doc', EVIDENCE: 'Project Evidence' };
  const STATUS_COLORS: Record<string, string> = { PENDING_PM: '#9a6700', PENDING_ADMIN: '#0969DA', APPROVED: '#1a7f37', REJECTED: '#cf222e' };
  const STATUS_LABELS: Record<string, string> = { PENDING_PM: 'Menunggu PM', PENDING_ADMIN: 'Menunggu Admin', APPROVED: 'Disetujui', REJECTED: 'Ditolak' };

  const handleUpload = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    if (notes) fd.append('notes', notes);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/${project.id}/documents`, { method: 'POST', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen berhasil diunggah'); onRefresh(); setNotes('');
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); }
  };

  // Issue #6: replace a REJECTED doc
  const handleReplace = async (docId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const res = await apiFetch(`/fttt-projects/documents/${docId}/replace`, { method: 'PUT', body: fd }, user?.id);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Gagal');
      toast.success('Dokumen berhasil diganti — menunggu review PM'); onRefresh(); setReplacingId(null);
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Gagal'); }
    finally { setUploading(false); }
  };

  // Issue #2: approve/reject with mandatory rejection notes
  const handleApprove = async (docId: string, approved: boolean, rejectionNotes?: string) => {
    const res = await apiFetch(`/fttt-projects/documents/${docId}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, rejectionNotes }),
    }, user?.id);
    if (res.ok) { toast.success(approved ? 'Dokumen disetujui' : 'Dokumen ditolak'); onRefresh(); }
    else { const e = await res.json().catch(() => ({})); toast.error((e as {message?: string}).message ?? 'Gagal'); }
  };

  const handleRejectWithReason = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) { toast.error('Alasan penolakan wajib diisi'); return; }
    await handleApprove(rejectTarget, false, rejectReason.trim());
    setRejectTarget(null); setRejectReason('');
  };

  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Dokumen Acceptance ({project.documents.length})</p>
      {project.documents.map((d) => (
        <div key={d.id} style={{ background: '#F6F8FA', borderRadius: 8, padding: 10, marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{DOC_LABELS[d.docType] ?? d.docType}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLORS[d.approvalStatus] }}>{STATUS_LABELS[d.approvalStatus]}</span>
              </div>
              {d.notes && <p style={{ fontSize: 11, color: '#57606a', margin: '2px 0 0' }}>{d.notes}</p>}
              {/* Issue #2: show rejection reason to Surveyor */}
              {d.approvalStatus === 'REJECTED' && d.rejectionNotes && (
                <p style={{ fontSize: 11, color: '#cf222e', margin: '3px 0 0', fontStyle: 'italic' }}>
                  Alasan ditolak: {d.rejectionNotes}
                </p>
              )}
              <p style={{ fontSize: 10, color: '#8c959f', margin: '2px 0 0' }}>oleh {d.uploadedBy.name}</p>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 8 }}>
              <a href={fixFileUrl(d.fileUrl)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0969DA' }}>Lihat</a>

              {/* Issue #3: Only SURVEYOR_FTTT can replace REJECTED docs */}
              {canReplaceDocs && d.approvalStatus === 'REJECTED' && (
                <>
                  <button type="button" onClick={() => { setReplacingId(d.id); setTimeout(() => replaceRef.current?.click(), 50); }}
                    style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid #FFA500', background: '#FFF8F0', color: '#7d5a00', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                    🔄 Ganti
                  </button>
                  {replacingId === d.id && (
                    <input ref={replaceRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReplace(d.id, f); }} />
                  )}
                </>
              )}

              {/* Issue #2: PM approves / rejects with mandatory reason */}
              {canPmApprove && d.approvalStatus === 'PENDING_PM' && (
                <>
                  <button type="button" onClick={() => void handleApprove(d.id, true)}
                    style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓</button>
                  <button type="button" onClick={() => { setRejectTarget(d.id); setRejectReason(''); }}
                    style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗</button>
                </>
              )}

              {/* Issue #2: Admin approves / rejects with mandatory reason */}
              {canAdminApprove && d.approvalStatus === 'PENDING_ADMIN' && (
                <>
                  <button type="button" onClick={() => void handleApprove(d.id, true)}
                    style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#DAFBE1', color: '#1a7f37', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✓ Setujui</button>
                  <button type="button" onClick={() => { setRejectTarget(d.id); setRejectReason(''); }}
                    style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: '#FFEBE9', color: '#cf222e', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>✗ Tolak</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Issue #2: Rejection reason dialog (mandatory) */}
      {rejectTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#cf222e' }}>Alasan Penolakan</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#57606a' }}>
              Berikan alasan penolakan yang jelas agar Surveyor FTTT dapat melakukan perbaikan yang sesuai.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Tuliskan alasan penolakan dokumen… (wajib diisi)"
              style={{ width: '100%', padding: 10, borderRadius: 8, border: `1px solid ${rejectReason.trim() ? '#D0D7DE' : '#cf222e'}`, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontSize: 13 }}>Batal</button>
              <button type="button" onClick={() => { void handleRejectWithReason(); }}
                disabled={!rejectReason.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectReason.trim() ? '#cf222e' : '#8C959F', color: '#fff', fontWeight: 600, cursor: rejectReason.trim() ? 'pointer' : 'not-allowed', fontSize: 13 }}>
                Konfirmasi Tolak
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Only Surveyor FTTT (and GM for oversight) can upload new docs */}
      {canUploadDocs ? (
        <div style={{ border: '1px solid #D0D7DE', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>Upload Dokumen Baru</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <select value={docType} onChange={(e) => setDocType(e.target.value as 'ATP' | 'BAUT' | 'SUPPORTING' | 'EVIDENCE')}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12 }}>
              <option value="ATP">ATP</option>
              <option value="BAUT">BAUT</option>
              <option value="SUPPORTING">Supporting Doc</option>
              <option value="EVIDENCE">Project Evidence</option>
            </select>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Catatan (opsional)"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #D0D7DE', fontSize: 12, minWidth: 100 }} />
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#0969DA', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>
            {uploading ? 'Mengunggah…' : '+ Upload'}
          </button>
        </div>
      ) : (canPmApprove || canAdminApprove) ? (
        <div style={{ background: '#F0F8FF', border: '1px solid #0969DA', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 12, color: '#0969DA' }}>
          ℹ️ Anda hanya dapat mereview dan approve/reject dokumen. Upload & penggantian dokumen hanya dapat dilakukan oleh Surveyor FTTT.
        </div>
      ) : null}
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

// ─── Reconciliation & Billing Section (Issue #4) ─────────────────────────────
// Company-specific document definitions for Reconciliation phase
const RECON_DOCS: Record<string, {
  key: string; label: string; desc: string;
  uploaderRole: string[]; requiresApproval: boolean;
}[]> = {
  TELKOM_INFRA: [
    { key: 'BAPP',        label: 'BAPP',                  desc: 'Amandemen 2; Surat Waspang No Dinas; Risalah Rapat/MOM',      uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true },
    { key: 'BAST_BAPWPP', label: 'BAST & BAPWPP',         desc: 'Amandemen 1; Amandemen 2; PO; BOQ Perhitungan',              uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true },
    { key: 'BA_PENUTUPAN',label: 'BA Penutupan',           desc: 'Berita Acara Penutupan Project',                             uploaderRole: ['SURVEYOR_FTTT'], requiresApproval: true },
    { key: 'GOOD_RECEIPT', label: 'Good Receipt',          desc: 'Diterbitkan Telkom Infra — upload setelah 3 dok. di atas approved', uploaderRole: ['ADMIN'], requiresApproval: false },
    { key: 'JAMINAN_PEMELIHARAAN', label: 'Jaminan Pemeliharaan', desc: 'Diupload Finance',                                   uploaderRole: ['FINANCE'], requiresApproval: false },
    { key: 'INVOICE_FINAL', label: 'Invoice Final',        desc: 'Tagihan akhir project — dibuat Finance',                     uploaderRole: ['FINANCE'], requiresApproval: false },
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

                {/* Upload/Replace button */}
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
