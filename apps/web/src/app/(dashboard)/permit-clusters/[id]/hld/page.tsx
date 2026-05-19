'use client';

// FIX 3: dedicated HLD page — Design Team / PM upload KMZ + BOQ, submit → PM → Admin → ISP
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost, apiPatch, uploadFile } from '../../../../../lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft, Upload, FileText, ChevronRight, Clock,
} from 'lucide-react';

export default function HldPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [hld, setHld] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [uploadingKmz, setUploadingKmz] = useState(false);
  const [uploadingBoq, setUploadingBoq] = useState(false);
  const [uploadingExtra, setUploadingExtra] = useState(false);

  const [form, setForm] = useState<{
    kmzFileUrl: string;
    boqFileUrl: string;
    additionalFiles: string[];
  }>({
    kmzFileUrl: '',
    boqFileUrl: '',
    additionalFiles: [],
  });
  const [fileNames, setFileNames] = useState<{ kmz: string; boq: string; additional: string[] }>({
    kmz: '', boq: '', additional: [],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [clData, hldData] = await Promise.all([
          apiGet<any>(`/permit-clusters/${clusterId}`),
          apiGet<any>(`/permit-clusters/${clusterId}/hld`).catch(() => null),
        ]);
        setCluster(clData);
        if (hldData) {
          setHld(hldData);
          setForm({
            kmzFileUrl: hldData.kmzFileUrl || '',
            boqFileUrl: hldData.boqFileUrl || '',
            additionalFiles: hldData.additionalFiles || [],
          });
          setFileNames({
            kmz: deriveName(hldData.kmzFileUrl),
            boq: deriveName(hldData.boqFileUrl),
            additional: (hldData.additionalFiles || []).map(deriveName),
          });
        }
      } catch {
        toast.error('Gagal memuat data HLD');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [clusterId]);

  const isDesigner = user?.role === 'DESIGNER'; // FIX: Only Designer can upload in Pipeline 9
  const isPM = !!user?.role?.startsWith('PM_') || user?.role === 'PM_SENIOR';
  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isDesigner || isPM || isAdmin;
  // FIX: Upload UI visible for Designer when status is WAITING_INPUT, DRAFT, or rejection states
  const canUpload =
    isDesigner &&
    (!hld ||
      hld.status === 'WAITING_INPUT' ||
      hld.status === 'DRAFT' ||
      hld.status === 'ISP_REVISION' ||
      hld.status === 'PM_REJECTED' ||
      hld.status === 'ADMIN_REJECTED');
  const submitLabel =
    hld?.status === 'ISP_REVISION'
      ? '🔄 Submit Revisi ke PM (Ulang dari Awal)'
      : hld?.status === 'DRAFT' && hld?.pmNotes
        ? '📤 Submit Revisi ke PM'
        : '📤 Submit ke PM untuk Review'; // FIX: contextual CTA copy

  const handleUpload = async (file: File, type: 'kmz' | 'boq' | 'additional') => {
    const setUploading = type === 'kmz' ? setUploadingKmz : type === 'boq' ? setUploadingBoq : setUploadingExtra;
    setUploading(true);
    try {
      const url = await uploadFile(file, `hld/${type}`, clusterId); // FIX 3: module path /hld/kmz etc.
      if (type === 'additional') {
        setForm((p) => ({ ...p, additionalFiles: [...p.additionalFiles, url] }));
        setFileNames((p) => ({ ...p, additional: [...p.additional, file.name] }));
      } else {
        setForm((p) => ({ ...p, [`${type}FileUrl`]: url }));
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
    if (!form.kmzFileUrl) {
      toast.error('File KMZ HLD wajib diupload');
      return;
    }
    if (!form.boqFileUrl) {
      toast.error('File BOQ wajib diupload');
      return;
    }
    setSaving(true);
    try {
      let activeId = hld?.id as string | undefined;
      if (!activeId) {
        const created = await apiPost<any>(`/permit-clusters/${clusterId}/hld`, form);
        setHld(created);
        activeId = created?.id;
      } else {
        await apiPatch(`/permit-clusters/${clusterId}/hld/${activeId}`, form);
      }
      if (action === 'submit' && activeId) {
        await apiPost(`/permit-clusters/${clusterId}/hld/${activeId}/submit`, {});
        toast.success('✅ HLD berhasil disubmit untuk review PM');
        router.push(`/permit-clusters/${clusterId}`);
      } else {
        toast.success('HLD disimpan');
        const reload = await apiGet<any>(`/permit-clusters/${clusterId}/hld`).catch(() => null);
        if (reload) setHld(reload);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan HLD');
    } finally {
      setSaving(false);
    }
  };

  const handlePmApprove = async () => {
    if (!hld?.id) return;
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/pm-approve`, {});
      toast.success('✅ HLD disetujui — diteruskan ke Admin');
      router.push(`/permit-clusters/${clusterId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal approve');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminApprove = async () => {
    if (!hld?.id) return;
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/admin-approve`, {});
      toast.success('✅ HLD disetujui Admin — menunggu ISP');
      router.push(`/permit-clusters/${clusterId}`);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal approve');
    } finally {
      setSaving(false);
    }
  };

  const slaInfo = hld?.slaDeadline
    ? (() => {
        const diff = new Date(hld.slaDeadline).getTime() - Date.now();
        const days = Math.ceil(diff / 86400000);
        return { days, breached: days < 0 };
      })()
    : null;

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          color: 'var(--color-text-secondary)',
        }}
      >
        ⏳ Memuat data HLD...
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
          <span style={{ color: 'var(--color-text-primary)' }}>HLD</span>
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
              High Level Design (HLD)
            </h1>
            <p
              style={{
                fontSize: 13, color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Phase 9 — Upload KMZ + BOQ, submit untuk review
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
            {hld ? (
              <span
                style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 12,
                  background: hld.status === 'ISP_APPROVED' ? '#22C55E15'
                    : String(hld.status).includes('REJECTED') ? '#EF444415'
                      : '#F59E0B15',
                  color: hld.status === 'ISP_APPROVED' ? '#22C55E'
                    : String(hld.status).includes('REJECTED') ? '#EF4444'
                      : '#F59E0B',
                  fontWeight: 600,
                }}
              >
                {hld.status}
              </span>
            ) : null}
          </div>
        </div>
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
                Dokumen Utama HLD
              </h3>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
                KMZ (route design) + BOQ (bill of quantity) — kedua file wajib
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FileUploadCard
              label="File KMZ (Route Design)"
              hint="Format .kmz atau .kml — Jalur kabel dan titik perangkat"
              accept=".kmz,.kml"
              fileUrl={form.kmzFileUrl}
              fileName={fileNames.kmz}
              uploading={uploadingKmz}
              canEdit={canUpload}
              onUpload={(f) => handleUpload(f, 'kmz')}
              required
              icon="🗺️"
            />
            <FileUploadCard
              label="File BOQ (Bill of Quantity)"
              hint="Format .xlsx, .xls, atau .pdf — Daftar material dan estimasi biaya"
              accept=".xlsx,.xls,.pdf"
              fileUrl={form.boqFileUrl}
              fileName={fileNames.boq}
              uploading={uploadingBoq}
              canEdit={canUpload}
              onUpload={(f) => handleUpload(f, 'boq')}
              required
              icon="📊"
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
              Lampiran pendukung HLD — spesifikasi teknis, foto lapangan, dll
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
                      fontSize: 12, color: 'var(--color-text-info)', textDecoration: 'none',
                    }}
                  >
                    Download
                  </a>
                  {canUpload ? (
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

          {canUpload ? (
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

        {hld?.status === 'ISP_REVISION' && hld?.ispFeedback ? (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              marginBottom: 16,
              background: '#EF444415',
              border: '1.5px solid #EF444440',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#EF4444', marginBottom: 4 }}>
              🔄 ISP Meminta Revisi {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
              {hld.ispFeedback}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6 }}>
              Upload file HLD yang sudah direvisi di bawah ini. {/* FIX */}
            </div>
          </div>
        ) : null}
        {hld?.status === 'DRAFT' && hld?.pmNotes ? (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              marginBottom: 16,
              background: '#F59E0B15',
              border: '1px solid #F59E0B40',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>
              ↺ PM Meminta Perbaikan {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{hld.pmNotes}</div>
          </div>
        ) : null}
        {hld?.status === 'DRAFT' && hld?.adminNotes ? (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 10,
              marginBottom: 16,
              background: '#F59E0B15',
              border: '1px solid #F59E0B40',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#D97706', marginBottom: 4 }}>
              ↺ Admin Meminta Perbaikan {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{hld.adminNotes}</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 8 }}>
          {canUpload ? (
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
                disabled={saving || !form.kmzFileUrl || !form.boqFileUrl}
                style={{
                  padding: '11px 28px', borderRadius: 10, border: 'none',
                  background: !form.kmzFileUrl || !form.boqFileUrl || saving
                    ? 'var(--color-background-secondary)'
                    : '#00D4B4',
                  color: !form.kmzFileUrl || !form.boqFileUrl || saving
                    ? 'var(--color-text-secondary)'
                    : 'white',
                  cursor: !form.kmzFileUrl || !form.boqFileUrl || saving
                    ? 'not-allowed'
                    : 'pointer',
                  fontSize: 14, fontWeight: 600,
                  boxShadow: !form.kmzFileUrl || !form.boqFileUrl
                    ? 'none'
                    : '0 4px 14px #00D4B440',
                }}
              >
                {saving ? 'Memproses...' : submitLabel}
              </button>
            </>
          ) : null}

          {(user?.role === 'PM_SENIOR' ||
            user?.role === 'PM_FTTH' ||
            user?.role === 'PM_FTTB' ||
            user?.role === 'PM_FTTT') &&
          hld?.status === 'SUBMITTED_FOR_REVIEW' ? (
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
              ✓ Setujui HLD (PM) {/* FIX: fiber PMs can approve their queue */}
            </button>
          ) : null}

          {isAdmin && hld?.status === 'PM_APPROVED' ? (
            <button
              type="button"
              onClick={handleAdminApprove}
              disabled={saving}
              style={{
                padding: '11px 28px', borderRadius: 10, border: 'none',
                background: '#3B82F6', color: 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 600,
              }}
            >
              ✓ Setujui HLD (Admin) → Kirim ke ISP
            </button>
          ) : null}

          {isAdmin && hld?.status === 'PENDING_ISP' ? (
            <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/isp-decision`, {
                      action: 'APPROVE',
                    });
                    toast.success('✅ ISP menyetujui HLD!');
                    router.push(`/permit-clusters/${clusterId}`);
                  } catch (err: any) {
                    toast.error(err?.message || 'Gagal');
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                style={{
                  padding: '11px 22px', borderRadius: 10, border: 'none',
                  background: '#22C55E', color: 'white',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                ✓ ISP Setujui HLD
              </button>
              <button
                type="button"
                onClick={async () => {
                  const feedback = typeof window !== 'undefined'
                    ? window.prompt('Feedback ISP (alasan revisi):')
                    : null;
                  if (!feedback) return;
                  setSaving(true);
                  try {
                    await apiPost(`/permit-clusters/${clusterId}/hld/${hld.id}/isp-decision`, {
                      action: 'REVISE',
                      feedback,
                    });
                    toast.success('ISP minta revisi — dikembalikan ke Design team');
                    router.push(`/permit-clusters/${clusterId}`);
                  } catch (err: any) {
                    toast.error(err?.message || 'Gagal');
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                style={{
                  padding: '11px 22px', borderRadius: 10, border: 'none',
                  background: '#F59E0B15', color: '#F59E0B',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                ↺ ISP Minta Revisi
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// FIX 3: derive filename from stored upload URL (format `<module>/<year>/<sub>/<ts>-<name>`)
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
              style={{
                fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2,
              }}
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
