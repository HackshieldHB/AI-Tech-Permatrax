'use client'; // FIX: client
// FIX: Document detail page — ALL phases + email
import { useState, useEffect, useCallback } from 'react'; // FIX: hooks
import { useParams, useRouter } from 'next/navigation'; // FIX: routing
import { useAuthStore } from '../../../../store/authStore'; // FIX: auth
import { apiGet, apiPost, fixFileUrl } from '../../../../lib/api'; // FIX: API + URLs
import { toast } from 'sonner'; // FIX: toasts
import { isPmRole } from '../../../../lib/roles';

interface Doc {
  key: string; // FIX
  label: string; // FIX
  url: string | null; // FIX
  type: string; // FIX
  status: string; // FIX
  isArray?: boolean; // FIX
  urls?: string[]; // FIX
  approvals?: { admin?: string; pm?: string }; // FIX
}

interface Phase {
  phase: string; // FIX
  phaseNum: number; // FIX
  label: string; // FIX
  documents: Doc[]; // FIX
}

interface DetailPayload {
  cluster: {
    id: string; // FIX
    clusterCode: string; // FIX
    ispCustomer: string; // FIX
    fiberType: string; // FIX
    currentPhase: string; // FIX
    status: string; // FIX
    rwName: string | null; // FIX
    kelurahan: string | null; // FIX
    kecamatan: string | null; // FIX
    kotaKabupaten: string | null; // FIX
  };
  phases: Phase[]; // FIX
  summary: {
    totalDocs: number; // FIX
    available: number; // FIX
    pending: number; // FIX
    missing: number; // FIX
    approved: number; // FIX
    completionPercent: number; // FIX
  };
}

const STATUS_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  AVAILABLE: { bg: '#22C55E15', color: '#22C55E', label: '✅ Ada' }, // FIX
  PENDING: { bg: '#F59E0B15', color: '#F59E0B', label: '⏳ Pending' }, // FIX
  MISSING: { bg: '#EF444415', color: '#EF4444', label: '❌ Tidak Ada' }, // FIX
};

const APPROVAL_BADGE: Record<string, { bg: string; color: string }> = {
  APPROVED: { bg: '#22C55E15', color: '#22C55E' }, // FIX
  REJECTED: { bg: '#EF444415', color: '#EF4444' }, // FIX
  PENDING: { bg: '#F3F4F6', color: '#6B7280' }, // FIX
};

export default function DocumentDetailPage() {
  const { clusterId } = useParams<{ clusterId: string }>(); // FIX: id
  const router = useRouter(); // FIX
  const { user } = useAuthStore(); // FIX

  const [data, setData] = useState<DetailPayload | null>(null); // FIX: payload
  const [loading, setLoading] = useState(true); // FIX
  const [sending, setSending] = useState(false); // FIX
  const [showEmail, setShowEmail] = useState(false); // FIX
  const [emailMsg, setEmailMsg] = useState(''); // FIX
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set()); // FIX

  const isAdmin = user?.role === 'ADMIN'; // FIX
  const isPM = isPmRole(user?.role);
  const canSendEmail = isAdmin || isPM; // FIX

  const load = useCallback(async () => {
    if (!user || !clusterId) return; // FIX
    try {
      setLoading(true); // FIX
      const result = await apiGet<DetailPayload>(`/document-list/${clusterId}`); // FIX
      setData(result); // FIX
      if (result?.phases) {
        setExpandedPhases(new Set(result.phases.map((p) => p.phase))); // FIX: expand all
      }
    } catch {
      setData(null); // FIX
    } finally {
      setLoading(false); // FIX
    }
  }, [clusterId, user]); // FIX

  useEffect(() => {
    load(); // FIX
  }, [load]); // FIX

  const togglePhase = (phase: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev); // FIX
      if (next.has(phase)) next.delete(phase); // FIX
      else next.add(phase); // FIX
      return next; // FIX
    });
  };

  const handleSendEmail = async () => {
    if (!user || !clusterId) return; // FIX
    setSending(true); // FIX
    try {
      const result = await apiPost<{
        success?: boolean; // FIX
        message?: string; // FIX
      }>(`/document-list/${clusterId}/send-to-isp`, { message: emailMsg }); // FIX
      if (result?.success) {
        toast.success(result.message || 'Terkirim'); // FIX
        setShowEmail(false); // FIX
        setEmailMsg(''); // FIX
      } else {
        toast.error(result?.message || 'Gagal kirim email'); // FIX
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal kirim email'); // FIX
    } finally {
      setSending(false); // FIX
    }
  };

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Memuat sesi…</div>
    ); // FIX
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>⏳ Memuat dokumen…</div>
    ); // FIX
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Data tidak ditemukan</div>
    ); // FIX
  }

  const { cluster, phases, summary } = data; // FIX

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            display: 'inline-flex', // FIX
            alignItems: 'center', // FIX
            gap: 6, // FIX
            padding: '6px 12px', // FIX
            borderRadius: 8, // FIX
            border: '0.5px solid var(--color-border-tertiary)', // FIX
            background: 'none', // FIX
            cursor: 'pointer', // FIX
            fontSize: 12, // FIX
            color: 'var(--color-text-secondary)', // FIX
            marginBottom: 14, // FIX
          }}
        >
          ← Kembali
        </button>

        <div
          style={{
            display: 'flex', // FIX
            justifyContent: 'space-between', // FIX
            alignItems: 'flex-start', // FIX
            flexWrap: 'wrap', // FIX
            gap: 12, // FIX
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
              📁 {cluster.rwName || cluster.clusterCode}
            </h1>
            <div
              style={{
                fontSize: 12, // FIX
                color: 'var(--color-text-secondary)', // FIX
                marginTop: 4, // FIX
                display: 'flex', // FIX
                gap: 10, // FIX
                flexWrap: 'wrap', // FIX
              }}
            >
              <span>🏢 {cluster.ispCustomer}</span>
              <span>📡 {cluster.fiberType}</span>
              {cluster.kelurahan && (
                <span>
                  📍 {[cluster.kelurahan, cluster.kecamatan, cluster.kotaKabupaten].filter(Boolean).join(', ')}
                </span>
              )}
              <span>Phase: {cluster.currentPhase}</span>
            </div>
          </div>

          {canSendEmail && (
            <button
              type="button"
              onClick={() => setShowEmail(!showEmail)}
              style={{
                display: 'inline-flex', // FIX
                alignItems: 'center', // FIX
                gap: 7, // FIX
                padding: '9px 18px', // FIX
                borderRadius: 9, // FIX
                background: '#00D4B415', // FIX
                color: '#00D4B4', // FIX
                cursor: 'pointer', // FIX
                fontSize: 13, // FIX
                fontWeight: 600, // FIX
                border: '0.5px solid #00D4B440', // FIX
              }}
            >
              📧 Kirim ke ISP
            </button>
          )}
        </div>
      </div>

      {showEmail && (
        <div
          style={{
            marginBottom: 16, // FIX
            padding: 16, // FIX
            borderRadius: 12, // FIX
            background: '#00D4B408', // FIX
            border: '0.5px solid #00D4B430', // FIX
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--color-text-primary)' }}>
            📧 Kirim dokumen ke {cluster.ispCustomer}
          </div>
          <textarea
            value={emailMsg}
            onChange={(e) => setEmailMsg(e.target.value)}
            rows={3}
            placeholder="Pesan tambahan (opsional)..."
            style={{
              width: '100%', // FIX
              boxSizing: 'border-box', // FIX
              padding: '9px 12px', // FIX
              borderRadius: 8, // FIX
              fontSize: 13, // FIX
              border: '0.5px solid var(--color-border-tertiary)', // FIX
              background: 'var(--color-background-primary)', // FIX
              color: 'var(--color-text-primary)', // FIX
              resize: 'vertical', // FIX
              fontFamily: 'inherit', // FIX
              marginBottom: 10, // FIX
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={sending}
              onClick={handleSendEmail}
              style={{
                padding: '9px 20px', // FIX
                borderRadius: 8, // FIX
                border: 'none', // FIX
                background: sending ? '#E5E7EB' : '#00D4B4', // FIX
                color: sending ? '#9CA3AF' : 'white', // FIX
                cursor: sending ? 'not-allowed' : 'pointer', // FIX
                fontSize: 13, // FIX
                fontWeight: 600, // FIX
              }}
            >
              {sending ? '⏳ Mengirim...' : '📤 Kirim email'}
            </button>
            <button
              type="button"
              onClick={() => setShowEmail(false)}
              style={{
                padding: '9px 14px', // FIX
                borderRadius: 8, // FIX
                border: '0.5px solid var(--color-border-tertiary)', // FIX
                background: 'none', // FIX
                cursor: 'pointer', // FIX
                fontSize: 13, // FIX
                color: 'var(--color-text-secondary)', // FIX
              }}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid', // FIX
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', // FIX
          gap: 10, // FIX
          marginBottom: 20, // FIX
        }}
      >
        {[
          { label: 'Total dok', value: summary.totalDocs, color: '#374151' }, // FIX
          { label: 'Tersedia', value: summary.available, color: '#22C55E' }, // FIX
          { label: 'Pending', value: summary.pending, color: '#F59E0B' }, // FIX
          { label: 'Tidak ada', value: summary.missing, color: '#EF4444' }, // FIX
          { label: 'Completeness', value: `${summary.completionPercent}%`, color: '#00D4B4' }, // FIX
        ].map((card) => (
          <div
            key={card.label}
            style={{
              padding: '12px 14px', // FIX
              borderRadius: 10, // FIX
              background: 'var(--color-background-primary)', // FIX
              border: '0.5px solid var(--color-border-tertiary)', // FIX
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phases.map((phase) => (
          <div
            key={phase.phase}
            style={{
              background: 'var(--color-background-primary)', // FIX
              border: '0.5px solid var(--color-border-tertiary)', // FIX
              borderRadius: 12, // FIX
              overflow: 'hidden', // FIX
            }}
          >
            <button
              type="button"
              onClick={() => togglePhase(phase.phase)}
              style={{
                width: '100%', // FIX
                padding: '12px 16px', // FIX
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                gap: 10, // FIX
                background: 'var(--color-background-secondary)', // FIX
                border: 'none', // FIX
                cursor: 'pointer', // FIX
                textAlign: 'left', // FIX
                borderBottom: expandedPhases.has(phase.phase) ? '0.5px solid var(--color-border-tertiary)' : 'none', // FIX
              }}
            >
              <span
                style={{
                  width: 22, // FIX
                  height: 22, // FIX
                  borderRadius: '50%', // FIX
                  background: '#00D4B415', // FIX
                  border: '1px solid #00D4B440', // FIX
                  display: 'flex', // FIX
                  alignItems: 'center', // FIX
                  justifyContent: 'center', // FIX
                  fontSize: 10, // FIX
                  fontWeight: 700, // FIX
                  color: '#00D4B4', // FIX
                  flexShrink: 0, // FIX
                }}
              >
                {phase.phaseNum}
              </span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {phase.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginRight: 8 }}>
                {phase.documents.filter((d) => d.status === 'AVAILABLE').length}/{phase.documents.length} dokumen
              </span>
              <span
                style={{
                  fontSize: 12, // FIX
                  color: 'var(--color-text-secondary)', // FIX
                  transition: 'transform 200ms', // FIX
                  transform: expandedPhases.has(phase.phase) ? 'rotate(180deg)' : 'none', // FIX
                }}
              >
                ▾
              </span>
            </button>

            {expandedPhases.has(phase.phase) && (
              <div style={{ padding: '8px 0' }}>
                {phase.documents.map((doc, di) => (
                  <div
                    key={doc.key}
                    style={{
                      display: 'flex', // FIX
                      alignItems: 'center', // FIX
                      gap: 12, // FIX
                      padding: '10px 16px', // FIX
                      borderBottom: di < phase.documents.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none', // FIX
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>
                      {doc.type === 'image' ? '🖼️' : doc.type === 'pdf' ? '📄' : '📎'}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{doc.label}</div>
                      {doc.approvals && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                          {[
                            { who: 'Admin', status: doc.approvals.admin || 'PENDING' }, // FIX
                            { who: 'PM', status: doc.approvals.pm || 'PENDING' }, // FIX
                          ].map((ap) => {
                            const cfg = APPROVAL_BADGE[ap.status] || APPROVAL_BADGE.PENDING; // FIX
                            return (
                              <span
                                key={ap.who}
                                style={{
                                  padding: '1px 6px', // FIX
                                  borderRadius: 5, // FIX
                                  background: cfg.bg, // FIX
                                  color: cfg.color, // FIX
                                  fontSize: 9, // FIX
                                  fontWeight: 600, // FIX
                                }}
                              >
                                {ap.who}: {ap.status}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {(() => {
                      const s = STATUS_COLOR[doc.status] || STATUS_COLOR.MISSING; // FIX
                      return (
                        <span
                          style={{
                            padding: '3px 8px', // FIX
                            borderRadius: 7, // FIX
                            background: s.bg, // FIX
                            color: s.color, // FIX
                            fontSize: 10, // FIX
                            fontWeight: 600, // FIX
                            flexShrink: 0, // FIX
                          }}
                        >
                          {s.label}
                        </span>
                      );
                    })()}

                    {doc.url && (
                      <a
                        href={fixFileUrl(doc.url)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', // FIX
                          alignItems: 'center', // FIX
                          gap: 5, // FIX
                          padding: '5px 10px', // FIX
                          borderRadius: 7, // FIX
                          background: '#3B82F615', // FIX
                          color: '#3B82F6', // FIX
                          textDecoration: 'none', // FIX
                          fontSize: 11, // FIX
                          fontWeight: 600, // FIX
                          flexShrink: 0, // FIX
                          border: '0.5px solid #3B82F640', // FIX
                        }}
                      >
                        ⬇ Unduh
                      </a>
                    )}

                    {doc.isArray && doc.urls && doc.urls.length > 1 && (
                      <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                        +{doc.urls.length - 1} lagi
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
