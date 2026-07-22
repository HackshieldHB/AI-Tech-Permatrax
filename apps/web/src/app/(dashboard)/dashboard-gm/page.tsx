'use client';

// Integra Enhancement V3 — Executive Dashboard for General Manager
import { useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { useAuthStore } from '../../../store/authStore';
import { apiGet } from '../../../lib/api';
import { formatRupiah, formatPercentage } from '../../../lib/format';
type ProjectKind = 'ALL' | 'FTTH' | 'FTTT';

type ProjectSummary = {
  total: number;
  onGoing: number;
  completed: number;
  pending: number;
  overdue: number;
  cancelled?: number;
};
type BudgetSummary = {
  totalBudget: number;
  spent: number;
  remaining: number;
  utilizationPct: number;
};
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
type DailyActivityItem = {
  id: string;
  siteName: string;
  scopeOfWork: string;
  workStatus: string;
  actorName: string;
  timestamp: string;
  overdue?: boolean;
};

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
    onHold?: number;
    cancelled?: number;
    pendingApprovals?: number;
  };
  pipeline: {
    byPhase: { phase: string; label: string; count: number }[];
    byFiberType: { fiberType: string; count: number }[];
  };
  recentActivity: Array<{
    id: string;
    clusterName: string;
    currentPhaseLabel: string;
    surveyorName: string;
    updatedAt: string;
    description: string;
  }>;
  projectKind: ProjectKind;
  projectSummary: ProjectSummary;
  budgetSummary: BudgetSummary;
  onProgressProjects: ProjectListItem[];
  attentionProjects: AttentionProjectItem[];
  statusDistribution: StatusDistributionItem[];
  totalSites?: number;
  totalSegments?: number;
  overBudgetCount?: number;
  profitCount?: number;
  lossCount?: number;
  ftthVsFttt?: { ftth: number; fttt: number };
  dailyActivityRecent?: DailyActivityItem[];
  dailyActivityOverdueCount?: number;
  quickInsights?: string[];
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

const STATUS_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#6B7280', '#00D4B4'];
const KIND_COLORS = ['#00D4B4', '#3B82F6'];

function timeAgo(dateStr?: string | Date | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  if (days < 7) return `${days} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const cardStyle: CSSProperties = {
  background: 'var(--color-background-primary)',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 12,
  padding: 16,
};

export default function GmDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<GmStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectKind, setProjectKind] = useState<ProjectKind>('ALL');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (kind: ProjectKind) => {
    try {
      const data = await apiGet<GmStats>('/dashboard/gm', { projectKind: kind });
      setStats(data);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(projectKind);
    const interval = setInterval(() => { void load(projectKind); }, 120000);
    return () => clearInterval(interval);
  }, [load, projectKind]);

  const s = stats?.summary ?? ({} as GmStats['summary']);
  const projectSummary: ProjectSummary =
    stats?.projectSummary ?? { total: 0, onGoing: 0, completed: 0, pending: 0, overdue: 0, cancelled: 0 };
  const budgetSummary: BudgetSummary =
    stats?.budgetSummary ?? { totalBudget: 0, spent: 0, remaining: 0, utilizationPct: 0 };
  const onProgressProjects = (stats?.onProgressProjects ?? []).slice(0, 10);
  const attentionProjects = stats?.attentionProjects ?? [];
  const statusDistribution = stats?.statusDistribution ?? [];
  const ftthVsFttt = stats?.ftthVsFttt ?? { ftth: 0, fttt: 0 };
  const dailyRecent = stats?.dailyActivityRecent ?? [];
  const quickInsights = stats?.quickInsights ?? [];

  const statusChartData = useMemo(
    () => statusDistribution.map((d) => ({
      name: PROJECT_STATUS_LABELS[d.status] ?? d.status,
      value: d.count,
    })),
    [statusDistribution],
  );
  const kindChartData = useMemo(
    () => [
      { name: 'FTTH', value: ftthVsFttt.ftth },
      { name: 'FTTT', value: ftthVsFttt.fttt },
    ].filter((d) => d.value > 0),
    [ftthVsFttt],
  );

  const downloadPdf = () => {
    if (!stats) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 40;
      let y = margin;
      const line = (text: string, size = 11, bold = false) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        const lines = doc.splitTextToSize(text, 515);
        doc.text(lines, margin, y);
        y += lines.length * (size + 4);
        if (y > 780) { doc.addPage(); y = margin; }
      };
      line('EXECUTIVE DASHBOARD – GENERAL MANAGER', 16, true);
      line(`Filter: ${projectKind === 'ALL' ? 'Semua' : projectKind} · ${new Date().toLocaleString('id-ID')}`, 10);
      y += 8;
      line('1. Executive KPI', 13, true);
      line(`Total Project: ${projectSummary.total} | Berjalan: ${projectSummary.onGoing} | Selesai: ${projectSummary.completed} | On Hold: ${projectSummary.pending}`);
      line(`Cash Op Pending: ${s.pendingCashOperations ?? 0} | SLA Terlewat: ${s.slaBreached ?? 0} | User Aktif: ${s.activeUsers ?? 0}`);
      y += 6;
      line('2. Financial Summary', 13, true);
      line(`Total Budget: ${formatRupiah(budgetSummary.totalBudget)} | Terpakai: ${formatRupiah(budgetSummary.spent)} | Sisa: ${formatRupiah(budgetSummary.remaining)}`);
      line(`Utilisasi: ${budgetSummary.utilizationPct}% | Over Budget: ${stats.overBudgetCount ?? 0} | Profit: ${stats.profitCount ?? 0} | Loss: ${stats.lossCount ?? 0}`);
      y += 6;
      line('3. Running Projects', 13, true);
      onProgressProjects.forEach((p, i) => {
        line(`${i + 1}. [${p.kind}] ${p.name} — ${p.progressPct}% · ${PROJECT_STATUS_LABELS[p.status] ?? p.status}`);
      });
      y += 6;
      line('4. Requiring Attention', 13, true);
      if (attentionProjects.length === 0) line('Tidak ada project yang membutuhkan perhatian.');
      attentionProjects.forEach((p) => {
        line(`• [${p.kind}] ${p.name}: ${(p.reasons ?? []).map((r) => ATTENTION_REASON_LABELS[r] ?? r).join(', ')}`);
      });
      y += 6;
      line('5. Quick Insight', 13, true);
      quickInsights.forEach((q) => line(`• ${q}`));
      doc.save(`executive-dashboard-${projectKind.toLowerCase()}-${Date.now()}.pdf`);
    } finally {
      setExporting(false);
    }
  };

  const downloadExcel = () => {
    if (!stats) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();
      const kpi = [
        ['Metric', 'Value'],
        ['Filter', projectKind],
        ['Total Project', projectSummary.total],
        ['Berjalan', projectSummary.onGoing],
        ['Selesai', projectSummary.completed],
        ['On Hold', projectSummary.pending],
        ['Cancel', projectSummary.cancelled ?? 0],
        ['Cash Operation Pending', s.pendingCashOperations ?? 0],
        ['SLA Terlewat', s.slaBreached ?? 0],
        ['User Aktif', s.activeUsers ?? 0],
        ['Total Budget', budgetSummary.totalBudget],
        ['Budget Terpakai', budgetSummary.spent],
        ['Sisa Budget', budgetSummary.remaining],
        ['Utilisasi %', budgetSummary.utilizationPct],
        ['Over Budget', stats.overBudgetCount ?? 0],
        ['Project Profit', stats.profitCount ?? 0],
        ['Project Loss', stats.lossCount ?? 0],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpi), 'KPI');
      const running = [
        ['Project', 'Kind', 'Status', 'Progress %', 'Budget Remaining'],
        ...onProgressProjects.map((p) => [
          p.name, p.kind, PROJECT_STATUS_LABELS[p.status] ?? p.status, p.progressPct, p.budgetRemaining ?? '',
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(running), 'Running');
      const attn = [
        ['Project', 'Kind', 'Status', 'Reasons'],
        ...attentionProjects.map((p) => [
          p.name, p.kind, p.status, (p.reasons ?? []).map((r) => ATTENTION_REASON_LABELS[r] ?? r).join('; '),
        ]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(attn), 'Attention');
      XLSX.writeFile(wb, `executive-dashboard-${projectKind.toLowerCase()}-${Date.now()}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--color-text-secondary)' }}>
        Memuat Executive Dashboard…
      </div>
    );
  }

  const kpiCards = [
    { label: 'Total Project', value: projectSummary.total, color: '#3B82F6' },
    { label: 'Berjalan', value: projectSummary.onGoing, color: '#F59E0B' },
    { label: 'Selesai', value: projectSummary.completed, color: '#22C55E' },
    { label: 'On Hold', value: s.onHold ?? projectSummary.pending, color: '#6B7280' },
    { label: 'Menunggu Approval', value: s.pendingApprovals ?? s.pendingVisitRequests ?? 0, color: '#F59E0B' },
    { label: 'Cash Operation', value: s.pendingCashOperations ?? 0, color: '#0EA5E9' },
    { label: 'SLA Terlewat', value: s.slaBreached ?? 0, color: (s.slaBreached ?? 0) > 0 ? '#EF4444' : '#22C55E' },
    { label: 'User Aktif', value: s.activeUsers ?? 0, color: '#00D4B4' },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            General Manager
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '2px 0 0', color: 'var(--color-text-primary)' }}>
            EXECUTIVE DASHBOARD
          </h1>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            Halo {user?.name?.split(' ')[0] || 'GM'} · ringkasan lintas FTTH & FTTT
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'var(--color-background-secondary)' }}>
            {(['ALL', 'FTTH', 'FTTT'] as ProjectKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setProjectKind(k)}
                style={{
                  padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
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
          <button type="button" onClick={() => void load(projectKind)} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--color-border-tertiary)', background: 'none', cursor: 'pointer', fontSize: 12 }}>
            🔄 Refresh
          </button>
          <button type="button" disabled={exporting} onClick={downloadPdf} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#0F1B2D', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            Download PDF
          </button>
          <button type="button" disabled={exporting} onClick={downloadExcel} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--color-border-tertiary)', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Excel
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {kpiCards.map((c) => (
          <div key={c.label} style={{ ...cardStyle, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, marginTop: 4 }}>{(c.value ?? 0).toLocaleString('id-ID')}</div>
          </div>
        ))}
      </div>

      {/* Project + Financial summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📊 PROJECT SUMMARY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Total Project: <b>{projectSummary.total}</b></div>
            <div>On Progress: <b>{projectSummary.onGoing}</b></div>
            <div>Done: <b>{projectSummary.completed}</b></div>
            <div>On Hold: <b>{projectSummary.pending}</b></div>
            <div>Cancel: <b>{projectSummary.cancelled ?? 0}</b></div>
            <div>Total Site: <b>{stats?.totalSites ?? 0}</b></div>
            <div>Total Segment: <b>{stats?.totalSegments ?? 0}</b></div>
            <div>Terlambat: <b style={{ color: projectSummary.overdue ? '#EF4444' : undefined }}>{projectSummary.overdue}</b></div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>💰 FINANCIAL SUMMARY</div>
          <div style={{ fontSize: 13, display: 'grid', gap: 6 }}>
            <div>Total Budget: <b>{formatRupiah(budgetSummary.totalBudget)}</b></div>
            <div>Budget Terpakai: <b>{formatRupiah(budgetSummary.spent)}</b></div>
            <div>Sisa Budget: <b style={{ color: budgetSummary.remaining < 0 ? '#EF4444' : '#22C55E' }}>{formatRupiah(budgetSummary.remaining)}</b></div>
            <div>Utilisasi: <b>{formatPercentage(budgetSummary.utilizationPct / 100, 1)}</b></div>
            <div>Project Over Budget: <b style={{ color: (stats?.overBudgetCount ?? 0) > 0 ? '#EF4444' : undefined }}>{stats?.overBudgetCount ?? 0}</b></div>
            <div>Project Profit: <b style={{ color: '#22C55E' }}>{stats?.profitCount ?? 0}</b> · Loss: <b style={{ color: '#EF4444' }}>{stats?.lossCount ?? 0}</b></div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Distribusi Status Project</div>
          <div style={{ height: 200 }}>
            {statusChartData.length === 0 ? (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, paddingTop: 60, textAlign: 'center' }}>Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {statusChartData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Distribusi FTTH vs FTTT</div>
          <div style={{ height: 200 }}>
            {kindChartData.length === 0 ? (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, paddingTop: 60, textAlign: 'center' }}>Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={kindChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {kindChartData.map((_, i) => <Cell key={i} fill={KIND_COLORS[i % KIND_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline & Approval */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pipeline & Approval Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {[
            { label: 'Visit Request Pending', value: s.pendingVisitRequests ?? 0, href: '/visit-requests' },
            { label: 'Cash Operation Pending', value: s.pendingCashOperations ?? 0, href: '/cash-operation' },
            { label: 'Approval Menunggu Review', value: s.pendingApprovals ?? 0, href: '/finance-projects' },
            { label: 'SLA Terlewat', value: s.slaBreached ?? 0, href: '/permit-clusters' },
            { label: 'Daily Activity Overdue', value: stats?.dailyActivityOverdueCount ?? 0, href: '/daily-activity' },
            { label: 'Project On Hold', value: s.onHold ?? projectSummary.pending, href: '/fttt-projects' },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => router.push(item.href)}
              style={{ textAlign: 'left', padding: 12, borderRadius: 10, border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 20, fontWeight: 800 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{item.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Running + Attention */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Running Project Summary</div>
          {onProgressProjects.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Tidak ada project berjalan.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: '6px 4px' }}>Project</th>
                    <th style={{ padding: '6px 4px' }}>Progress</th>
                    <th style={{ padding: '6px 4px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {onProgressProjects.map((p) => (
                    <tr key={p.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }} onClick={() => router.push(p.kind === 'FTTT' ? `/fttt-projects/${p.id}` : `/permit-clusters/${p.id}`)}>
                      <td style={{ padding: '8px 4px' }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{p.kind}</div>
                      </td>
                      <td style={{ padding: '8px 4px' }}>{p.progressPct}%</td>
                      <td style={{ padding: '8px 4px' }}>{PROJECT_STATUS_LABELS[p.status] ?? p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Project Requiring Attention</div>
          {attentionProjects.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Tidak ada isu yang perlu perhatian.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attentionProjects.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(p.kind === 'FTTT' ? `/fttt-projects/${p.id}` : `/permit-clusters/${p.id}`)}
                  style={{ textAlign: 'left', padding: 10, borderRadius: 8, border: '0.5px solid #FECACA', background: '#FEF2F2', cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12 }}>{p.name} · {p.kind}</div>
                  <div style={{ fontSize: 11, color: '#B91C1C', marginTop: 2 }}>
                    {(p.reasons ?? []).map((r) => ATTENTION_REASON_LABELS[r] ?? r).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity + Quick Insight */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📌 RECENT ACTIVITY</div>
          {dailyRecent.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dailyRecent.map((a) => (
                <div key={a.id} style={{ fontSize: 12, paddingBottom: 8, borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <div style={{ fontWeight: 600 }}>{a.siteName}</div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>{a.scopeOfWork}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {a.actorName} · {a.workStatus} · {timeAgo(a.timestamp)}
                    {a.overdue ? <span style={{ color: '#EF4444', marginLeft: 6 }}>OVERDUE</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(stats?.recentActivity ?? []).slice(0, 8).map((a) => (
                <div key={a.id} style={{ fontSize: 12, paddingBottom: 8, borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <div style={{ fontWeight: 600 }}>{a.clusterName}</div>
                  <div style={{ color: 'var(--color-text-secondary)' }}>{a.description || a.currentPhaseLabel}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {a.surveyorName} · {timeAgo(a.updatedAt)}
                  </div>
                </div>
              ))}
              {(stats?.recentActivity ?? []).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Belum ada aktivitas terbaru.</div>
              ) : null}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📌 Quick Insight</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.6 }}>
            {quickInsights.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
