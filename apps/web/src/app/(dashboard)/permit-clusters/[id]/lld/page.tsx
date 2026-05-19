'use client';

// FIX Fix 1: dedicated LLD page — Designer (primary) uploads → PM reviews → Admin reviews → ISP approves
import { useState, useEffect, useCallback } from 'react'; // FIX: reload setelah aksi tanpa navigasi penuh
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost, apiPatch, uploadFile } from '../../../../../lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft, Upload, FileText, ChevronRight, Clock,
} from 'lucide-react';

// FIX Fix 1: human-readable LLD status labels — no more raw enum in UI
const STATUS_LABELS: Record<string, string> = {
  DRAFT:                 'Draft',
  SUBMITTED_FOR_REVIEW:  'Menunggu Review PM',
  PM_APPROVED:           'Disetujui PM — Menunggu Admin',
  PM_REJECTED:           'Ditolak PM',
  ADMIN_APPROVED:        'Disetujui Admin',
  ADMIN_REJECTED:        'Ditolak Admin',
  PENDING_ISP:           'Menunggu ISP',
  ISP_APPROVED:          'Disetujui ISP',
  ISP_REVISION:          'Perlu Revisi (ISP)',
};

export default function LldPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [lld, setLld] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rejectNotes, setRejectNotes] = useState(''); // FIX: catatan penolakan Admin
  const [showAdminReject, setShowAdminReject] = useState(false); // FIX: tampilkan form tolak
  const [showPmReject, setShowPmReject] = useState(false); // FIX: form tolak PM
  const [pmRejectNotes, setPmRejectNotes] = useState(''); // FIX: catatan PM ke Designer
  const [ispDecisionNotes, setIspDecisionNotes] = useState(''); // FIX: catatan input respon ISP

  const [uploadingApd, setUploadingApd] = useState(false);
  const [uploadingSchematic, setUploadingSchematic] = useState(false);
  const [uploadingCore, setUploadingCore] = useState(false);
  const [uploadingExtra, setUploadingExtra] = useState(false);

  const [form, setForm] = useState<{
    apdFileUrl: string;
    schematicFileUrl: string;
    coreConnectionUrl: string;
    additionalFiles: string[];
  }>({
    apdFileUrl: '',
    schematicFileUrl: '',
    coreConnectionUrl: '',
    additionalFiles: [],
  });
  const [fileNames, setFileNames] = useState<{
    apd: string; schematic: string; core: string; additional: string[];
  }>({
    apd: '', schematic: '', core: '', additional: [],
  });

  const loadAll = useCallback(async () => {
    setLoading(true); // FIX
    try {
      const [clData, lldData] = await Promise.all([
        apiGet<any>(`/permit-clusters/${clusterId}`), // FIX
        apiGet<any>(`/permit-clusters/${clusterId}/lld`).catch(() => null), // FIX
      ]);
      setCluster(clData); // FIX
      if (lldData) {
        setLld(lldData); // FIX
        setForm({
          apdFileUrl: lldData.apdFileUrl || '',
          schematicFileUrl: lldData.schematicFileUrl || '',
          coreConnectionUrl: lldData.coreConnectionUrl || '',
          additionalFiles: lldData.additionalFiles || [],
        }); // FIX
        setFileNames({
          apd: deriveName(lldData.apdFileUrl),
          schematic: deriveName(lldData.schematicFileUrl),
          core: deriveName(lldData.coreConnectionUrl),
          additional: (lldData.additionalFiles || []).map(deriveName),
        }); // FIX
      }
    } catch {
      toast.error('Gagal memuat data LLD'); // FIX
    } finally {
      setLoading(false); // FIX
    }
  }, [clusterId]); // FIX

  useEffect(() => {
    void loadAll(); // FIX
  }, [loadAll]); // FIX

  // FIX Fix 1: dedicated role flags — Designer is primary, PM/Admin are secondary actors
  const isDesigner = user?.role === 'DESIGNER'; // FIX Fix 1: Designer is PRIMARY LLD uploader
  const isPM = !!user?.role?.startsWith('PM_') || user?.role === 'PM_SENIOR'; // FIX Fix 1: any PM variant reviews LLD
  const isAdmin = user?.role === 'ADMIN'; // FIX Fix 1: Admin approves after PM and records ISP decisions

  // FIX Fix 1: upload permission — Designer primary, PM/Admin fallback (per spec)
  const canUpload = isDesigner || isPM || isAdmin;

  // REFACTOR: submit permission — requires existing LLD, valid status, and required files
  const canSubmit =
    (isDesigner || isPM) &&
    lld && // Must have existing LLD record
    (lld.status === 'WAITING_INPUT' || lld.status === 'DRAFT' || lld.status === 'ISP_REVISION' || lld.status === 'PM_REJECTED' || lld.status === 'ADMIN_REJECTED') &&
    form.apdFileUrl && // Must have APD uploaded
    form.schematicFileUrl && // Must have Schematic uploaded
    form.coreConnectionUrl; // Must have Core Connection uploaded

  // FIX Fix 1: role-aware submit button label
  const submitButtonLabel =
    isDesigner && lld?.status === 'ISP_REVISION'
      ? '📤 Submit Revisi ke PM' // FIX: setelah revisi ISP
      : isDesigner
        ? '📤 Submit ke PM untuk Review'
        : '📤 Submit untuk Review'; // FIX

  // FIX Fix 1: the old `canEdit` now maps cleanly onto the new upload permission flag
  const canEdit = canUpload;

  const handleUpload = async (
    file: File,
    type: 'apd' | 'schematic' | 'core' | 'additional',
  ) => {
    const setUploading =
      type === 'apd' ? setUploadingApd
      : type === 'schematic' ? setUploadingSchematic
      : type === 'core' ? setUploadingCore
      : setUploadingExtra;
    setUploading(true);
    try {
      const url = await uploadFile(file, `lld/${type}`, clusterId);
      if (type === 'additional') {
        setForm((p) => ({ ...p, additionalFiles: [...p.additionalFiles, url] }));
        setFileNames((p) => ({ ...p, additional: [...p.additional, file.name] }));
      } else {
        const key =
          type === 'apd' ? 'apdFileUrl'
          : type === 'schematic' ? 'schematicFileUrl'
          : 'coreConnectionUrl';
        setForm((p) => ({ ...p, [key]: url }));
        setFileNames((p) => ({ ...p, [type]: file.name }));
      }
      toast.success(`✅ ${file.name} berhasil diupload`);
    } catch (err: any) {
      toast.error(`Upload gagal: ${err?.message || 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveOrSubmit = async (action: 'save' | 'submit') => {
    if (!form.apdFileUrl) { toast.error('File APD wajib diupload'); return; }
    if (!form.schematicFileUrl) { toast.error('File Schematic wajib diupload'); return; }
    if (!form.coreConnectionUrl) { toast.error('File Core Connection wajib diupload'); return; }
    setSaving(true);
    try {
      let activeId = lld?.id as string | undefined;
      if (!activeId) {
        const created = await apiPost<any>(`/permit-clusters/${clusterId}/lld`, form);
        setLld(created);
        activeId = created?.id;
      } else {
        await apiPatch(`/permit-clusters/${clusterId}/lld/${activeId}`, form);
      }
      if (action === 'submit' && activeId) {
        await apiPost(`/permit-clusters/${clusterId}/lld/${activeId}/submit`, {});
        toast.success('✅ LLD berhasil disubmit untuk review PM'); // FIX Fix 1: confirm the Designer → PM hand-off
        await loadAll(); // FIX: tetap di halaman; muat ulang status
      } else {
        toast.success('LLD disimpan');
        await loadAll(); // FIX
      }
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan LLD');
    } finally {
      setSaving(false);
    }
  };

  const handlePmApprove = async () => {
    if (!lld?.id) return;
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/pm-approve`, {});
      toast.success('✅ LLD disetujui — diteruskan ke Admin'); // FIX Fix 1: PM → Admin hand-off feedback
      router.push(`/permit-clusters/${clusterId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal approve');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminApprove = async () => {
    if (!lld?.id) return;
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/admin-approve`, {});
      toast.success('✅ LLD disetujui Admin — menunggu ISP'); // FIX Fix 1: Admin → ISP hand-off feedback
      router.push(`/permit-clusters/${clusterId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal approve');
    } finally {
      setSaving(false);
    }
  };

  const slaInfo = lld?.slaDeadline
    ? (() => {
        const diff = new Date(lld.slaDeadline).getTime() - Date.now();
        const days = Math.ceil(diff / 86400000);
        return { days, breached: days < 0 };
      })()
    : null;

  // FIX Fix 1: 5-step approval chain indicator — Designer → PM → Admin → ISP Pending → ISP Approved
  type ChainStatus = 'done' | 'active' | 'pending' | 'rejected';
  type ChainStep = { label: string; status: ChainStatus };
  const chainSteps: ChainStep[] = ((): ChainStep[] => {
    if (!lld) {
      return [
        { label: 'Designer Upload', status: 'active' },
        { label: 'PM Review',       status: 'pending' },
        { label: 'Admin Review',    status: 'pending' },
        { label: 'ISP Pending',     status: 'pending' },
        { label: 'ISP Approved',    status: 'pending' },
      ];
    }
    const s = String(lld.status);
    const pmStatus: ChainStatus =
      s === 'SUBMITTED_FOR_REVIEW' ? 'active'
      : s === 'PM_REJECTED' ? 'rejected'
      : ['PM_APPROVED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(s) ? 'done'
      : 'pending';
    const adminStatus: ChainStatus =
      s === 'PM_APPROVED' ? 'active'
      : s === 'ADMIN_REJECTED' ? 'rejected'
      : ['ADMIN_APPROVED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED'].includes(s) ? 'done'
      : 'pending';
    const ispPendingStatus: ChainStatus =
      s === 'PENDING_ISP' ? 'active'
      : s === 'ISP_REVISION' ? 'rejected'
      : s === 'ISP_APPROVED' ? 'done'
      : 'pending';
    const ispApprovedStatus: ChainStatus = s === 'ISP_APPROVED' ? 'done' : 'pending';

    return [
      { label: 'Designer Upload', status: 'done' }, // FIX Fix 1: always "done" once an LLD record exists
      { label: 'PM Review',       status: pmStatus },
      { label: 'Admin Review',    status: adminStatus },
      { label: 'ISP Pending',     status: ispPendingStatus },
      { label: 'ISP Approved',    status: ispApprovedStatus },
    ];
  })();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 300, color: 'var(--color-text-secondary)',
        }}
      >
        ⏳ Memuat data LLD...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 0 60px' }}>
      <button
        onClick={() => router.push(`/permit-clusters/${clusterId}`)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 14px', borderRadius: 8,
          border: '0.5px solid var(--color-border-tertiary)',
          background: 'none', cursor: 'pointer', fontSize: 13,
          color: 'var(--color-text-secondary)', marginBottom: 20,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Kembali ke Pipeline
      </button>

      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 8, fontSize: 12, color: 'var(--color-text-secondary)',
          }}
        >
          <span
            onClick={() => router.push('/permit-clusters')}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            Pipeline
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span
            onClick={() => router.push(`/permit-clusters/${clusterId}`)}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            {cluster?.clusterCode}
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span style={{ color: 'var(--color-text-primary)' }}>LLD</span>
        </div>

        <div
          style={{
            display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22, fontWeight: 700, margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              Low Level Design (LLD)
            </h1>
            <p
              style={{
                fontSize: 13, color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              {/* FIX Fix 1: human chain description instead of raw phase number */}
              Designer upload → PM review → Admin review → ISP approval
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12,
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)', fontWeight: 500,
              }}
            >
              📍 {cluster?.clusterCode}
            </span>
            {lld ? (
              <span
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12,
                  background: lld.status === 'ISP_APPROVED' ? '#22C55E15'
                    : String(lld.status).includes('REJECTED') ? '#EF444415'
                      : '#F59E0B15',
                  color: lld.status === 'ISP_APPROVED' ? '#22C55E'
                    : String(lld.status).includes('REJECTED') ? '#EF4444'
                      : '#F59E0B',
                  fontWeight: 600,
                }}
              >
                {/* FIX Fix 1: show human label instead of raw enum */}
                {STATUS_LABELS[lld.status] || String(lld.status).replace(/_/g, ' ')}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* FIX Fix 1: visible 5-step approval chain so every actor sees exactly where the LLD is */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 0,
          margin: '0 0 20px',
          padding: '14px 16px', borderRadius: 12,
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
        }}
      >
        {chainSteps.map((step, i) => {
          const colors = {
            done:    '#00D4B4',
            active:  '#F59E0B',
            pending: '#9CA3AF',
            rejected:'#EF4444',
          } as const;
          return (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 0 }}>
                <div
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: `${colors[step.status]}20`,
                    border: `1.5px solid ${colors[step.status]}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: colors[step.status], fontWeight: 600,
                  }}
                >
                  {step.status === 'done' ? '✓' : step.status === 'rejected' ? '✗' : i + 1}
                </div>
                <span style={{ fontSize: 10, color: colors[step.status], marginTop: 3, whiteSpace: 'nowrap' }}>
                  {step.label}
                </span>
              </div>
              {i < chainSteps.length - 1 && (
                <div
                  style={{
                    flex: 1, height: 1.5,
                    background: step.status === 'done' ? '#00D4B4' : '#E5E7EB',
                    margin: '0 4px', marginBottom: 14,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {slaInfo ? (
        <div
          style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 20,
            background: slaInfo.breached ? '#EF444415' : '#F59E0B15',
            border: `0.5px solid ${slaInfo.breached ? '#EF444440' : '#F59E0B40'}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <Clock
            style={{
              width: 16, height: 16,
              color: slaInfo.breached ? '#EF4444' : '#F59E0B',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 13, fontWeight: 500,
              color: slaInfo.breached ? '#EF4444' : '#F59E0B',
            }}
          >
            {slaInfo.breached
              ? `⚠️ SLA TERLEWAT ${Math.abs(slaInfo.days)} hari`
              : `⏰ SLA: ${slaInfo.days} hari tersisa (deadline 1 minggu)`}
          </span>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #00D4B4',
            borderRadius: 12, padding: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: 8,
                background: '#00D4B415',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <FileText style={{ width: 16, height: 16, color: '#00D4B4' }} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: 15, fontWeight: 600, margin: 0,
                  color: 'var(--color-text-primary)',
                }}
              >
                Dokumen Utama LLD
              </h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
                APD, Schematic, dan Core Connection — ketiga file wajib
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FileUploadCard
              label="File APD (As-Built Drawing)"
              hint="Format .pdf — gambar as-built perangkat lapangan"
              accept=".pdf"
              fileUrl={form.apdFileUrl}
              fileName={fileNames.apd}
              uploading={uploadingApd}
              canEdit={canEdit}
              onUpload={(f) => handleUpload(f, 'apd')}
              required
              icon="📐"
            />
            <FileUploadCard
              label="File Schematic"
              hint="Format .pdf — diagram skematik jaringan"
              accept=".pdf"
              fileUrl={form.schematicFileUrl}
              fileName={fileNames.schematic}
              uploading={uploadingSchematic}
              canEdit={canEdit}
              onUpload={(f) => handleUpload(f, 'schematic')}
              required
              icon="🧭"
            />
            <FileUploadCard
              label="File Core Connection"
              hint="Format .pdf atau .xlsx — tabel + diagram koneksi core fiber"
              accept=".pdf,.xlsx,.xls"
              fileUrl={form.coreConnectionUrl}
              fileName={fileNames.core}
              uploading={uploadingCore}
              canEdit={canEdit}
              onUpload={(f) => handleUpload(f, 'core')}
              required
              icon="🧬"
            />
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #8B5CF6',
            borderRadius: 12, padding: 24,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h3
              style={{
                fontSize: 15, fontWeight: 600, margin: '0 0 4px',
                color: 'var(--color-text-primary)',
              }}
            >
              Dokumen Tambahan (Opsional)
            </h3>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
              Cross connection diagram, foto perangkat, dokumen pendukung lainnya
            </p>
          </div>

          {form.additionalFiles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {form.additionalFiles.map((url, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'var(--color-background-secondary)',
                  }}
                >
                  <span>📄</span>
                  <span
                    style={{
                      fontSize: 12, flex: 1,
                      color: 'var(--color-text-primary)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {fileNames.additional[i] || `Lampiran ${i + 1}`}
                  </span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 12, color: 'var(--color-text-info)',
                      textDecoration: 'none',
                    }}
                  >
                    Download
                  </a>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((p) => ({
                          ...p,
                          additionalFiles: p.additionalFiles.filter((_, j) => j !== i),
                        }));
                        setFileNames((p) => ({
                          ...p,
                          additional: p.additional.filter((_, j) => j !== i),
                        }));
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#EF4444', fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {canEdit ? (
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                border: `1.5px dashed ${uploadingExtra ? '#8B5CF6' : 'var(--color-border-tertiary)'}`,
                background: uploadingExtra ? '#8B5CF608' : 'transparent',
              }}
            >
              <Upload style={{ width: 16, height: 16, color: 'var(--color-text-secondary)' }} />
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {uploadingExtra ? 'Mengupload...' : '+ Tambah lampiran'}
              </span>
              <input
                type="file"
                disabled={uploadingExtra}
                accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f, 'additional');
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}
        </div>

        {lld?.status === 'DRAFT' && lld?.adminNotes ? (
          <div
            style={{
              padding: '14px 18px', borderRadius: 10,
              background: '#8B5CF615', border: '0.5px solid #8B5CF640',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8B5CF6', marginBottom: 6 }}>
              ↺ Revisi dari Admin {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              {lld.adminNotes}
            </div>
          </div>
        ) : null}

        {lld?.status === 'DRAFT' && !lld?.adminNotes && (lld?.rejectionReason || lld?.ispFeedback) ? (
          <div
            style={{
              padding: '14px 18px', borderRadius: 10,
              background: '#F59E0B15', border: '0.5px solid #F59E0B40',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#D97706', marginBottom: 6 }}>
              ↺ Revisi dari PM {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              {lld.rejectionReason || lld.ispFeedback}
            </div>
          </div>
        ) : null}

        {lld?.status === 'ISP_REVISION' && lld?.ispFeedback ? (
          <div
            style={{
              padding: '14px 18px', borderRadius: 10,
              background: '#EF444415', border: '0.5px solid #EF444440',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#EF4444', marginBottom: 6 }}>
              ❌ Feedback ISP (Revisi Diperlukan) {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
              {lld.ispFeedback}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 8 }}>
          {canSubmit ? ( // FIX Fix 1: use role-aware canSubmit flag
            <>
              <button
                type="button"
                onClick={() => handleSaveOrSubmit('save')}
                disabled={saving}
                style={{
                  padding: '11px 22px', borderRadius: 10,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 14, color: 'var(--color-text-secondary)',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                Simpan Draft
              </button>
              <button
                type="button"
                onClick={() => handleSaveOrSubmit('submit')}
                disabled={
                  saving || !form.apdFileUrl || !form.schematicFileUrl || !form.coreConnectionUrl
                }
                style={{
                  padding: '11px 28px', borderRadius: 10, border: 'none',
                  background: !form.apdFileUrl || !form.schematicFileUrl || !form.coreConnectionUrl || saving
                    ? 'var(--color-background-secondary)'
                    : '#00D4B4',
                  color: !form.apdFileUrl || !form.schematicFileUrl || !form.coreConnectionUrl || saving
                    ? 'var(--color-text-secondary)'
                    : 'white',
                  cursor: !form.apdFileUrl || !form.schematicFileUrl || !form.coreConnectionUrl || saving
                    ? 'not-allowed'
                    : 'pointer',
                  fontSize: 14, fontWeight: 600,
                  boxShadow: !form.apdFileUrl || !form.schematicFileUrl || !form.coreConnectionUrl
                    ? 'none'
                    : '0 4px 14px #00D4B440',
                }}
              >
                {/* FIX Fix 1: label switches to Designer-specific copy when Designer is the actor */}
                {saving ? 'Memproses...' : submitButtonLabel}
              </button>
            </>
          ) : null}

          {isPM && lld?.status === 'SUBMITTED_FOR_REVIEW' ? ( // FIX: PM setujui atau tolak ke Designer
            <div style={{ width: '100%' }}>
              {showPmReject ? (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6,
                    color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Alasan penolakan (PM) *
                  </label>
                  <textarea
                    value={pmRejectNotes}
                    onChange={(e) => setPmRejectNotes(e.target.value)}
                    rows={3}
                    placeholder="Jelaskan perbaikan yang dibutuhkan..."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '9px 12px', borderRadius: 8, fontSize: 13,
                      border: '1.5px solid #F59E0B40',
                      background: 'var(--color-background-primary)',
                      color: 'var(--color-text-primary)', resize: 'vertical',
                    }}
                  />
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {!showPmReject ? (
                  <>
                    <button
                      type="button"
                      onClick={handlePmApprove}
                      disabled={saving}
                      style={{
                        padding: '11px 28px', borderRadius: 10, border: 'none',
                        background: '#00D4B4', color: 'white',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        fontSize: 14, fontWeight: 600,
                      }}
                    >
                      ✓ Setujui LLD (PM) → Teruskan ke Admin
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setShowPmReject(true)}
                      style={{
                        padding: '11px 22px', borderRadius: 10,
                        border: '1px solid #EF444440',
                        background: '#EF444412', color: '#EF4444',
                        cursor: 'pointer', fontSize: 14, fontWeight: 600,
                      }}
                    >
                      ❌ Tolak ke Designer {/* FIX */}
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={saving || !pmRejectNotes.trim()}
                      onClick={async () => {
                        if (!pmRejectNotes.trim()) {
                          toast.error('Isi alasan penolakan');
                          return;
                        }
                        setSaving(true);
                        try {
                          await apiPost(
                            `/permit-clusters/${clusterId}/lld/${lld.id}/pm-reject`,
                            { notes: pmRejectNotes },
                          );
                          toast.success('↺ LLD dikembalikan ke Designer');
                          setShowPmReject(false);
                          setPmRejectNotes('');
                          await loadAll(); // FIX
                        } catch (err: any) {
                          toast.error(err?.message || 'Gagal');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      style={{
                        padding: '11px 18px', borderRadius: 10, border: 'none',
                        background: '#EF4444', color: 'white',
                        cursor: (!pmRejectNotes.trim() || saving) ? 'not-allowed' : 'pointer',
                        fontSize: 14, fontWeight: 600,
                        opacity: (!pmRejectNotes.trim() || saving) ? 0.6 : 1,
                      }}
                    >
                      Konfirmasi Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowPmReject(false); setPmRejectNotes(''); }}
                      style={{
                        padding: '11px 18px', borderRadius: 10,
                        border: '0.5px solid var(--color-border-tertiary)',
                        background: 'none', cursor: 'pointer',
                        fontSize: 14, color: 'var(--color-text-secondary)',
                      }}
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isAdmin && lld?.status === 'PM_APPROVED' ? ( // FIX: Admin approve + tolak (kembali ke DRAFT)
            <div style={{
              width: '100%',
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #00D4B4',
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6,
                color: 'var(--color-text-primary)' }}>
                🔍 Review LLD (Admin)
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)',
                marginBottom: 16 }}>
                PM telah menyetujui LLD. Review dokumen lalu setujui atau tolak.
              </div>
              {showAdminReject ? (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 11,
                    fontWeight: 600, marginBottom: 6,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em' }}>
                    Alasan Penolakan *
                  </label>
                  <textarea
                    value={rejectNotes}
                    onChange={(e) => setRejectNotes(e.target.value)}
                    rows={3}
                    placeholder="Jelaskan apa yang perlu diperbaiki..."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '9px 12px', borderRadius: 8, fontSize: 13,
                      border: '1.5px solid #EF444440',
                      background: 'var(--color-background-primary)',
                      color: 'var(--color-text-primary)', resize: 'vertical',
                    }}
                  />
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleAdminApprove}
                  style={{
                    flex: 1, minWidth: 160, padding: '11px', borderRadius: 10, border: 'none',
                    background: '#00D4B4', color: 'white',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: 14, fontWeight: 600,
                  }}
                >
                  ✅ Setujui LLD (Admin)
                </button>
                {!showAdminReject ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setShowAdminReject(true)}
                    style={{
                      padding: '11px 20px', borderRadius: 10,
                      background: '#EF444415', color: '#EF4444',
                      cursor: 'pointer', fontSize: 14, fontWeight: 600,
                      border: '1px solid #EF444430',
                    }}
                  >
                    ❌ Tolak
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={saving || !rejectNotes.trim()}
                      onClick={async () => {
                        if (!rejectNotes.trim()) {
                          toast.error('Isi alasan penolakan');
                          return;
                        }
                        setSaving(true);
                        try {
                          await apiPost(
                            `/permit-clusters/${clusterId}/lld/${lld.id}/admin-reject`,
                            { notes: rejectNotes },
                          );
                          toast.success('↺ LLD ditolak — Designer akan merevisi');
                          setShowAdminReject(false); // FIX
                          setRejectNotes(''); // FIX
                          await loadAll(); // FIX
                        } catch (err: any) {
                          toast.error(err?.message || 'Gagal tolak');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      style={{
                        padding: '11px 16px', borderRadius: 10, border: 'none',
                        background: '#EF4444', color: 'white',
                        cursor: (!rejectNotes.trim() || saving) ? 'not-allowed' : 'pointer',
                        fontSize: 14, fontWeight: 600,
                        opacity: (!rejectNotes.trim() || saving) ? 0.6 : 1,
                      }}
                    >
                      Konfirmasi Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAdminReject(false);
                        setRejectNotes('');
                      }}
                      style={{
                        padding: '11px 16px', borderRadius: 10,
                        border: '0.5px solid var(--color-border-tertiary)',
                        background: 'none', cursor: 'pointer',
                        fontSize: 14, color: 'var(--color-text-secondary)',
                      }}
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isAdmin && lld?.status === 'PENDING_ISP' ? (
            <div style={{
              width: '100%',
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #F59E0B',
              borderRadius: 12, padding: 20,
            }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary)' }}>
                📋 Input Respon ISP {/* FIX */}
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                Catatan opsional untuk persetujuan; wajib diisi jika meminta revisi. {/* FIX */}
              </p>
              <textarea
                value={ispDecisionNotes}
                onChange={(e) => setIspDecisionNotes(e.target.value)}
                rows={2}
                placeholder="Catatan ISP..."
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '9px 12px', borderRadius: 8, fontSize: 13,
                  border: '1.5px solid var(--color-border-tertiary)',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)', resize: 'vertical',
                  marginBottom: 14,
                }}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/isp-decision`, {
                        action: 'APPROVE',
                        feedback: ispDecisionNotes.trim() || undefined,
                      });
                      toast.success('✅ LLD disetujui ISP — lanjut ke PR/BR!'); // FIX
                      setIspDecisionNotes('');
                      await loadAll(); // FIX
                    } catch (err: any) {
                      toast.error(err?.message || 'Gagal');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  style={{
                    flex: 1, minWidth: 160, padding: '11px 22px', borderRadius: 10, border: 'none',
                    background: '#22C55E', color: 'white',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 600,
                  }}
                >
                  ✅ ISP Setujui → Lanjut ke PR/BR {/* FIX */}
                </button>
                <button
                  type="button"
                  disabled={saving || !ispDecisionNotes.trim()}
                  onClick={async () => {
                    if (!ispDecisionNotes.trim()) {
                      toast.error('Isi feedback revisi untuk ISP');
                      return;
                    }
                    setSaving(true);
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/lld/${lld.id}/isp-decision`, {
                        action: 'REVISE',
                        feedback: ispDecisionNotes.trim(),
                      });
                      toast.success('🔄 ISP minta revisi — dikembalikan ke Designer'); // FIX
                      setIspDecisionNotes('');
                      await loadAll(); // FIX
                    } catch (err: any) {
                      toast.error(err?.message || 'Gagal');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  style={{
                    flex: 1, minWidth: 160, padding: '11px 22px', borderRadius: 10,
                    border: '1px solid #F59E0B40',
                    background: '#F59E0B12', color: '#F59E0B',
                    cursor: (!ispDecisionNotes.trim() || saving) ? 'not-allowed' : 'pointer',
                    fontSize: 13, fontWeight: 600,
                    opacity: (!ispDecisionNotes.trim() || saving) ? 0.6 : 1,
                  }}
                >
                  🔄 ISP Minta Revisi {/* FIX */}
                </button>
              </div>
            </div>
          ) : null}

          {lld?.status === 'ISP_APPROVED' ? (
            <div style={{
              padding: '14px 18px', borderRadius: 10,
              background: '#22C55E15', border: '0.5px solid #22C55E40',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 22 }}>✅</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#22C55E' }}>
                  LLD Disetujui ISP {/* FIX */}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  Proses berlanjut ke fase PR/BR Issuance {/* FIX */}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Derive filename from storage upload URL (strips timestamp prefix)
function deriveName(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const decoded = decodeURIComponent(url);
    const last = decoded.split('/').pop() || '';
    return last.replace(/^\d+-/, '');
  } catch {
    return '';
  }
}

function FileUploadCard({
  label, hint, accept, fileUrl, fileName, uploading, canEdit, onUpload, required = false, icon = '📄',
}: {
  label: string;
  hint: string;
  accept: string;
  fileUrl: string;
  fileName: string;
  uploading: boolean;
  canEdit: boolean;
  onUpload: (f: File) => void;
  required?: boolean;
  icon?: string;
}) {
  return (
    <div>
      <label
        style={{
          display: 'block', fontSize: 11, fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {label}
        {required ? <span style={{ color: '#EF4444' }}> *</span> : null}
      </label>

      {fileUrl ? (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '12px 16px', borderRadius: 10,
            background: '#22C55E15', border: '1.5px solid #22C55E40',
          }}
        >
          <span style={{ fontSize: 24 }}>{icon}</span>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div
              style={{
                fontSize: 13, fontWeight: 500,
                color: 'var(--color-text-primary)',
                wordBreak: 'break-all',
              }}
            >
              {fileName || label}
            </div>
            <div style={{ fontSize: 11, color: '#22C55E' }}>✓ File tersedia</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12,
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-info)', textDecoration: 'none',
              }}
            >
              Download
            </a>
            {canEdit ? (
              <label
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12,
                  background: '#F59E0B15', color: '#F59E0B',
                  cursor: 'pointer',
                }}
              >
                Ganti
                <input
                  type="file"
                  accept={accept}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUpload(f);
                    e.target.value = '';
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : canEdit ? (
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 20px', borderRadius: 10,
            border: `1.5px dashed ${uploading ? '#00D4B4' : 'var(--color-border-tertiary)'}`,
            background: uploading ? '#00D4B408' : 'var(--color-background-secondary)',
            cursor: uploading ? 'wait' : 'pointer',
            transition: 'all 150ms',
          }}
        >
          <span style={{ fontSize: 28, flexShrink: 0 }}>
            {uploading ? '⏳' : '⬆️'}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {uploading ? 'Mengupload...' : `Upload ${label}`}
            </div>
            <div
              style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}
            >
              {hint}
            </div>
          </div>
          <input
            type="file"
            accept={accept}
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = '';
            }}
          />
        </label>
      ) : (
        <div
          style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'var(--color-background-secondary)',
            fontSize: 13, color: 'var(--color-text-secondary)',
            fontStyle: 'italic',
          }}
        >
          Belum ada file
        </div>
      )}
    </div>
  );
}
