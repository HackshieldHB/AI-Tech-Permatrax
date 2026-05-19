'use client';

// FIX Fix 2A: complete modern rewrite — cluster-centric summary, human-readable labels, no raw IDs/enums
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { apiGet } from '../../../lib/api';

// FIX Fix 2A: phase label lookup — mirrors backend PHASE_LABELS so UI never shows underscored enums
const PHASE_LABELS: Record<string, string> = {
  CLUSTER_INTAKE:      'Intake Cluster',
  VISIT_REQUEST:       'Visit Request',
  BA_OPEN:             'BA Open',
  SITE_VISIT:          'Kunjungan Lapangan',
  SURVEY_INPUT:        'Input Data Survey',
  ROUTE_SURVEY:        'Route Survey',
  BA_SURVEY:           'BA Survey',
  SIP_REQUEST:         'Pengajuan SIP',
  HLD_SUBMISSION:      'Upload HLD',
  LLD_SUBMISSION:      'Upload LLD',
  PR_BR_ISSUANCE:      'PR/BR dari ISP',
  CONTRACT_MANAGEMENT: 'Manajemen Kontrak',
  SKOM_BUDGET:         'Budget SKOM',
  MANAGEMENT_APPROVAL: 'Approval Management',
  FUND_DISBURSEMENT:   'Pencairan Dana',
  BAK_GENERATION:      'Pembuatan BAK',
  BAKP_COMPILATION:    'Kompilasi BAKP',
  CLAIM_SUBMISSION:    'Pengajuan Klaim',
  INVOICE_PACKAGE:     'Invoice ke Finance',
  PERMIT_DONE:         'Permit Selesai',
};

// FIX Fix 2A: phase color map for visual hierarchy (grouped by stage family)
const PHASE_COLORS: Record<string, string> = {
  CLUSTER_INTAKE: '#6B7280',  VISIT_REQUEST: '#3B82F6',
  BA_OPEN: '#3B82F6',         SITE_VISIT: '#3B82F6',
  SURVEY_INPUT: '#3B82F6',    ROUTE_SURVEY: '#3B82F6',
  BA_SURVEY: '#3B82F6',       SIP_REQUEST: '#3B82F6',
  HLD_SUBMISSION: '#8B5CF6',  LLD_SUBMISSION: '#8B5CF6',
  PR_BR_ISSUANCE: '#F59E0B',  CONTRACT_MANAGEMENT: '#F59E0B',
  SKOM_BUDGET: '#F59E0B',     MANAGEMENT_APPROVAL: '#F59E0B',
  FUND_DISBURSEMENT: '#F59E0B', BAK_GENERATION: '#EC4899',
  BAKP_COMPILATION: '#EC4899', CLAIM_SUBMISSION: '#EC4899',
  INVOICE_PACKAGE: '#22C55E',  PERMIT_DONE: '#00D4B4',
};

// FIX Fix 2A: relative-time in Indonesian ("2 menit lalu", "3 jam lalu", etc.)
function timeAgo(dateStr?: string | Date | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Baru saja';
  if (mins < 60)  return `${mins} menit lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  if (days < 7)   return `${days} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// FIX Fix 2A: dashboard response shape returned by GET /dashboard/gm
type GmStats = {
  summary: {
    totalClusters: number;
    activeClusters: number;
    completedThisMonth: number;
    completedThisYear: number;
    totalUsers: number;
    activeUsers: number;
    pendingVisitRequests: number;
    pendingCashOperations: number;
    slaBreached: number;
  };
  pipeline: {
    byPhase: { phase: string; label: string; count: number }[];
    byFiberType: { fiberType: string; count: number }[];
  };
  recentActivity: Array<{
    id: string;
    clusterCode: string;
    clusterName: string;
    fiberType: string;
    currentPhase: string;
    currentPhaseLabel: string;
    status: string;
    surveyorName: string;
    surveyorRole: string;
    updatedAt: string;
    description: string;
    actor: string;
  }>;
};

export default function GmDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<GmStats | null>(null); // FIX Fix 2A: single source of truth for the whole dashboard
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<GmStats>('/dashboard/gm'); // FIX Fix 2A: hit the new lean GM endpoint
      setStats(data);
    } catch (err) {
      console.error('Dashboard load error:', err); // FIX Fix 2A: non-blocking log so UI still renders fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(); }, 120000); // FIX Fix 2A: auto-refresh every 2 minutes
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 400, color: 'var(--color-text-secondary)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Memuat data dashboard...</div>
        </div>
      </div>
    );
  }

  const s        = stats?.summary ?? ({} as GmStats['summary']);
  const pipeline = stats?.pipeline ?? { byPhase: [], byFiberType: [] };
  const activity = stats?.recentActivity ?? [];
  const byPhase  = pipeline.byPhase ?? [];
  const byFiber  = pipeline.byFiberType ?? [];
  const maxPhaseCount = Math.max(...byPhase.map((p) => p.count), 1); // FIX Fix 2A: normalize bar widths against the busiest phase

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const fiberColors: Record<string, string> = {
    FTTH: '#00D4B4', FTTB: '#3B82F6', FTTT: '#8B5CF6',
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* ── HEADER ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', marginBottom: 28,
          flexWrap: 'wrap', gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
            Selamat datang, {user?.name?.split(' ')[0] || 'User'} 👋
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            {today} · General Manager Dashboard
          </p>
        </div>
        <button
          onClick={() => void load()} // FIX Fix 2A: manual refresh — no full page reload
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8,
            border: '0.5px solid var(--color-border-tertiary)',
            background: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--color-text-secondary)',
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* ── KPI CARDS ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16, marginBottom: 28,
        }}
      >
        {[
          {
            label: 'Total Cluster',
            value: s.totalClusters || 0,
            sub: `${s.activeClusters || 0} aktif`,
            icon: '🏘️', color: '#3B82F6', bg: '#3B82F615',
            onClick: () => router.push('/permit-clusters'),
          },
          {
            label: 'Selesai Bulan Ini',
            value: s.completedThisMonth || 0,
            sub: `${s.completedThisYear || 0} tahun ini`,
            icon: '✅', color: '#22C55E', bg: '#22C55E15',
            onClick: () => router.push('/permit-clusters?status=COMPLETED'),
          },
          {
            label: 'Menunggu Review',
            value: s.pendingVisitRequests || 0,
            sub: 'visit request pending',
            icon: '📋', color: '#F59E0B', bg: '#F59E0B15',
            onClick: () => router.push('/visit-requests'),
          },
          {
            label: 'Cash Operation',
            value: s.pendingCashOperations || 0,
            sub: 'menunggu approval',
            icon: '💰', color: '#8B5CF6', bg: '#8B5CF615',
            onClick: () => router.push('/cash-operation'),
          },
          {
            label: 'SLA Terlewat',
            value: s.slaBreached || 0,
            sub: 'HLD melewati deadline',
            icon: '⚠️',
            color: (s.slaBreached ?? 0) > 0 ? '#EF4444' : '#22C55E',
            bg:    (s.slaBreached ?? 0) > 0 ? '#EF444415' : '#22C55E15',
            onClick: () => router.push('/permit-clusters'),
          },
          {
            label: 'User Aktif',
            value: s.activeUsers || 0,
            sub: `dari ${s.totalUsers || 0} total user`,
            icon: '👥', color: '#00D4B4', bg: '#00D4B415',
            onClick: () => router.push('/settings'),
          },
        ].map((card) => (
          <div
            key={card.label}
            onClick={card.onClick}
            style={{
              padding: '20px 22px', borderRadius: 14,
              background: card.bg,
              border: `0.5px solid ${card.color}30`,
              cursor: 'pointer', transition: 'transform 150ms',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'none';
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{card.icon}</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: card.color, lineHeight: 1 }}>
              {(card.value ?? 0).toLocaleString('id-ID')}
            </div>
            <div
              style={{
                fontSize: 14, fontWeight: 600,
                color: 'var(--color-text-primary)', marginTop: 6,
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── TWO-COLUMN CONTENT ───────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Pipeline by Phase */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14, overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Pipeline Perizinan
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  Distribusi cluster per fase aktif
                </div>
              </div>
              <button
                onClick={() => router.push('/permit-clusters')}
                style={{
                  fontSize: 12, color: 'var(--color-text-info)',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}
              >
                Lihat semua →
              </button>
            </div>

            <div style={{ padding: '16px 20px' }}>
              {byPhase.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center', padding: '24px 0',
                    color: 'var(--color-text-secondary)', fontSize: 13,
                  }}
                >
                  Tidak ada cluster aktif
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {byPhase.map((p) => {
                    const pct = Math.round((p.count / maxPhaseCount) * 100);
                    const color = PHASE_COLORS[p.phase] || '#6B7280';
                    return (
                      <div key={p.phase}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                          <span
                            style={{
                              fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500,
                            }}
                          >
                            {/* FIX Fix 2A: always use human label — never underscored enum */}
                            {p.label || PHASE_LABELS[p.phase] || p.phase.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color }}>
                            {p.count}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 8, borderRadius: 4,
                            background: 'var(--color-background-secondary)', overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%', width: `${pct}%`,
                              background: color, borderRadius: 4,
                              transition: 'width 600ms ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent Activity */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14, overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                fontSize: 15, fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            >
              Aktivitas Terbaru
            </div>
            <div>
              {activity.length === 0 ? (
                <div
                  style={{
                    padding: 24, textAlign: 'center',
                    color: 'var(--color-text-secondary)', fontSize: 13,
                  }}
                >
                  Belum ada aktivitas
                </div>
              ) : activity.map((a, i) => (
                <div
                  key={a.id}
                  onClick={() => router.push(`/permit-clusters/${a.id}`)}
                  style={{
                    display: 'flex', gap: 14, alignItems: 'flex-start',
                    padding: '14px 20px',
                    borderBottom: i < activity.length - 1
                      ? '0.5px solid var(--color-border-tertiary)'
                      : 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms',
                  }}
                >
                  {/* Phase color dot */}
                  <div
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      flexShrink: 0, marginTop: 4,
                      background: PHASE_COLORS[a.currentPhase] || '#6B7280',
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* FIX Fix 2A: cluster-centric human line — no more raw "VISIT cmo88… PM_REVIEW → REJECTED" */}
                    <div
                      style={{
                        fontSize: 13, fontWeight: 500,
                        color: 'var(--color-text-primary)', marginBottom: 3,
                      }}
                    >
                      {a.clusterName || a.clusterCode}
                      {a.fiberType && (
                        <span
                          style={{
                            marginLeft: 8, padding: '1px 7px', borderRadius: 10,
                            fontSize: 10, fontWeight: 600,
                            background: `${fiberColors[a.fiberType] || '#6B7280'}20`,
                            color: fiberColors[a.fiberType] || '#6B7280',
                          }}
                        >
                          {a.fiberType}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4,
                      }}
                    >
                      {/* FIX Fix 2A: "Fase: Pengajuan SIP" (label), not raw "SIP_REQUEST" */}
                      Fase: {a.currentPhaseLabel || PHASE_LABELS[a.currentPhase] || a.currentPhase?.replace(/_/g, ' ')}
                      {a.surveyorName ? ` · ${a.surveyorName}` : ''}
                      {a.surveyorRole ? ` (${a.surveyorRole})` : ''}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11, flexShrink: 0,
                      color: 'var(--color-text-secondary)', marginTop: 2,
                    }}
                  >
                    {timeAgo(a.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Fiber Type Distribution */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14, padding: 20,
            }}
          >
            <div
              style={{
                fontSize: 14, fontWeight: 600,
                color: 'var(--color-text-primary)', marginBottom: 16,
              }}
            >
              Distribusi Fiber Type
            </div>
            {byFiber.length === 0 ? (
              <div
                style={{
                  fontSize: 13, color: 'var(--color-text-secondary)',
                  textAlign: 'center', padding: '12px 0',
                }}
              >
                Tidak ada data
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {byFiber.map((f) => {
                  const total = byFiber.reduce((sum, x) => sum + x.count, 0);
                  const pct   = total > 0 ? Math.round((f.count / total) * 100) : 0;
                  const color = fiberColors[f.fiberType] || '#6B7280';
                  return (
                    <div key={f.fiberType}>
                      <div
                        style={{
                          display: 'flex', justifyContent: 'space-between', marginBottom: 5,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13, fontWeight: 500,
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          {f.fiberType}
                        </span>
                        <span style={{ fontSize: 13, color, fontWeight: 600 }}>
                          {f.count} ({pct}%)
                        </span>
                      </div>
                      <div
                        style={{
                          height: 6, borderRadius: 3,
                          background: 'var(--color-background-secondary)', overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%', width: `${pct}%`,
                            background: color, borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14, padding: 20,
            }}
          >
            <div
              style={{
                fontSize: 14, fontWeight: 600,
                color: 'var(--color-text-primary)', marginBottom: 14,
              }}
            >
              Aksi Cepat
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Lihat Semua Pipeline',  href: '/permit-clusters', icon: '🔄', color: '#3B82F6' },
                { label: 'Visit Request Pending', href: '/visit-requests',  icon: '📋', color: '#F59E0B' },
                { label: 'Cash Operation',        href: '/cash-operation',  icon: '💰', color: '#8B5CF6' },
                { label: 'Manajemen User',        href: '/settings',        icon: '👥', color: '#00D4B4' },
              ].map((action) => (
                <button
                  key={action.label}
                  onClick={() => router.push(action.href)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', borderRadius: 10, border: 'none',
                    background: `${action.color}10`,
                    cursor: 'pointer', textAlign: 'left', width: '100%',
                    transition: 'background 150ms',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{action.icon}</span>
                  <span
                    style={{
                      fontSize: 13, fontWeight: 500,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    {action.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Completion trend */}
          <div
            style={{
              background: 'linear-gradient(135deg, #00D4B415, #3B82F615)',
              border: '0.5px solid #00D4B430',
              borderRadius: 14, padding: 20,
            }}
          >
            <div
              style={{
                fontSize: 14, fontWeight: 600,
                color: 'var(--color-text-primary)', marginBottom: 8,
              }}
            >
              📈 Progress Tahun Ini
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: '#00D4B4' }}>
              {s.completedThisYear || 0}
            </div>
            <div
              style={{
                fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4,
              }}
            >
              cluster selesai perizinan
            </div>
            {(s.completedThisMonth ?? 0) > 0 && (
              <div
                style={{
                  marginTop: 10, padding: '6px 12px', borderRadius: 8,
                  background: '#22C55E15', fontSize: 12,
                  color: '#22C55E', fontWeight: 500,
                }}
              >
                ✅ {s.completedThisMonth} selesai bulan ini
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
