'use client';
// FIX: Claim Submission Phase 18 — per-document upload + Admin / PM approval
import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, uploadFile, fixFileUrl } from '../../../../lib/api';
import { toast } from 'sonner';
import { isPmRole, isSurveyorRole } from '../../../../lib/roles';

const STREAM_A_DOCS = [
  { key: 'docMom', label: 'MOM (Minutes of Meeting)', required: true },
  { key: 'docBaOpen', label: 'BA Open', required: true },
  { key: 'docBaAcara', label: 'BA Acara', required: true },
  { key: 'docBaTtdRt', label: 'BA TTD RT', required: true },
  { key: 'docFcBukuTabungan', label: 'FC Buku Tabungan', required: true },
  { key: 'docSip', label: 'SIP', required: true },
  { key: 'docKtpRtRw', label: 'KTP RT/RW', required: true },
  { key: 'docPks', label: 'PKS', required: true },
  { key: 'docKwitansi', label: 'Kwitansi', required: true },
  { key: 'docEvidancePayment', label: 'Evidence Payment', required: true },
  { key: 'docBuktiTrf', label: 'Bukti Transfer Payment Kompensasi', required: true },
  { key: 'docSkInternal', label: 'SK Internal ILT', required: true },
  { key: 'docPoSpk', label: 'PO/SPK', required: true },
];

const STREAM_B_DOCS = [
  { key: 'docBaOpenLengkap', label: 'BA Open Lengkap (3 Pihak: ILT, Akses, Government)', required: true },
  { key: 'docKwitansiGov', label: 'Kwitansi', required: true },
  { key: 'docFotoEvidance', label: 'Foto Evidence', required: true },
  { key: 'docEvidancePaymentGov', label: 'Evidence Payment', required: true },
  { key: 'docSkInternalGov', label: 'SK Internal ILT', required: true },
  { key: 'docPoSpkGov', label: 'PO/SPK', required: true },
];

interface Props {
  clusterId: string;
  userRole: string;
}

export default function ClaimSubmissionPhasePanel({ clusterId, userRole }: Props) {
  const [claim, setClaim] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [rejectKey, setRejectKey] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [activeStream, setActiveStream] = useState<'A' | 'B'>('A');

  const isSurveyor = isSurveyorRole(userRole);
  const isPM = isPmRole(userRole);
  const isAdmin = userRole === 'ADMIN';

  const loadClaim = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<any>(`/permit-clusters/${clusterId}/claim-package`);
      setClaim(data);
    } catch {
      setClaim(null);
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  const getApproval = (docKey: string) => {
    const approvals = (claim?.docApprovals as Record<string, any>) || {};
    return approvals[docKey] || { adminStatus: 'PENDING', pmStatus: 'PENDING' };
  };

  const handleUpload = async (docKey: string, file: File, stream: 'A' | 'B') => {
    if (!claim?.id) return;
    const approval = getApproval(docKey);
    const isRejected = approval.adminStatus === 'REJECTED' || approval.pmStatus === 'REJECTED';
    setUploadingKey(docKey);
    try {
      const url = await uploadFile(file, 'claim', clusterId);
      if (isRejected) {
        await apiPost(`/permit-clusters/${clusterId}/claim-package/${claim.id}/reupload-doc`, {
          docKey,
          fileUrl: url,
          stream,
        });
      } else if (stream === 'A') {
        await apiPost(`/permit-clusters/${clusterId}/claim-package/stream-a`, { docKey, fileUrl: url });
      } else {
        await apiPost(`/permit-clusters/${clusterId}/claim-package/stream-b`, { docKey, fileUrl: url });
      }
      await loadClaim();
      toast.success(`✅ ${docKey} berhasil diupload`);
    } catch (err: unknown) {
      const e = err as Error;
      toast.error(`Upload gagal: ${e.message}`);
    } finally {
      setUploadingKey(null);
    }
  };

  const getApprovalBadge = (status: string) => {
    if (status === 'APPROVED') return { bg: '#22C55E15', color: '#22C55E', label: '✅ Approved' };
    if (status === 'REJECTED') return { bg: '#EF444415', color: '#EF4444', label: '❌ Rejected' };
    return { bg: '#F3F4F6', color: '#6B7280', label: '⏳ Pending' };
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
        ⏳ Memuat data klaim...
      </div>
    );
  }

  if (!claim) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
        Klaim belum diinisialisasi.
      </div>
    );
  }

  const currentDocs = activeStream === 'A' ? STREAM_A_DOCS : STREAM_B_DOCS;

  const canUploadDoc = (stream: 'A' | 'B') => {
    if (stream === 'A') return isSurveyor || isPM;
    return isAdmin;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          background: claim.status === 'APPROVED' ? '#22C55E15' : '#F9FAFB',
          border: `0.5px solid ${claim.status === 'APPROVED' ? '#22C55E40' : 'var(--color-border-tertiary)'}`,
          fontSize: 13,
          fontWeight: 600,
          color: claim.status === 'APPROVED' ? '#22C55E' : 'var(--color-text-primary)',
        }}
      >
        {claim.status === 'DRAFT' && '📝 Draft — Upload dokumen klaim'}
        {claim.status === 'COMPILING' && '📋 Sedang dikompilasi'}
        {claim.status === 'SUBMITTED_FOR_REVIEW' && '⏳ Menunggu review'}
        {claim.status === 'REVISION_REQUIRED' && '↺ Ada dokumen yang perlu direvisi'}
        {claim.status === 'APPROVED' && '✅ Semua dokumen disetujui — Lanjut ke Invoice'}
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 8 }}>
          No: {claim.documentNumber}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--color-background-secondary)',
          padding: 4,
          borderRadius: 10,
        }}
      >
        {(
          [
            { key: 'A' as const, label: '📁 Dokumen Kompensasi', count: STREAM_A_DOCS.length },
            { key: 'B' as const, label: '🏛️ Dokumen Koordinasi', count: STREAM_B_DOCS.length },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveStream(tab.key)}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 7,
              border: 'none',
              cursor: 'pointer',
              background: activeStream === tab.key ? 'white' : 'transparent',
              color: activeStream === tab.key ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: activeStream === tab.key ? 700 : 400,
              fontSize: 12,
              boxShadow: activeStream === tab.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {tab.label}
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 8,
                background: activeStream === tab.key ? '#00D4B415' : 'var(--color-background-primary)',
                color: activeStream === tab.key ? '#00D4B4' : 'var(--color-text-secondary)',
              }}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--color-background-secondary)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            display: 'grid',
            gridTemplateColumns: '1fr 90px 90px 120px',
            gap: 8,
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <span>Dokumen</span>
          <span style={{ textAlign: 'center' }}>Admin</span>
          <span style={{ textAlign: 'center' }}>PM</span>
          <span style={{ textAlign: 'center' }}>Aksi</span>
        </div>

        {currentDocs.map((doc) => {
          const approval = getApproval(doc.key);
          const uploaded = !!(claim as any)[doc.key];
          const adminBadge = getApprovalBadge(approval.adminStatus);
          const pmBadge = getApprovalBadge(approval.pmStatus);
          const isRejected = approval.adminStatus === 'REJECTED' || approval.pmStatus === 'REJECTED';
          const stream = activeStream;
          const bothPending = approval.adminStatus === 'PENDING' && approval.pmStatus === 'PENDING';
          const canUp =
            canUploadDoc(stream) && (!uploaded || isRejected || bothPending);

          return (
            <div
              key={doc.key}
              style={{
                padding: '10px 16px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                display: 'grid',
                gridTemplateColumns: '1fr 90px 90px 120px',
                gap: 8,
                alignItems: 'center',
                background: isRejected ? '#EF444406' : 'transparent',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {doc.required && <span style={{ color: '#EF4444', marginRight: 4 }}>*</span>}
                  {doc.label}
                </div>
                {uploaded && (
                  <a
                    href={fixFileUrl((claim as any)[doc.key])}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 10, color: '#3B82F6', textDecoration: 'none' }}
                  >
                    📎 Lihat dokumen
                  </a>
                )}
                {approval.adminStatus === 'REJECTED' && approval.adminNotes && (
                  <div style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }}>Admin: {String(approval.adminNotes)}</div>
                )}
                {approval.pmStatus === 'REJECTED' && approval.pmNotes && (
                  <div style={{ fontSize: 10, color: '#EF4444', marginTop: 2 }}>PM: {String(approval.pmNotes)}</div>
                )}
              </div>

              <div style={{ textAlign: 'center' }}>
                <span
                  style={{
                    padding: '3px 6px',
                    borderRadius: 6,
                    background: adminBadge.bg,
                    color: adminBadge.color,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {adminBadge.label}
                </span>
              </div>

              <div style={{ textAlign: 'center' }}>
                <span
                  style={{
                    padding: '3px 6px',
                    borderRadius: 6,
                    background: pmBadge.bg,
                    color: pmBadge.color,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {pmBadge.label}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                {canUp && (
                  <label
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      background: isRejected ? '#EF444415' : '#00D4B415',
                      color: isRejected ? '#EF4444' : '#00D4B4',
                      cursor: uploadingKey === doc.key ? 'wait' : 'pointer',
                      fontSize: 10,
                      fontWeight: 600,
                      border: `0.5px solid ${isRejected ? '#EF444440' : '#00D4B440'}`,
                    }}
                  >
                    {uploadingKey === doc.key ? '⏳' : isRejected ? '🔄 Revisi' : uploaded ? '🔄' : '📤'}
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      disabled={!!uploadingKey}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleUpload(doc.key, file, stream);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}

                {isAdmin && uploaded && approval.adminStatus !== 'APPROVED' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          setSaving(doc.key + '-admin-approve');
                          try {
                            await apiPost(`/permit-clusters/${clusterId}/claim-package/${claim.id}/admin-approve-doc`, {
                              docKey: doc.key,
                            });
                            await loadClaim();
                            toast.success(`✅ ${doc.label} approved`);
                          } catch (err: unknown) {
                            const e = err as Error;
                            toast.error(e.message);
                          } finally {
                            setSaving(null);
                          }
                        })();
                      }}
                      disabled={saving === doc.key + '-admin-approve'}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#22C55E15',
                        color: '#22C55E',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectKey(`${doc.key}-admin`);
                        setRejectNotes('');
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#EF444415',
                        color: '#EF4444',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}

                {isPM && uploaded && approval.adminStatus === 'APPROVED' && approval.pmStatus !== 'APPROVED' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          setSaving(doc.key + '-pm-approve');
                          try {
                            await apiPost(`/permit-clusters/${clusterId}/claim-package/${claim.id}/pm-approve-doc`, {
                              docKey: doc.key,
                            });
                            await loadClaim();
                            toast.success(`✅ ${doc.label} PM approved`);
                          } catch (err: unknown) {
                            const e = err as Error;
                            toast.error(e.message);
                          } finally {
                            setSaving(null);
                          }
                        })();
                      }}
                      disabled={saving === doc.key + '-pm-approve'}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#22C55E15',
                        color: '#22C55E',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectKey(`${doc.key}-pm`);
                        setRejectNotes('');
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: '#EF444415',
                        color: '#EF4444',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rejectKey && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setRejectKey(null)}
          onKeyDown={(e) => e.key === 'Escape' && setRejectKey(null)}
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
            style={{
              background: 'var(--color-background-primary)',
              borderRadius: 14,
              padding: 24,
              width: 380,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--color-text-primary)' }}>
              Alasan Penolakan
            </div>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              rows={3}
              placeholder="Tulis alasan penolakan dokumen..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 13,
                border: '1.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
                fontFamily: 'inherit',
                marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={!rejectNotes.trim() || !!saving}
                onClick={() => {
                  void (async () => {
                    if (!rejectNotes.trim() || !rejectKey) return;
                    const lastDash = rejectKey.lastIndexOf('-');
                    const dk = rejectKey.substring(0, lastDash);
                    const at = rejectKey.substring(lastDash + 1);
                    setSaving(rejectKey);
                    try {
                      if (at === 'admin') {
                        await apiPost(`/permit-clusters/${clusterId}/claim-package/${claim.id}/admin-reject-doc`, {
                          docKey: dk,
                          notes: rejectNotes,
                        });
                      } else {
                        await apiPost(`/permit-clusters/${clusterId}/claim-package/${claim.id}/pm-reject-doc`, {
                          docKey: dk,
                          notes: rejectNotes,
                        });
                      }
                      setRejectKey(null);
                      setRejectNotes('');
                      await loadClaim();
                      toast.success('↺ Dokumen dikembalikan untuk revisi');
                    } catch (err: unknown) {
                      const e = err as Error;
                      toast.error(e.message);
                    } finally {
                      setSaving(null);
                    }
                  })();
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#EF4444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => setRejectKey(null)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                }}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
