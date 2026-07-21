'use client';

// FIX Fix 2A: complete modern rewrite — cluster-centric summary, human-readable labels, no raw IDs/enums
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { apiGet } from '../../../lib/api';
import { formatRupiah, formatPercentage } from '../../../lib/format';

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

type ProjectKind = 'ALL' | 'FTTH' | 'FTTT';

// NEW: Integra V1 — project/budget summary widgets returned alongside the permit pipeline stats
type ProjectSummary = { total: number; onGoing: number; completed: number; pending: number; overdue: number };
type BudgetSummary = { totalBudget: number; spent: number; remaining: number; utilizationPct: number };
type ProjectListItem = {
  id: string;
  name: string;
  kind: 'FTTH' | 'FTTT';
  status: string;
  progressPct: number;
  budgetRemaining: number | null;
};
type AttentionProjectItem = {
  id: string;
  name: string;
  kind: 'FTTH' | 'FTTT';
  status: string;
  reasons: string[];
};
type StatusDistributionItem = { status: string; count: number };

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
  // NEW: Integra V1 — project & budget monitoring widgets (filterable via projectKind)
  projectKind: ProjectKind;
  projectSummary: ProjectSummary;
  budgetSummary: BudgetSummary;
  onProgressProjects: ProjectListItem[];
  attentionProjects: AttentionProjectItem[];
  statusDistribution: StatusDistributionItem[];
};

const ATTENTION_REASON_LABELS: Record<string, string> = {
  overdue: 'Terlambat',
  budget_util_high: 'Budget > 90%',
  no_recent_activity: 'Tidak ada aktivitas',
};

const PROJECT_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: 'Berjalan',
  ACTIVE: 'Berjalan',
  ON_HOLD: 'Ditunda',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export default function GmDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<GmStats | null>(null); // FIX Fix 2A: single source of truth for the whole dashboard
  const [loading, setLoading] = useState(true);
  const [projectKind, setProjectKind] = useState<ProjectKind>('ALL'); // NEW: Integra V1 — Semua / FTTH / FTTT filter

  const load = useCallback(async (kind: ProjectKind) => {
    try {
      const data = await apiGet<GmStats>('/dashboard/gm', { projectKind: kind }); // FIX Fix 2A: hit the new lean GM endpoint
      setStats(data);
    } catch (err) {
      console.error('Dashboard load error:', err); // FIX Fix 2A: non-blocking log so UI still renders fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(projectKind);
    const interval = setInterval(() => { void load(projectKind); }, 120000); // FIX Fix 2A: auto-refresh every 2 minutes
    return () => clearInterval(interval);
  }, [load, projectKind]);

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

  // NEW: Integra V1 — project/budget monitoring widgets, with safe fallbacks while loading
  const projectSummary: ProjectSummary =
    stats?.projectSummary ?? { total: 0, onGoing: 0, completed: 0, pending: 0, overdue: 0 };
  const budgetSummary: BudgetSummary =
    stats?.budgetSummary ?? { totalBudget: 0, spent: 0, remaining: 0, utilizationPct: 0 };
  const onProgressProjects = stats?.onProgressProjects ?? [];
  const attentionProjects  = stats?.attentionProjects ?? [];
  const statusDistribution = stats?.statusDistribution ?? [];
  const maxStatusCount = Math.max(...statusDistribution.map((d) => d.count), 1);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* NEW: Integra V1 — Semua / FTTH / FTTT project-kind filter */}
          <div
            style={{
              display: 'flex', gap: 2, padding: 3, borderRadius: 10,
              background: 'var(--color-background-secondary)',
            }}
          >
            {(['ALL', 'FTTH', 'FTTT'] as ProjectKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setProjectKind(k)}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  background: projectKind === k ? 'var(--color-background-primary)' : 'none',
                  color: projectKind === k ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  boxShadow: projectKind === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {k === 'ALL' ? 'Semua' : k}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load(projectKind)} // FIX Fix 2A: manual refresh — no full page reload
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

      {/* ── NEW: Integra V1 — PROJECT & BUDGET SUMMARY ──────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16, marginBottom: 28,
        }}
      >
        {/* Project Summary */}
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 14, padding: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 14 }}>
            Ringkasan Proyek {projectKind !== 'ALL' ? `(${projectKind})` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[
              { label: 'Total', value: projectSummary.total, color: '#3B82F6' },
              { label: 'Berjalan', value: projectSummary.onGoing, color: '#F59E0B' },
              { label: 'Selesai', value: projectSummary.completed, color: '#22C55E' },
              { label: 'Ditunda', value: projectSummary.pending, color: '#6B7280' },
              { label: 'Terlambat', value: projectSummary.overdue, color: '#EF4444' },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center', padding: '8px 4px' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Budget Summary */}
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 14, padding: 20,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 14 }}>
            Ringkasan Budget {projectKind !== 'ALL' ? `(${projectKind})` : ''}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Terpakai {formatRupiah(budgetSummary.spent)} dari {formatRupiah(budgetSummary.totalBudget)}
            </span>
            <span
              style={{
                fontSize: 12, fontWeight: 700,
                color: budgetSummary.utilizationPct > 90 ? '#EF4444' : '#22C55E',
              }}
            >
              {formatPercentage(budgetSummary.utilizationPct / 100, 1)}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--color-background-secondary)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, budgetSummary.utilizationPct)}%`,
                background: budgetSummary.utilizationPct > 90 ? '#EF4444' : budgetSummary.utilizationPct > 70 ? '#F59E0B' : '#22C55E',
                borderRadius: 4, transition: 'width 600ms ease',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Total Budget</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {formatRupiah(budgetSummary.totalBudget)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Sisa Budget</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: budgetSummary.remaining < 0 ? '#EF4444' : '#22C55E' }}>
                {formatRupiah(budgetSummary.remaining)}
              </div>
            </div>
          </div>
        </div>
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

          {/* NEW: Integra V1 — On Progress Projects */}
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
                fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)',
              }}
            >
              Proyek Sedang Berjalan
            </div>
            <div>
              {onProgressProjects.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                  Tidak ada proyek berjalan
                </div>
              ) : onProgressProjects.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', gap: 14, alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: i < onProgressProjects.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0, padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: p.kind === 'FTTH' ? '#00D4B420' : '#8B5CF620',
                      color: p.kind === 'FTTH' ? '#00D4B4' : '#8B5CF6',
                    }}
                  >
                    {p.kind}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{p.name}</div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--color-background-secondary)', marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${p.progressPct}%`, background: '#3B82F6', borderRadius: 3 }} />
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>{p.progressPct}%</div>
                    {p.budgetRemaining != null && (
                      <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                        Sisa {formatRupiah(p.budgetRemaining)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* NEW: Integra V1 — Attention Projects (budget/overdue/no activity) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid #EF444430',
              borderRadius: 14, overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)',
              }}
            >
              ⚠️ Perlu Perhatian
            </div>
            <div>
              {attentionProjects.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                  Tidak ada proyek yang perlu perhatian khusus
                </div>
              ) : attentionProjects.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', gap: 14, alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: i < attentionProjects.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0, padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: p.kind === 'FTTH' ? '#00D4B420' : '#8B5CF620',
                      color: p.kind === 'FTTH' ? '#00D4B4' : '#8B5CF6',
                    }}
                  >
                    {p.kind}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      {p.reasons.map((r) => ATTENTION_REASON_LABELS[r] || r).join(' · ')}
                    </div>
                  </div>
                  <span
                    style={{
                      flexShrink: 0, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
                      background: '#EF444415', color: '#EF4444',
                    }}
                  >
                    {PROJECT_STATUS_LABELS[p.status] || p.status}
                  </span>
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

          {/* NEW: Integra V1 — Status Distribution */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14, padding: 20,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 16 }}>
              Distribusi Status Proyek
            </div>
            {statusDistribution.every((d) => d.count === 0) ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                Tidak ada data
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {statusDistribution.map((d) => {
                  const pct = Math.round((d.count / maxStatusCount) * 100);
                  const color =
                    d.status === 'COMPLETED' ? '#22C55E' :
                    d.status === 'ON_HOLD' ? '#F59E0B' :
                    d.status === 'CANCELLED' ? '#EF4444' : '#3B82F6';
                  return (
                    <div key={d.status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                          {PROJECT_STATUS_LABELS[d.status] || d.status}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color }}>{d.count}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--color-background-secondary)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
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
