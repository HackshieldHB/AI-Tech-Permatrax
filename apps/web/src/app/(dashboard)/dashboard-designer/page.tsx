'use client'; // FIX: designer dashboard backed by /dashboard/designer

import { useState, useEffect } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { apiGet } from '../../../lib/api'; // FIX
import { ArrowRight, Clock, AlertTriangle } from 'lucide-react'; // FIX

const HLD_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  BELUM_UPLOAD: { label: 'Belum Diupload', color: '#9CA3AF', bg: '#9CA3AF15' }, // FIX
  DRAFT: { label: 'Draft', color: '#F59E0B', bg: '#F59E0B15' }, // FIX
  SUBMITTED_FOR_REVIEW: { label: 'Review PM', color: '#3B82F6', bg: '#3B82F615' }, // FIX
  PM_APPROVED: { label: 'Review Admin', color: '#8B5CF6', bg: '#8B5CF615' }, // FIX
  PENDING_ISP: { label: 'Menunggu ISP', color: '#F59E0B', bg: '#F59E0B15' }, // FIX
  ISP_REVISION: { label: 'Revisi ISP', color: '#EF4444', bg: '#EF444415' }, // FIX
  ISP_APPROVED: { label: 'Disetujui ISP', color: '#22C55E', bg: '#22C55E15' }, // FIX
  PM_REJECTED: { label: 'Revisi PM', color: '#EF4444', bg: '#EF444415' }, // FIX: legacy rows
  ADMIN_REJECTED: { label: 'Revisi Admin', color: '#EF4444', bg: '#EF444415' }, // FIX
};

export default function DesignerDashboard() {
  const { user } = useAuthStore(); // FIX
  const router = useRouter(); // FIX
  const [data, setData] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiGet<any>('/dashboard/designer', undefined, { silentForbidden: true }); // FIX: no access toast
        setData(res); // FIX
      } catch {
        try {
          const page = await apiGet<any>('/permit-clusters', { limit: 50, page: 1 }, { silentForbidden: true }); // FIX
          const items = page?.data ?? page?.items ?? []; // FIX
          setData({
            queue: {
              hld: items
                .filter((c: any) => c.currentPhase === 'HLD_SUBMISSION') // FIX
                .map((c: any) => ({
                  id: c.id,
                  clusterCode: c.clusterCode,
                  fiberType: c.fiberType,
                  phase: 'HLD',
                  hldStatus: c.hld?.status ?? 'BELUM_UPLOAD',
                  slaDeadline: c.hld?.slaDeadline,
                  ispFeedback: c.hld?.ispFeedback,
                })),
              lld: items
                .filter((c: any) => c.currentPhase === 'LLD_SUBMISSION') // FIX
                .map((c: any) => ({
                  id: c.id,
                  clusterCode: c.clusterCode,
                  fiberType: c.fiberType,
                  phase: 'LLD',
                  lldStatus: c.lld?.status ?? 'BELUM_UPLOAD',
                  ispFeedback: c.lld?.ispFeedback,
                })),
              totalPending: items.filter(
                (c: any) => c.currentPhase === 'HLD_SUBMISSION' || c.currentPhase === 'LLD_SUBMISSION',
              ).length,
            },
            inReview: { hld: 0, lld: 0 },
            completed: { hld: 0, lld: 0 },
          }); // FIX
        } catch {
          /* silent */ // FIX
        }
      } finally {
        setLoading(false); // FIX
      }
    };
    load(); // FIX
    const interval = setInterval(load, 60000); // FIX
    return () => clearInterval(interval); // FIX
  }, []);

  const queue = data?.queue ?? { hld: [], lld: [], totalPending: 0 }; // FIX
  const inReview = data?.inReview ?? { hld: 0, lld: 0 }; // FIX
  const completed = data?.completed ?? { hld: 0, lld: 0 }; // FIX
  const allQueue = [...(queue.hld ?? []), ...(queue.lld ?? [])]; // FIX

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }); // FIX

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
          Dashboard Design Team {/* FIX */}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          {today} · Selamat datang, {user?.name} {/* FIX */}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 28,
        }}
      >
        {[
          {
            label: 'Antrian HLD',
            value: queue.hld?.length ?? 0,
            sub: 'perlu diupload',
            icon: '📐',
            color: '#F59E0B',
            bg: '#F59E0B15',
          },
          {
            label: 'Antrian LLD',
            value: queue.lld?.length ?? 0,
            sub: 'perlu diupload',
            icon: '📋',
            color: '#8B5CF6',
            bg: '#8B5CF615',
          },
          {
            label: 'Sedang Review',
            value: (inReview.hld ?? 0) + (inReview.lld ?? 0),
            sub: 'PM / Admin reviewing',
            icon: '⏳',
            color: '#3B82F6',
            bg: '#3B82F615',
          },
          {
            label: 'Selesai',
            value: (completed.hld ?? 0) + (completed.lld ?? 0),
            sub: 'ISP approved',
            icon: '✅',
            color: '#22C55E',
            bg: '#22C55E15',
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              padding: '18px 20px',
              borderRadius: 14,
              background: card.bg,
              border: `0.5px solid ${card.color}30`,
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginTop: 4,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            background: 'var(--color-background-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>📋</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Antrian Pekerjaan {/* FIX */}
            </span>
            {allQueue.length > 0 ? (
              <span
                style={{
                  padding: '2px 10px',
                  borderRadius: 10,
                  background: '#EF444415',
                  color: '#EF4444',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {allQueue.length} cluster {/* FIX */}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => router.push('/permit-clusters')}
            style={{
              fontSize: 12,
              color: 'var(--color-text-info)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Lihat semua pipeline → {/* FIX */}
          </button>
        </div>

        {loading ? (
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--color-text-secondary)',
              fontSize: 13,
            }}
          >
            ⏳ Memuat antrian... {/* FIX */}
          </div>
        ) : allQueue.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginBottom: 4,
              }}
            >
              Tidak ada pekerjaan tertunda {/* FIX */}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              Semua HLD dan LLD sudah diproses {/* FIX */}
            </div>
          </div>
        ) : (
          <div>
            {allQueue.map((item: any) => {
              const isHld = item.phase === 'HLD'; // FIX
              const status = isHld ? item.hldStatus : item.lldStatus; // FIX
              const statusInfo = HLD_STATUS_LABELS[status] ?? HLD_STATUS_LABELS.BELUM_UPLOAD; // FIX
              const isRevision = status === 'ISP_REVISION'; // FIX
              const path = isHld ? `/permit-clusters/${item.id}/hld` : `/permit-clusters/${item.id}/lld`; // FIX

              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(path)}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 20px',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    cursor: 'pointer',
                    transition: 'background 150ms',
                    background: isRevision ? '#EF444408' : 'transparent',
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: isHld ? '#F59E0B15' : '#8B5CF615',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    {isHld ? '📐' : '📋'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {item.clusterCode}
                      </span>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          background: isHld ? '#F59E0B15' : '#8B5CF615',
                          color: isHld ? '#F59E0B' : '#8B5CF6',
                        }}
                      >
                        {isHld ? 'HLD' : 'LLD'}
                      </span>
                      {item.fiberType ? (
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            background: 'var(--color-background-secondary)',
                            color: 'var(--color-text-secondary)',
                          }}
                        >
                          {item.fiberType}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      {item.siteName ?? item.clusterCode}
                      {isRevision && item.ispFeedback ? (
                        <span style={{ color: '#EF4444', marginLeft: 6 }}>
                          · Revisi: {item.ispFeedback.substring(0, 60)}
                          {item.ispFeedback.length > 60 ? '...' : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        background: statusInfo.bg,
                        color: statusInfo.color,
                      }}
                    >
                      {isRevision ? (
                        <AlertTriangle
                          style={{ width: 10, height: 10, marginRight: 3, verticalAlign: 'middle' }}
                        />
                      ) : null}
                      {statusInfo.label}
                    </span>
                    {item.daysLeft != null ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 500,
                          color: item.slaBreached ? '#EF4444' : item.daysLeft <= 2 ? '#F59E0B' : '#6B7280',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Clock style={{ width: 10, height: 10 }} />
                        {item.slaBreached
                          ? `SLA lewat ${Math.abs(item.daysLeft)} hari` // FIX: days not hours
                          : `${item.daysLeft} hari tersisa`}
                      </span>
                    ) : null}
                  </div>

                  <ArrowRight
                    style={{ width: 16, height: 16, color: 'var(--color-text-secondary)', flexShrink: 0 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
