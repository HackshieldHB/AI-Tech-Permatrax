'use client';
// FIX: BAKP Compilation Phase 17 panel
import { useState, useEffect, useCallback } from 'react'; // FIX: hooks
import { apiGet, apiPost, uploadFile } from '../../../../lib/api'; // FIX: API
import { toast } from 'sonner'; // FIX: toasts
import { BAKP_KOMPENSASI_DOCS, BAKP_KOORDINASI_DOCS } from '../../../../constants/bakp-documents';
import { isPmRole, isSurveyorRole } from '../../../../lib/roles';

interface Props {
  clusterId: string; // FIX
  userRole: string; // FIX
}

export default function BakpCompilationPhasePanel({ clusterId, userRole }: Props) {
  const [bakp, setBakp] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX
  const [saving, setSaving] = useState(false); // FIX
  const [uploadingKey, setUploadingKey] = useState<string | null>(null); // FIX
  const [showReject, setShowReject] = useState(false); // FIX
  const [rejectReason, setRejectReason] = useState(''); // FIX
  const [initializing, setInitializing] = useState(false); // FIX: POST /bakp/init

  const [partName, setPartName] = useState(''); // FIX
  const [partRole, setPartRole] = useState(''); // FIX
  const [partKtp, setPartKtp] = useState(''); // FIX

  const isSurveyor = isSurveyorRole(userRole);
  const isPM = isPmRole(userRole);
  const isAdmin = userRole === 'ADMIN'; // FIX
  const canInitBakp = isSurveyor || isPM || isAdmin; // FIX: fallback init button

  const loadBakp = useCallback(async () => {
    try {
      setLoading(true); // FIX
      const data = await apiGet<any | null>(`/permit-clusters/${clusterId}/bakp`, undefined, { silentForbidden: true }); // FIX
      setBakp(data ?? null); // FIX: API may return JSON null
    } catch (err: unknown) {
      const e = err as Error & { status?: number }; // FIX
      if (e.status === 404 || e.message?.includes('404')) {
        setBakp(null); // FIX: not initialized — not a hard error
      } else {
        toast.error(`Gagal memuat BAKP: ${e.message}`); // FIX
        setBakp(null); // FIX
      }
    } finally {
      setLoading(false); // FIX
    }
  }, [clusterId]); // FIX

  useEffect(() => {
    void loadBakp(); // FIX
  }, [loadBakp]); // FIX

  useEffect(() => {
    setShowReject(false); // FIX
    setRejectReason(''); // FIX
  }, [bakp?.status]); // FIX

  const handleInitBakp = async () => {
    setInitializing(true); // FIX
    try {
      await apiPost(`/permit-clusters/${clusterId}/bakp/init`, {}); // FIX
      await loadBakp(); // FIX
      toast.success('✅ BAKP berhasil diinisialisasi'); // FIX
    } catch (err: unknown) {
      const e = err as Error; // FIX
      toast.error(`Gagal inisialisasi: ${e.message}`); // FIX
    } finally {
      setInitializing(false); // FIX
    }
  };

  const handleUploadDoc = async (docKey: string, file: File) => {
    if (!bakp?.id) return; // FIX
    setUploadingKey(docKey); // FIX
    try {
      const url = await uploadFile(file, 'bakp', clusterId); // FIX
      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/upload-doc`, { docKey, fileUrl: url }); // FIX
      await loadBakp(); // FIX
      toast.success(`✅ ${docKey} berhasil diupload`); // FIX
    } catch (err: unknown) {
      const e = err as Error; // FIX
      toast.error(`Upload gagal: ${e.message}`); // FIX
    } finally {
      setUploadingKey(null); // FIX
    }
  };

  const handleAddParticipant = async () => {
    if (!partName.trim() || !partRole.trim()) {
      toast.error('Nama dan jabatan peserta wajib diisi'); // FIX
      return; // FIX
    }
    if (!bakp?.id) return; // FIX
    try {
      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/participants`, {
        name: partName, // FIX
        role: partRole, // FIX
        ktpNumber: partKtp, // FIX
      }); // FIX
      setPartName(''); // FIX
      setPartRole(''); // FIX
      setPartKtp(''); // FIX
      await loadBakp(); // FIX
      toast.success('Peserta ditambahkan'); // FIX
    } catch (err: unknown) {
      const e = err as Error; // FIX
      toast.error(e.message); // FIX
    }
  };

  const handleSubmit = async () => {
    if (!bakp?.id) return; // FIX
    const docs = (bakp.docBakpUrls as Record<string, string>) || {}; // FIX
    const missing = BAKP_KOMPENSASI_DOCS.filter((d) => !docs[d.key]).map((d) => d.label); // FIX
    if (missing.length > 0) {
      toast.error(`Dokumen wajib belum diupload: ${missing.join(', ')}`); // FIX
      return; // FIX
    }
    setSaving(true); // FIX
    try {
      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/field-team-submit`, {}); // FIX
      await loadBakp(); // FIX
      toast.success('✅ BAKP disubmit ke PM untuk review'); // FIX
    } catch (err: unknown) {
      const e = err as Error; // FIX
      toast.error(e.message || 'Gagal submit'); // FIX
    } finally {
      setSaving(false); // FIX
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', // FIX
    borderRadius: 8, // FIX
    fontSize: 13, // FIX
    border: '1.5px solid var(--color-border-tertiary)', // FIX
    background: 'var(--color-background-primary)', // FIX
    color: 'var(--color-text-primary)', // FIX
    outline: 'none', // FIX
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
        ⏳ Memuat data BAKP...
      </div>
    ); // FIX
  }

  if (!bakp) {
    return (
      <div
        style={{
          padding: 28, // FIX
          textAlign: 'center', // FIX
          background: 'var(--color-background-primary)', // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          borderRadius: 14, // FIX
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
        <div
          style={{
            fontSize: 15, // FIX
            fontWeight: 600, // FIX
            color: 'var(--color-text-primary)', // FIX
            marginBottom: 6, // FIX
          }}
        >
          BAKP Belum Diinisialisasi
        </div>
        <div
          style={{
            fontSize: 13, // FIX
            color: 'var(--color-text-secondary)', // FIX
            marginBottom: 18, // FIX
            lineHeight: 1.5, // FIX
          }}
        >
          {canInitBakp
            ? 'Klik tombol di bawah untuk memulai pengisian dokumen BAKP (fase 17 aktif).'
            : 'BAKP belum dibuat. Hubungi Surveyor, PM, atau Admin.'}
        </div>
        {canInitBakp && (
          <button
            type="button"
            disabled={initializing}
            onClick={() => void handleInitBakp()}
            style={{
              padding: '10px 24px', // FIX
              borderRadius: 10, // FIX
              border: 'none', // FIX
              background: initializing ? 'var(--color-background-secondary)' : 'linear-gradient(135deg, #00D4B4, #00B89E)', // FIX
              color: initializing ? 'var(--color-text-secondary)' : 'white', // FIX
              cursor: initializing ? 'not-allowed' : 'pointer', // FIX
              fontSize: 13, // FIX
              fontWeight: 700, // FIX
              boxShadow: initializing ? 'none' : '0 4px 14px #00D4B440', // FIX
            }}
          >
            {initializing ? '⏳ Menginisialisasi...' : '🚀 Mulai BAKP'}
          </button>
        )}
      </div>

    ); // FIX
  }

  const docs = (bakp.docBakpUrls as Record<string, string>) || {}; // FIX
  const mandatoryUploaded = BAKP_KOMPENSASI_DOCS.filter((d) => !!docs[d.key]).length;
  const optionalUploaded = BAKP_KOORDINASI_DOCS.filter((d) => !!docs[d.key]).length;
  const participants = bakp.participants || []; // FIX
  const canSubmit = isSurveyor && ['DRAFT', 'REJECTED_BY_PM', 'REJECTED_BY_ADMIN', 'REJECTED_BY_ISP'].includes(bakp.status); // FIX
  const canEdit = canSubmit; // FIX

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          padding: '12px 16px', // FIX
          borderRadius: 10, // FIX
          background:
            bakp.status === 'DONE'
              ? '#22C55E15'
              : ['REJECTED_BY_PM', 'REJECTED_BY_ADMIN', 'REJECTED_BY_ISP'].includes(bakp.status)
                ? '#EF444415'
                : bakp.status === 'SUBMITTED_TO_PM'
                  ? '#3B82F615'
                  : bakp.status === 'SUBMITTED_TO_ADMIN'
                    ? '#F59E0B15'
                    : '#F9FAFB', // FIX
          border: `0.5px solid ${
            bakp.status === 'DONE'
              ? '#22C55E40'
              : ['REJECTED_BY_PM', 'REJECTED_BY_ADMIN', 'REJECTED_BY_ISP'].includes(bakp.status)
                ? '#EF444440'
                : bakp.status === 'SUBMITTED_TO_PM'
                  ? '#3B82F640'
                  : bakp.status === 'SUBMITTED_TO_ADMIN'
                    ? '#F59E0B40'
                    : 'var(--color-border-tertiary)'
          }`, // FIX
          display: 'flex', // FIX
          gap: 12, // FIX
          alignItems: 'flex-start', // FIX
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {bakp.status === 'DRAFT' && '📝 Draft — Upload dokumen BAKP'}
            {bakp.status === 'SUBMITTED_TO_PM' && '⏳ Submitted — Menunggu review PM'}
            {bakp.status === 'SUBMITTED_TO_ADMIN' && '🔍 Menunggu review Admin'}
            {bakp.status === 'SUBMITTED_TO_ISP' && '📨 Menunggu keputusan ISP'}
            {bakp.status === 'REJECTED_BY_PM' && '↺ Ditolak PM — Revisi diperlukan'}
            {bakp.status === 'REJECTED_BY_ADMIN' && '↺ Ditolak Admin — Revisi diperlukan'}
            {bakp.status === 'REJECTED_BY_ISP' && '↺ Ditolak ISP — Revisi diperlukan'}
            {bakp.status === 'DONE' && '✅ DONE (ISP Approved)'}
          </div>
          {['REJECTED_BY_PM', 'REJECTED_BY_ADMIN', 'REJECTED_BY_ISP'].includes(bakp.status) && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 3 }}>
              {bakp.pmRejectionReason && (
                <span>
                  <strong>Alasan PM:</strong> {bakp.pmRejectionReason}
                </span>
              )}
              {bakp.adminRejectionReason && (
                <span style={{ display: 'block', marginTop: 2 }}>
                  <strong>Alasan Admin:</strong> {bakp.adminRejectionReason}
                </span>
              )}
              {bakp.ispRejectionReason && (
                <span style={{ display: 'block', marginTop: 2 }}>
                  <strong>Alasan ISP:</strong> {bakp.ispRejectionReason}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {(bakp.finalMergedPdfUrl || bakp.bundlePdfUrl) && (
        <a
          href={(bakp.finalMergedPdfUrl || bakp.bundlePdfUrl) as string}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px 14px',
            borderRadius: 10,
            background: '#22C55E15',
            color: '#16A34A',
            border: '0.5px solid #22C55E40',
            fontSize: 12,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          ⬇ Download BAKP Final (Merged PDF)
        </a>
      )}

      <div
        style={{
          padding: '12px 16px', // FIX
          background: 'var(--color-background-secondary)', // FIX
          borderRadius: 10, // FIX
          fontSize: 12, // FIX
          color: 'var(--color-text-secondary)', // FIX
          display: 'flex', // FIX
          gap: 20, // FIX
          flexWrap: 'wrap', // FIX
        }}
      >
        <span>
          📋 No: <strong>{bakp.documentNumber}</strong>
        </span>
        <span>
          📦 Mandatory: <strong>{mandatoryUploaded}/11</strong>
        </span>
        <span>
          🗂 Optional: <strong>{optionalUploaded}/6</strong>
        </span>
        <span>
          👥 Peserta SKOM: <strong>{participants.length}</strong>
        </span>
        <span>
          🔖 Stempel: <strong>{bakp.stempelUrl ? '✓ Ada' : '✗ Belum'}</strong>
        </span>
        <span>
          📜 Materai: <strong>{bakp.requiresMaterai ? 'Ya' : 'Tidak'}</strong>
        </span>
      </div>

      <div
        style={{
          background: 'var(--color-background-primary)', // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          borderRadius: 12, // FIX
          overflow: 'hidden', // FIX
        }}
      >
        <div
          style={{
            padding: '12px 16px', // FIX
            borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
            background: 'var(--color-background-secondary)', // FIX
            fontSize: 13, // FIX
            fontWeight: 600, // FIX
            color: 'var(--color-text-primary)', // FIX
          }}
        >
          👥 Peserta SKOM
        </div>
        <div style={{ padding: 16 }}>
          {participants.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>Belum ada peserta</div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {participants.map((p: any, i: number) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', // FIX
                    alignItems: 'center', // FIX
                    gap: 10, // FIX
                    padding: '7px 0', // FIX
                    borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
                    fontSize: 13, // FIX
                  }}
                >
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: 11, width: 20, textAlign: 'center' }}>
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {p.role}
                      {p.ktpNumber && ` · KTP: ${p.ktpNumber}`}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/participants/${p.id}/delete`, {}); // FIX
                          await loadBakp(); // FIX
                        } catch (err: unknown) {
                          const e = err as Error; // FIX
                          toast.error(e.message); // FIX
                        }
                      }}
                      style={{
                        width: 24, // FIX
                        height: 24, // FIX
                        borderRadius: '50%', // FIX
                        border: 'none', // FIX
                        background: '#EF444415', // FIX
                        color: '#EF4444', // FIX
                        cursor: 'pointer', // FIX
                        fontSize: 13, // FIX
                        fontWeight: 700, // FIX
                        display: 'flex', // FIX
                        alignItems: 'center', // FIX
                        justifyContent: 'center', // FIX
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'flex-end' }}>
              <div>
                <label
                  style={{
                    fontSize: 11, // FIX
                    fontWeight: 600, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    display: 'block', // FIX
                    marginBottom: 4, // FIX
                  }}
                >
                  Nama *
                </label>
                <input value={partName} style={inputStyle} onChange={(e) => setPartName(e.target.value)} placeholder="Nama peserta" />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 11, // FIX
                    fontWeight: 600, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    display: 'block', // FIX
                    marginBottom: 4, // FIX
                  }}
                >
                  Jabatan *
                </label>
                <input value={partRole} style={inputStyle} onChange={(e) => setPartRole(e.target.value)} placeholder="RT/RW/dll" />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 11, // FIX
                    fontWeight: 600, // FIX
                    color: 'var(--color-text-secondary)', // FIX
                    display: 'block', // FIX
                    marginBottom: 4, // FIX
                  }}
                >
                  No KTP
                </label>
                <input value={partKtp} style={inputStyle} onChange={(e) => setPartKtp(e.target.value)} placeholder="Opsional" />
              </div>
              <button
                type="button"
                onClick={() => void handleAddParticipant()}
                style={{
                  padding: '9px 16px', // FIX
                  borderRadius: 8, // FIX
                  border: 'none', // FIX
                  background: '#00D4B4', // FIX
                  color: 'white', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 13, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                + Tambah
              </button>
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 12, // FIX
            padding: 16, // FIX
            display: 'flex', // FIX
            alignItems: 'center', // FIX
            justifyContent: 'space-between', // FIX
            gap: 16, // FIX
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>🔖 Stempel</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              {bakp.stempelUrl ? '✅ Sudah upload' : 'Belum upload'}
            </div>
          </div>
          <label
            style={{
              padding: '8px 14px', // FIX
              borderRadius: 8, // FIX
              border: '0.5px solid var(--color-border-tertiary)', // FIX
              background: 'var(--color-background-secondary)', // FIX
              cursor: 'pointer', // FIX
              fontSize: 12, // FIX
              fontWeight: 600, // FIX
              color: 'var(--color-text-primary)', // FIX
            }}
          >
            {bakp.stempelUrl ? '🔄 Ganti Stempel' : '📷 Upload Stempel'}
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]; // FIX
                if (!file) return; // FIX
                setUploadingKey('stempel'); // FIX
                void (async () => {
                  try {
                    const url = await uploadFile(file, 'bakp', `${clusterId}/stempel`); // FIX
                    await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/stempel`, { stempelUrl: url }); // FIX
                    await loadBakp(); // FIX
                    toast.success('✅ Stempel diupload'); // FIX
                  } catch (err: unknown) {
                    const ex = err as Error; // FIX
                    toast.error(`Upload gagal: ${ex.message}`); // FIX
                  } finally {
                    setUploadingKey(null); // FIX
                  }
                })(); // FIX
                e.target.value = ''; // FIX
              }}
            />
          </label>
        </div>
      )}

      {canEdit && (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderRadius: 12, // FIX
            padding: 16, // FIX
            display: 'flex', // FIX
            alignItems: 'center', // FIX
            gap: 12, // FIX
          }}
        >
          <input
            type="checkbox"
            checked={!!bakp.requiresMaterai}
            onChange={(e) => {
              void (async () => {
                try {
                  await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/requires-materai`, {
                    requiresMaterai: e.target.checked, // FIX
                  }); // FIX
                  await loadBakp(); // FIX
                } catch {
                  toast.error('Gagal update materai'); // FIX
                }
              })(); // FIX
            }}
            style={{ width: 16, height: 16 }}
          />
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', cursor: 'pointer' }}>
            Dokumen memerlukan materai
          </label>
        </div>
      )}

      <div
        style={{
          background: 'var(--color-background-primary)', // FIX
          border: '0.5px solid var(--color-border-tertiary)', // FIX
          borderRadius: 12, // FIX
          overflow: 'hidden', // FIX
        }}
      >
        <div
          style={{
            padding: '12px 16px', // FIX
            borderBottom: '0.5px solid var(--color-border-tertiary)', // FIX
            background: 'var(--color-background-secondary)', // FIX
            fontSize: 13, // FIX
            fontWeight: 600, // FIX
            color: 'var(--color-text-primary)', // FIX
          }}
        >
          📂 Dokumen BAKP
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...BAKP_KOMPENSASI_DOCS, ...BAKP_KOORDINASI_DOCS].map((doc) => (
            <div
              key={doc.key}
              style={{
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                justifyContent: 'space-between', // FIX
                gap: 12, // FIX
                padding: '8px 12px', // FIX
                borderRadius: 8, // FIX
                background: docs[doc.key] ? '#22C55E08' : 'var(--color-background-secondary)', // FIX
                border: `0.5px solid ${docs[doc.key] ? '#22C55E30' : 'var(--color-border-tertiary)'}`, // FIX
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {doc.mandatory && <span style={{ color: '#EF4444', marginRight: 4 }}>*</span>}
                  {doc.label}
                </div>
                {docs[doc.key] && (
                  <div style={{ fontSize: 11, color: '#22C55E', marginTop: 2 }}>✅ Sudah diupload</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {docs[doc.key] && (
                  <a
                    href={docs[doc.key]}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '5px 10px', // FIX
                      borderRadius: 6, // FIX
                      background: '#3B82F615', // FIX
                      color: '#3B82F6', // FIX
                      textDecoration: 'none', // FIX
                      fontSize: 11, // FIX
                      fontWeight: 600, // FIX
                      border: '0.5px solid #3B82F640', // FIX
                    }}
                  >
                    👁 Lihat
                  </a>
                )}
                {canEdit && (
                  <label
                    style={{
                      padding: '5px 12px', // FIX
                      borderRadius: 6, // FIX
                      background:
                        uploadingKey === doc.key
                          ? 'var(--color-background-secondary)'
                          : docs[doc.key]
                            ? '#F59E0B15'
                            : '#00D4B415', // FIX
                      color:
                        uploadingKey === doc.key
                          ? 'var(--color-text-secondary)'
                          : docs[doc.key]
                            ? '#F59E0B'
                            : '#00D4B4', // FIX
                      cursor: uploadingKey === doc.key ? 'wait' : 'pointer', // FIX
                      fontSize: 11, // FIX
                      fontWeight: 600, // FIX
                      border: `0.5px solid ${docs[doc.key] ? '#F59E0B40' : '#00D4B440'}`, // FIX
                    }}
                  >
                    {uploadingKey === doc.key ? '⏳' : docs[doc.key] ? '🔄 Ganti' : '📤 Upload'}
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      disabled={!!uploadingKey}
                      onChange={(e) => {
                        const file = e.target.files?.[0]; // FIX
                        if (file) void handleUploadDoc(doc.key, file); // FIX
                        e.target.value = ''; // FIX
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {canSubmit && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSubmit()}
          style={{
            width: '100%', // FIX
            padding: '13px', // FIX
            borderRadius: 10, // FIX
            border: 'none', // FIX
            background: saving ? 'var(--color-background-secondary)' : 'linear-gradient(135deg, #00D4B4, #00B89E)', // FIX
            color: saving ? 'var(--color-text-secondary)' : 'white', // FIX
            cursor: saving ? 'not-allowed' : 'pointer', // FIX
            fontSize: 14, // FIX
            fontWeight: 700, // FIX
            boxShadow: saving ? 'none' : '0 4px 14px #00D4B440', // FIX
          }}
        >
          {saving ? '⏳ Submitting...' : '📤 Submit BAKP ke PM untuk Review'}
        </button>
      )}

      {isPM && bakp.status === 'SUBMITTED_TO_PM' && (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderLeft: '3px solid #3B82F6', // FIX
            borderRadius: 12, // FIX
            padding: 20, // FIX
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary)' }}>🔍 Review BAKP (PM)</div>
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Alasan penolakan..."
                style={{
                  ...inputStyle, // FIX
                  width: '100%', // FIX
                  boxSizing: 'border-box', // FIX
                  resize: 'vertical', // FIX
                  fontFamily: 'inherit', // FIX
                  borderColor: '#EF444440', // FIX
                }}
              />
            </div>
          )}
          {!showReject ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void (async () => {
                    setSaving(true); // FIX
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/pm-approve`, {}); // FIX
                      toast.success('✅ BAKP disetujui PM → Admin review'); // FIX
                      await loadBakp(); // FIX
                    } catch (err: unknown) {
                      const e = err as Error; // FIX
                      toast.error(e.message); // FIX
                    } finally {
                      setSaving(false); // FIX
                    }
                  })(); // FIX
                }}
                style={{
                  flex: 1, // FIX
                  padding: '11px', // FIX
                  borderRadius: 10, // FIX
                  border: 'none', // FIX
                  background: '#00D4B4', // FIX
                  color: 'white', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                ✅ Setujui
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                style={{
                  padding: '11px 20px', // FIX
                  borderRadius: 10, // FIX
                  border: '1px solid #EF444440', // FIX
                  background: '#EF444412', // FIX
                  color: '#EF4444', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                ❌ Tolak
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={!rejectReason.trim() || saving}
                onClick={() => {
                  void (async () => {
                    if (!rejectReason.trim()) return; // FIX
                    setSaving(true); // FIX
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/pm-reject`, { reason: rejectReason }); // FIX
                      toast.success('↺ BAKP dikembalikan ke Surveyor'); // FIX
                      setShowReject(false); // FIX
                      setRejectReason(''); // FIX
                      await loadBakp(); // FIX
                    } catch (err: unknown) {
                      const e = err as Error; // FIX
                      toast.error(e.message); // FIX
                    } finally {
                      setSaving(false); // FIX
                    }
                  })(); // FIX
                }}
                style={{
                  flex: 1, // FIX
                  padding: '11px', // FIX
                  borderRadius: 10, // FIX
                  border: 'none', // FIX
                  background: '#EF4444', // FIX
                  color: 'white', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false); // FIX
                  setRejectReason(''); // FIX
                }}
                style={{
                  padding: '11px 18px', // FIX
                  borderRadius: 10, // FIX
                  border: '0.5px solid var(--color-border-tertiary)', // FIX
                  background: 'none', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                }}
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && bakp.status === 'SUBMITTED_TO_ADMIN' && (
        <div
          style={{
            background: 'var(--color-background-primary)', // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            borderLeft: '3px solid #00D4B4', // FIX
            borderRadius: 12, // FIX
            padding: 20, // FIX
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary)' }}>
            🔍 Review Final BAKP (Admin)
          </div>
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Alasan penolakan..."
                style={{
                  ...inputStyle, // FIX
                  width: '100%', // FIX
                  boxSizing: 'border-box', // FIX
                  resize: 'vertical', // FIX
                  fontFamily: 'inherit', // FIX
                  borderColor: '#EF444440', // FIX
                }}
              />
            </div>
          )}
          {!showReject ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void (async () => {
                    setSaving(true); // FIX
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/admin-approve`, {}); // FIX
                      toast.success('✅ BAKP disetujui Admin → Dikirim ke ISP'); // FIX
                      await loadBakp(); // FIX
                    } catch (err: unknown) {
                      const e = err as Error; // FIX
                      toast.error(e.message); // FIX
                    } finally {
                      setSaving(false); // FIX
                    }
                  })(); // FIX
                }}
                style={{
                  flex: 1, // FIX
                  padding: '11px', // FIX
                  borderRadius: 10, // FIX
                  border: 'none', // FIX
                  background: '#00D4B4', // FIX
                  color: 'white', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                ✅ Setujui → Kirim ke ISP
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                style={{
                  padding: '11px 20px', // FIX
                  borderRadius: 10, // FIX
                  border: '1px solid #EF444440', // FIX
                  background: '#EF444412', // FIX
                  color: '#EF4444', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                ❌ Tolak
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={!rejectReason.trim() || saving}
                onClick={() => {
                  void (async () => {
                    if (!rejectReason.trim()) return; // FIX
                    setSaving(true); // FIX
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/admin-reject`, { reason: rejectReason }); // FIX
                      toast.success('↺ BAKP dikembalikan ke Surveyor (Admin)'); // FIX
                      setShowReject(false); // FIX
                      setRejectReason(''); // FIX
                      await loadBakp(); // FIX
                    } catch (err: unknown) {
                      const e = err as Error; // FIX
                      toast.error(e.message); // FIX
                    } finally {
                      setSaving(false); // FIX
                    }
                  })(); // FIX
                }}
                style={{
                  flex: 1, // FIX
                  padding: '11px', // FIX
                  borderRadius: 10, // FIX
                  border: 'none', // FIX
                  background: '#EF4444', // FIX
                  color: 'white', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  fontWeight: 600, // FIX
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false); // FIX
                  setRejectReason(''); // FIX
                }}
                style={{
                  padding: '11px 18px', // FIX
                  borderRadius: 10, // FIX
                  border: '0.5px solid var(--color-border-tertiary)', // FIX
                  background: 'none', // FIX
                  cursor: 'pointer', // FIX
                  fontSize: 14, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                }}
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && bakp.status === 'SUBMITTED_TO_ISP' && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderLeft: '3px solid #22C55E',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary)' }}>
            📨 Keputusan ISP (Admin)
          </div>
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Alasan ISP rejected..."
                style={{
                  ...inputStyle,
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  borderColor: '#EF444440',
                }}
              />
            </div>
          )}
          {!showReject ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void (async () => {
                    setSaving(true);
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/isp-accepted`, {});
                      toast.success('✅ ISP Accepted — BAKP DONE');
                      await loadBakp();
                    } catch (err: unknown) {
                      const e = err as Error;
                      toast.error(e.message);
                    } finally {
                      setSaving(false);
                    }
                  })();
                }}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#22C55E', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                ✅ ISP Accepted
              </button>
              <button
                type="button"
                onClick={() => setShowReject(true)}
                style={{ padding: '11px 20px', borderRadius: 10, border: '1px solid #EF444440', background: '#EF444412', color: '#EF4444', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                ❌ ISP Rejected
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={!rejectReason.trim() || saving}
                onClick={() => {
                  void (async () => {
                    if (!rejectReason.trim()) return;
                    setSaving(true);
                    try {
                      await apiPost(`/permit-clusters/${clusterId}/bakp/${bakp.id}/isp-rejected`, { reason: rejectReason });
                      toast.success('↺ ISP Rejected — kembali ke Surveyor untuk revisi');
                      setShowReject(false);
                      setRejectReason('');
                      await loadBakp();
                    } catch (err: unknown) {
                      const e = err as Error;
                      toast.error(e.message);
                    } finally {
                      setSaving(false);
                    }
                  })();
                }}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#EF4444', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                Konfirmasi ISP Rejected
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason('');
                }}
                style={{ padding: '11px 18px', borderRadius: 10, border: '0.5px solid var(--color-border-tertiary)', background: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-secondary)' }}
              >
                Batal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
