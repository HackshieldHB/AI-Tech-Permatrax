'use client';

// Integra Enhancement V7 — Executive Dashboard for General Manager
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
  totalFtth?: number;
  totalFttt?: number;
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
  pmName?: string | null;
  budget?: number | null;
  budgetUsed?: number | null;
  lastActivityAt?: string | null;
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
type CountMap = Record<string, number>;
type PipelineApproval = {
  visitRequestPending: number;
  baOpenPending: number;
  cashOperationPending: number;
  purchaseOrderPending: number;
  supplierInvoicePending: number;
};
type BudgetComposition = { material: number; jasa: number; perizinan: number; lainLain: number };
type BudgetHealth = {
  healthy: number;
  warning: number;
  overBudget: number;
  averageUtilizationPct: number;
  highestUtilizationPct: number;
};
type TopBudgetRow = {
  id: string;
  name: string;
  kind: 'FTTH' | 'FTTT';
  budget: number;
  spent: number;
  utilizationPct: number;
  overAmount?: number;
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
  // Integra V7
  pipelineApproval?: PipelineApproval;
  permitPipelineSummary?: CountMap & { total?: number; pending?: number; approved?: number; rejected?: number; expired?: number };
  budgetComposition?: BudgetComposition;
  budgetHealth?: BudgetHealth;
  phaseDistribution?: { phase: string; label: string; count: number }[];
  cashOperationSummary?: {
    totalRequest: number;
    approved: number;
    rejected: number;
    pending: number;
    totalNominal: number;
  };
  approvalPerformance?: Record<string, CountMap>;
  purchasingSummary?: CountMap & {
    totalPr?: number;
    totalPo?: number;
    pendingApproval?: number;
    approved?: number;
    rejected?: number;
  };
  inventorySummary?: {
    orderBarangPending: number;
    suratJalanPending: number;
    lowStockItem: number;
    totalStockItem: number;
  };
  supplierBilling?: {
    invoicePending: number;
    invoiceApproved: number;
    invoiceRejected: number;
    outstandingInvoice: number;
  };
  topBudgetConsumption?: TopBudgetRow[];
  topOverBudget?: TopBudgetRow[];
  bottlenecks?: CountMap;
  dailyActivitySummary?: {
    activityToday: number;
    progressUpdated: number;
    documentUploaded: number;
    projectNoActivityOver3Days: number;
  };
};

const ATTENTION_REASON_LABELS: Record<string, string> = {
  overdue: 'Terlambat',
  budget_util_high: 'Budget > 90%',
  no_recent_activity: 'No Activity > 3 Hari',
};

const ATTENTION_SEVERITY: Record<string, { label: string; color: string }> = {
  overdue: { label: 'Tinggi', color: '#EF4444' },
  budget_util_high: { label: 'Sedang', color: '#F59E0B' },
  no_recent_activity: { label: 'Rendah', color: '#EAB308' },
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
const BUDGET_COMPOSITION_COLORS = ['#00D4B4', '#3B82F6', '#F59E0B', '#6B7280'];

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

  // Integra V7
  const pipelineApproval = stats?.pipelineApproval;
  const permitPipelineSummary = stats?.permitPipelineSummary;
  const budgetComposition = stats?.budgetComposition;
  const budgetHealth = stats?.budgetHealth;
  const phaseDistribution = stats?.phaseDistribution ?? [];
  const cashOperationSummary = stats?.cashOperationSummary;
  const purchasingSummary = stats?.purchasingSummary;
  const inventorySummary = stats?.inventorySummary;
  const supplierBilling = stats?.supplierBilling;
  const topBudgetConsumption = stats?.topBudgetConsumption ?? [];
  const topOverBudget = stats?.topOverBudget ?? [];
  const bottlenecks = stats?.bottlenecks ?? {};
  const dailyActivitySummary = stats?.dailyActivitySummary;

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
  const budgetCompositionChartData = useMemo(
    () => {
      if (!budgetComposition) return [];
      return [
        { name: 'Material', value: budgetComposition.material },
        { name: 'Jasa', value: budgetComposition.jasa },
        { name: 'Perizinan', value: budgetComposition.perizinan },
        { name: 'Lain-lain', value: budgetComposition.lainLain },
      ].filter((d) => d.value > 0);
    },
    [budgetComposition],
  );

  const downloadPdf = () => {
    if (!stats) return;
    setExporting(true);
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 36;
      const contentW = pageW - margin * 2;
      let y = margin;

      const ensureSpace = (need: number) => {
        if (y + need > 800) {
          doc.addPage();
          y = margin;
        }
      };

      const sectionTitle = (title: string) => {
        ensureSpace(28);
        doc.setFillColor(15, 27, 45);
        doc.rect(margin, y, contentW, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title, margin + 10, y + 15);
        doc.setTextColor(20, 20, 20);
        y += 30;
      };

      const drawKpiGrid = (items: { label: string; value: string }[]) => {
        const cols = 4;
        const gap = 8;
        const boxW = (contentW - gap * (cols - 1)) / cols;
        const boxH = 48;
        items.forEach((item, idx) => {
          const row = Math.floor(idx / cols);
          const col = idx % cols;
          if (col === 0) ensureSpace(boxH + 10);
          const x = margin + col * (boxW + gap);
          const yy = y + row * (boxH + gap);
          doc.setDrawColor(220, 220, 220);
          doc.setFillColor(248, 250, 252);
          doc.roundedRect(x, yy, boxW, boxH, 4, 4, 'FD');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text(item.label, x + 8, yy + 14);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(15, 27, 45);
          doc.text(item.value, x + 8, yy + 34);
        });
        const rows = Math.ceil(items.length / cols);
        y += rows * (boxH + gap) + 6;
        doc.setTextColor(20, 20, 20);
      };

      const drawTable = (headers: string[], rows: string[][], colWeights: number[]) => {
        const sumW = colWeights.reduce((a, b) => a + b, 0);
        const widths = colWeights.map((w) => (w / sumW) * contentW);
        const rowH = 18;
        ensureSpace(rowH * (rows.length + 2));
        let x = margin;
        doc.setFillColor(226, 232, 240);
        doc.rect(margin, y, contentW, rowH, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        headers.forEach((h, i) => {
          doc.text(h, x + 4, y + 12);
          x += widths[i];
        });
        y += rowH;
        doc.setFont('helvetica', 'normal');
        rows.forEach((row, ri) => {
          ensureSpace(rowH + 4);
          if (ri % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y, contentW, rowH, 'F');
          }
          let xx = margin;
          row.forEach((cell, i) => {
            const clipped = doc.splitTextToSize(String(cell ?? ''), widths[i] - 6)[0] ?? '';
            doc.text(clipped, xx + 4, y + 12);
            xx += widths[i];
          });
          y += rowH;
        });
        y += 8;
      };

      // Header banner — Integra V7 Executive Report title follows filter
      const reportTitle =
        projectKind === 'ALL'
          ? 'Executive Report - Semua Project'
          : projectKind === 'FTTH'
            ? 'Executive Report - FTTH'
            : 'Executive Report - FTTT';
      doc.setFillColor(15, 27, 45);
      doc.rect(0, 0, pageW, 64, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(reportTitle, margin, 28);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        `General Manager  ·  Filter: ${projectKind === 'ALL' ? 'Semua' : projectKind}  ·  Generated: ${new Date().toLocaleString('id-ID')}`,
        margin,
        46,
      );
      doc.setTextColor(20, 20, 20);
      y = 78;

      sectionTitle('1. Executive KPI');
      drawKpiGrid([
        { label: 'Total Project', value: String(projectSummary.total) },
        { label: 'Berjalan', value: String(projectSummary.onGoing) },
        { label: 'Selesai', value: String(projectSummary.completed) },
        { label: 'On Hold', value: String(s.onHold ?? projectSummary.pending) },
        { label: 'Menunggu Approval', value: String(s.pendingApprovals ?? s.pendingVisitRequests ?? 0) },
        { label: 'Cash Operation', value: String(s.pendingCashOperations ?? 0) },
        { label: 'SLA Terlewat', value: String(s.slaBreached ?? 0) },
        { label: 'User Aktif', value: String(s.activeUsers ?? 0) },
      ]);

      sectionTitle('2. Project & Financial Summary');
      drawTable(
        ['Metric', 'Value', 'Metric', 'Value'],
        [
          ['Total Project', String(projectSummary.total), 'Total Budget', formatRupiah(budgetSummary.totalBudget)],
          ['On Progress', String(projectSummary.onGoing), 'Budget Terpakai', formatRupiah(budgetSummary.spent)],
          ['Done', String(projectSummary.completed), 'Sisa Budget', formatRupiah(budgetSummary.remaining)],
          ['On Hold', String(projectSummary.pending), 'Utilisasi', `${budgetSummary.utilizationPct}%`],
          ['Total Site', String(stats.totalSites ?? 0), 'Over Budget', String(stats.overBudgetCount ?? 0)],
          ['Total Segment', String(stats.totalSegments ?? 0), 'Profit / Loss', `${stats.profitCount ?? 0} / ${stats.lossCount ?? 0}`],
        ],
        [1.2, 1, 1.2, 1.4],
      );

      // Integra V5: Pie/Donut charts after Project & Financial Summary
      const renderDonutPng = (
        slices: { name: string; value: number; color: string }[],
        size = 280,
      ): string | null => {
        const data = slices.filter((s) => s.value > 0);
        const total = data.reduce((sum, s) => sum + s.value, 0);
        if (total <= 0 || typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const cx = size / 2;
        const cy = size / 2;
        const rOuter = size * 0.38;
        const rInner = size * 0.22;
        let angle = -Math.PI / 2;
        data.forEach((slice) => {
          const sweep = (slice.value / total) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
          ctx.arc(cx, cy, rOuter, angle, angle + sweep);
          ctx.arc(cx, cy, rInner, angle + sweep, angle, true);
          ctx.closePath();
          ctx.fillStyle = slice.color;
          ctx.fill();
          angle += sweep;
        });
        // hole center fill for clean donut look
        ctx.beginPath();
        ctx.arc(cx, cy, rInner - 1, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.fillStyle = '#0F1B2D';
        ctx.font = 'bold 14px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(total), cx, cy - 6);
        ctx.font = '10px Helvetica, Arial, sans-serif';
        ctx.fillStyle = '#64748B';
        ctx.fillText('Total', cx, cy + 10);
        return canvas.toDataURL('image/png');
      };

      const drawDonutWithLegend = (
        title: string,
        slices: { name: string; value: number; color: string }[],
        x: number,
        topY: number,
        boxW: number,
      ) => {
        const img = renderDonutPng(slices, 260);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(15, 27, 45);
        doc.text(title, x, topY + 12);
        if (img) {
          doc.addImage(img, 'PNG', x + 10, topY + 18, 110, 110);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 100, 100);
          doc.text('Tidak ada data', x + 20, topY + 70);
        }
        let ly = topY + 30;
        const total = slices.reduce((sum, s) => sum + s.value, 0) || 1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        slices.filter((s) => s.value > 0).forEach((s) => {
          doc.setFillColor(s.color);
          doc.roundedRect(x + 130, ly - 6, 8, 8, 1, 1, 'F');
          doc.setTextColor(40, 40, 40);
          const pct = Math.round((s.value / total) * 100);
          doc.text(`${s.name}: ${s.value} (${pct}%)`, x + 142, ly);
          ly += 14;
        });
        void boxW;
      };

      ensureSpace(160);
      sectionTitle('3. Distribusi Project (Charts)');
      const chartTop = y;
      const halfW = (contentW - 12) / 2;
      drawDonutWithLegend(
        'Distribusi Status Project',
        statusChartData.map((d, i) => ({
          name: d.name,
          value: d.value,
          color: STATUS_COLORS[i % STATUS_COLORS.length],
        })),
        margin,
        chartTop,
        halfW,
      );
      drawDonutWithLegend(
        'Distribusi FTTH vs FTTT',
        kindChartData.map((d, i) => ({
          name: d.name,
          value: d.value,
          color: KIND_COLORS[i % KIND_COLORS.length],
        })),
        margin + halfW + 12,
        chartTop,
        halfW,
      );
      y = chartTop + 145;

      // 4. Pipeline & Perizinan
      sectionTitle('4. Pipeline & Perizinan');
      drawKpiGrid([
        { label: 'Visit Request Pending', value: String(pipelineApproval?.visitRequestPending ?? 0) },
        { label: 'BA Open Pending', value: String(pipelineApproval?.baOpenPending ?? 0) },
        { label: 'Cash Operation Pending', value: String(pipelineApproval?.cashOperationPending ?? 0) },
        { label: 'PO Pending', value: String(pipelineApproval?.purchaseOrderPending ?? 0) },
        { label: 'Supplier Invoice Pending', value: String(pipelineApproval?.supplierInvoicePending ?? 0) },
      ]);
      drawTable(
        ['Perizinan', 'Value', 'Perizinan', 'Value'],
        [
          ['Total Permit', String(permitPipelineSummary?.total ?? 0), 'Pending', String(permitPipelineSummary?.pending ?? 0)],
          ['Approved', String(permitPipelineSummary?.approved ?? 0), 'Rejected', String(permitPipelineSummary?.rejected ?? 0)],
          ['Expired', String(permitPipelineSummary?.expired ?? 0), '', ''],
        ],
        [1.2, 1, 1.2, 1.4],
      );

      // 5. Budget Composition & Health
      sectionTitle('5. Budget Composition & Health');
      drawTable(
        ['Komponen', 'Nominal', 'Komponen', 'Nominal'],
        [
          ['Material', formatRupiah(budgetComposition?.material ?? 0), 'Jasa', formatRupiah(budgetComposition?.jasa ?? 0)],
          ['Perizinan', formatRupiah(budgetComposition?.perizinan ?? 0), 'Lain-lain', formatRupiah(budgetComposition?.lainLain ?? 0)],
        ],
        [1.2, 1.4, 1.2, 1.4],
      );
      drawKpiGrid([
        { label: 'Budget Sehat', value: String(budgetHealth?.healthy ?? 0) },
        { label: 'Budget Warning', value: String(budgetHealth?.warning ?? 0) },
        { label: 'Over Budget', value: String(budgetHealth?.overBudget ?? 0) },
        { label: 'Avg Utilisasi', value: `${budgetHealth?.averageUtilizationPct ?? 0}%` },
        { label: 'Utilisasi Tertinggi', value: `${budgetHealth?.highestUtilizationPct ?? 0}%` },
      ]);

      // 6. Cash / Purchasing / Inventory / Supplier
      sectionTitle('6. Cash Operation, Purchasing, Inventory & Supplier');
      drawTable(
        ['Metric', 'Value', 'Metric', 'Value'],
        [
          ['Cash Op - Total Request', String(cashOperationSummary?.totalRequest ?? 0), 'Cash Op - Approved', String(cashOperationSummary?.approved ?? 0)],
          ['Cash Op - Rejected', String(cashOperationSummary?.rejected ?? 0), 'Cash Op - Pending', String(cashOperationSummary?.pending ?? 0)],
          ['Cash Op - Total Nominal', formatRupiah(cashOperationSummary?.totalNominal ?? 0), 'Purchasing - Total PR', String(purchasingSummary?.totalPr ?? 0)],
          ['Purchasing - Total PO', String(purchasingSummary?.totalPo ?? 0), 'Purchasing - Pending Approval', String(purchasingSummary?.pendingApproval ?? 0)],
          ['Purchasing - Approved', String(purchasingSummary?.approved ?? 0), 'Purchasing - Rejected', String(purchasingSummary?.rejected ?? 0)],
          ['Inventory - Order Barang Pending', String(inventorySummary?.orderBarangPending ?? 0), 'Inventory - Surat Jalan Pending', String(inventorySummary?.suratJalanPending ?? 0)],
          ['Inventory - Low Stock Item', String(inventorySummary?.lowStockItem ?? 0), 'Inventory - Total Stock Item', String(inventorySummary?.totalStockItem ?? 0)],
          ['Supplier - Invoice Pending', String(supplierBilling?.invoicePending ?? 0), 'Supplier - Invoice Approved', String(supplierBilling?.invoiceApproved ?? 0)],
          ['Supplier - Invoice Rejected', String(supplierBilling?.invoiceRejected ?? 0), 'Supplier - Outstanding Invoice', String(supplierBilling?.outstandingInvoice ?? 0)],
        ],
        [1.6, 1, 1.6, 1],
      );

      // 7. Phase Distribution
      sectionTitle('7. Distribusi Fase Project');
      if (phaseDistribution.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada data distribusi fase.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Fase', 'Jumlah'],
          phaseDistribution.map((p) => [p.label, String(p.count)]),
          [3, 1],
        );
      }

      // 8. Bottleneck & Daily Activity
      sectionTitle('8. Bottleneck & Aktivitas Harian');
      const bottleneckEntries = Object.entries(bottlenecks);
      if (bottleneckEntries.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada bottleneck terdeteksi.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Bottleneck', 'Jumlah'],
          bottleneckEntries.map(([k, v]) => [k, String(v)]),
          [3, 1],
        );
      }
      drawKpiGrid([
        { label: 'Aktivitas Hari Ini', value: String(dailyActivitySummary?.activityToday ?? 0) },
        { label: 'Progress Diupdate', value: String(dailyActivitySummary?.progressUpdated ?? 0) },
        { label: 'Dokumen Diupload', value: String(dailyActivitySummary?.documentUploaded ?? 0) },
        { label: 'No Activity > 3 Hari', value: String(dailyActivitySummary?.projectNoActivityOver3Days ?? 0) },
      ]);

      // 9. Top Budget Consumption
      sectionTitle('9. Top Budget Consumption');
      if (topBudgetConsumption.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada data.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Project', 'Kind', 'Budget', 'Terpakai', 'Utilisasi'],
          topBudgetConsumption.slice(0, 10).map((p) => [
            p.name,
            p.kind,
            formatRupiah(p.budget),
            formatRupiah(p.spent),
            `${p.utilizationPct}%`,
          ]),
          [2.2, 0.7, 1.3, 1.3, 0.9],
        );
      }

      // 10. Top Over Budget
      sectionTitle('10. Top Over Budget');
      if (topOverBudget.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada project over budget.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Project', 'Kind', 'Budget', 'Terpakai', 'Over'],
          topOverBudget.slice(0, 10).map((p) => [
            p.name,
            p.kind,
            formatRupiah(p.budget),
            formatRupiah(p.spent),
            formatRupiah(p.overAmount ?? p.spent - p.budget),
          ]),
          [2.2, 0.7, 1.3, 1.3, 1.3],
        );
      }

      sectionTitle('11. Running Project Summary (max 10)');
      if (onProgressProjects.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada project berjalan.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Project', 'PM', 'Progress', 'Budget', 'Used'],
          onProgressProjects.map((p) => [
            `${p.name} (${p.kind})`,
            p.pmName ?? '-',
            `${p.progressPct}%`,
            formatRupiah(p.budget ?? 0),
            formatRupiah(p.budgetUsed ?? 0),
          ]),
          [2, 1.2, 0.8, 1.3, 1.3],
        );
      }

      sectionTitle('12. Project Requiring Attention');
      if (attentionProjects.length === 0) {
        doc.setFontSize(9);
        doc.text('Tidak ada project yang membutuhkan perhatian.', margin, y + 10);
        y += 24;
      } else {
        drawTable(
          ['Project', 'Kind', 'Alasan'],
          attentionProjects.slice(0, 12).map((p) => [
            p.name,
            p.kind,
            (p.reasons ?? []).map((r) => ATTENTION_REASON_LABELS[r] ?? r).join('; '),
          ]),
          [2.2, 0.7, 2.5],
        );
      }

      // Recent Activity (if available)
      if (dailyRecent.length > 0) {
        sectionTitle('13. Recent Activity');
        drawTable(
          ['Site', 'Aktivitas', 'Status', 'User'],
          dailyRecent.slice(0, 8).map((a) => [
            a.siteName,
            a.scopeOfWork,
            a.workStatus,
            a.actorName,
          ]),
          [1.4, 2.2, 0.9, 1],
        );
      }

      sectionTitle(dailyRecent.length > 0 ? '14. Quick Insight' : '13. Quick Insight');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      quickInsights.forEach((q) => {
        ensureSpace(16);
        const lines = doc.splitTextToSize(`• ${q}`, contentW - 8);
        doc.text(lines, margin + 4, y + 10);
        y += lines.length * 12 + 4;
      });

      // Footer
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text(`${reportTitle} · Halaman ${i}/${pages}`, margin, 820);
      }

      doc.save(`executive-report-${projectKind.toLowerCase()}-${Date.now()}.pdf`);
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
        ['Total FTTH', projectSummary.totalFtth ?? ftthVsFttt.ftth],
        ['Total FTTT', projectSummary.totalFttt ?? ftthVsFttt.fttt],
        ['Berjalan', projectSummary.onGoing],
        ['Selesai', projectSummary.completed],
        ['On Hold', projectSummary.pending],
        ['Cancel', projectSummary.cancelled ?? 0],
        ['Visit Request Pending', pipelineApproval?.visitRequestPending ?? 0],
        ['BA Open Pending', pipelineApproval?.baOpenPending ?? 0],
        ['Cash Operation Pending', pipelineApproval?.cashOperationPending ?? s.pendingCashOperations ?? 0],
        ['PO Pending', pipelineApproval?.purchaseOrderPending ?? 0],
        ['Supplier Invoice Pending', pipelineApproval?.supplierInvoicePending ?? 0],
        ['SLA Terlewat', s.slaBreached ?? 0],
        ['User Aktif', s.activeUsers ?? 0],
        ['Total Budget', budgetSummary.totalBudget],
        ['Budget Terpakai', budgetSummary.spent],
        ['Sisa Budget', budgetSummary.remaining],
        ['Utilisasi %', budgetSummary.utilizationPct],
        ['Budget Sehat', budgetHealth?.healthy ?? 0],
        ['Budget Warning', budgetHealth?.warning ?? 0],
        ['Over Budget', stats.overBudgetCount ?? budgetHealth?.overBudget ?? 0],
        ['Project Profit', stats.profitCount ?? 0],
        ['Project Loss', stats.lossCount ?? 0],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpi), 'KPI');

      const budgetCompositionSheet = [
        ['Komponen', 'Nominal'],
        ['Material', budgetComposition?.material ?? 0],
        ['Jasa', budgetComposition?.jasa ?? 0],
        ['Perizinan', budgetComposition?.perizinan ?? 0],
        ['Lain-lain', budgetComposition?.lainLain ?? 0],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(budgetCompositionSheet), 'Budget Composition');

      const running = [
        ['Project', 'Kind', 'PM', 'Status', 'Progress %', 'Budget', 'Budget Used', 'Budget Remaining'],
        ...onProgressProjects.map((p) => [
          p.name,
          p.kind,
          p.pmName ?? '-',
          PROJECT_STATUS_LABELS[p.status] ?? p.status,
          p.progressPct,
          p.budget ?? 0,
          p.budgetUsed ?? 0,
          p.budgetRemaining ?? '',
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

      const topBudgetSheet = [
        ['Project', 'Kind', 'Budget', 'Spent', 'Utilization %'],
        ...topBudgetConsumption.map((p) => [p.name, p.kind, p.budget, p.spent, p.utilizationPct]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topBudgetSheet), 'Top Budget');

      const topOverBudgetSheet = [
        ['Project', 'Kind', 'Budget', 'Spent', 'Over Amount'],
        ...topOverBudget.map((p) => [p.name, p.kind, p.budget, p.spent, p.overAmount ?? p.spent - p.budget]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topOverBudgetSheet), 'Top Over Budget');

      XLSX.writeFile(wb, `executive-report-${projectKind.toLowerCase()}-${Date.now()}.xlsx`);
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
            Download Report PDF
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
            <div>Terlambat: <b style={{ color: projectSummary.overdue ? '#EF4444' : undefined }}>{projectSummary.overdue}</b></div>
            <div>Total Site: <b>{stats?.totalSites ?? 0}</b></div>
            <div>Total Segment: <b>{stats?.totalSegments ?? 0}</b></div>
            {projectKind === 'ALL' ? (
              <>
                <div>Total FTTH: <b>{projectSummary.totalFtth ?? ftthVsFttt.ftth}</b></div>
                <div>Total FTTT: <b>{projectSummary.totalFttt ?? ftthVsFttt.fttt}</b></div>
              </>
            ) : null}
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
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Komposisi Budget</div>
          <div style={{ height: 200 }}>
            {budgetCompositionChartData.length === 0 ? (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 12, paddingTop: 60, textAlign: 'center' }}>Belum ada data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={budgetCompositionChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70}>
                    {budgetCompositionChartData.map((_, i) => <Cell key={i} fill={BUDGET_COMPOSITION_COLORS[i % BUDGET_COMPOSITION_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatRupiah(value)} />
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
            { label: 'BA Open Pending', value: stats?.pipelineApproval?.baOpenPending ?? 0, href: '/ba-open' },
            { label: 'Cash Operation Pending', value: s.pendingCashOperations ?? 0, href: '/cash-operation' },
            { label: 'PO Pending', value: stats?.pipelineApproval?.purchaseOrderPending ?? 0, href: '/purchasing' },
            { label: 'Supplier Invoice Pending', value: stats?.pipelineApproval?.supplierInvoicePending ?? 0, href: '/supplier-invoices' },
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

      {/* Permit / Budget Health / Operational summaries */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🗂️ PERMIT PIPELINE</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Total: <b>{permitPipelineSummary?.total ?? 0}</b></div>
            <div>Pending: <b>{permitPipelineSummary?.pending ?? 0}</b></div>
            <div>Approved: <b style={{ color: '#22C55E' }}>{permitPipelineSummary?.approved ?? 0}</b></div>
            <div>Rejected: <b style={{ color: '#EF4444' }}>{permitPipelineSummary?.rejected ?? 0}</b></div>
            <div>Expired: <b style={{ color: '#F59E0B' }}>{permitPipelineSummary?.expired ?? 0}</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>💊 BUDGET HEALTH</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Sehat: <b style={{ color: '#22C55E' }}>{budgetHealth?.healthy ?? 0}</b></div>
            <div>Warning: <b style={{ color: '#F59E0B' }}>{budgetHealth?.warning ?? 0}</b></div>
            <div>Over Budget: <b style={{ color: '#EF4444' }}>{budgetHealth?.overBudget ?? 0}</b></div>
            <div>Avg Utilisasi: <b>{budgetHealth?.averageUtilizationPct ?? 0}%</b></div>
            <div>Utilisasi Tertinggi: <b>{budgetHealth?.highestUtilizationPct ?? 0}%</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>💵 CASH OPERATION</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Total Request: <b>{cashOperationSummary?.totalRequest ?? 0}</b></div>
            <div>Approved: <b style={{ color: '#22C55E' }}>{cashOperationSummary?.approved ?? 0}</b></div>
            <div>Rejected: <b style={{ color: '#EF4444' }}>{cashOperationSummary?.rejected ?? 0}</b></div>
            <div>Pending: <b style={{ color: '#F59E0B' }}>{cashOperationSummary?.pending ?? 0}</b></div>
            <div style={{ gridColumn: '1 / -1' }}>Total Nominal: <b>{formatRupiah(cashOperationSummary?.totalNominal ?? 0)}</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🛒 PURCHASING</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Total PR: <b>{purchasingSummary?.totalPr ?? 0}</b></div>
            <div>Total PO: <b>{purchasingSummary?.totalPo ?? 0}</b></div>
            <div>Pending Approval: <b style={{ color: '#F59E0B' }}>{purchasingSummary?.pendingApproval ?? 0}</b></div>
            <div>Approved: <b style={{ color: '#22C55E' }}>{purchasingSummary?.approved ?? 0}</b></div>
            <div>Rejected: <b style={{ color: '#EF4444' }}>{purchasingSummary?.rejected ?? 0}</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📦 INVENTORY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Order Barang Pending: <b>{inventorySummary?.orderBarangPending ?? 0}</b></div>
            <div>Surat Jalan Pending: <b>{inventorySummary?.suratJalanPending ?? 0}</b></div>
            <div>Low Stock Item: <b style={{ color: '#EF4444' }}>{inventorySummary?.lowStockItem ?? 0}</b></div>
            <div>Total Stock Item: <b>{inventorySummary?.totalStockItem ?? 0}</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🧾 SUPPLIER BILLING</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Invoice Pending: <b style={{ color: '#F59E0B' }}>{supplierBilling?.invoicePending ?? 0}</b></div>
            <div>Invoice Approved: <b style={{ color: '#22C55E' }}>{supplierBilling?.invoiceApproved ?? 0}</b></div>
            <div>Invoice Rejected: <b style={{ color: '#EF4444' }}>{supplierBilling?.invoiceRejected ?? 0}</b></div>
            <div>Outstanding Invoice: <b>{supplierBilling?.outstandingInvoice ?? 0}</b></div>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📅 DAILY ACTIVITY SUMMARY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div>Aktivitas Hari Ini: <b>{dailyActivitySummary?.activityToday ?? 0}</b></div>
            <div>Progress Diupdate: <b>{dailyActivitySummary?.progressUpdated ?? 0}</b></div>
            <div>Dokumen Diupload: <b>{dailyActivitySummary?.documentUploaded ?? 0}</b></div>
            <div>No Activity &gt; 3 Hari: <b style={{ color: '#EF4444' }}>{dailyActivitySummary?.projectNoActivityOver3Days ?? 0}</b></div>
          </div>
        </div>
      </div>

      {/* Bottleneck & Phase Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🚧 BOTTLENECK ANALYSIS</div>
          {Object.keys(bottlenecks).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Tidak ada bottleneck terdeteksi.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(bottlenecks).map(([label, count]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <span>{label}</span>
                  <b>{count}</b>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🧭 PHASE DISTRIBUTION</div>
          {phaseDistribution.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Belum ada data distribusi fase.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {phaseDistribution.map((p) => (
                <div key={p.phase} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                  <span>{p.label}</span>
                  <b>{p.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Budget Consumption & Top Over Budget */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🏆 TOP BUDGET CONSUMPTION</div>
          {topBudgetConsumption.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Belum ada data.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: '6px 4px' }}>Project</th>
                    <th style={{ padding: '6px 4px' }}>Budget</th>
                    <th style={{ padding: '6px 4px' }}>Terpakai</th>
                    <th style={{ padding: '6px 4px' }}>Util.</th>
                  </tr>
                </thead>
                <tbody>
                  {topBudgetConsumption.slice(0, 10).map((p) => (
                    <tr key={p.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }} onClick={() => router.push(p.kind === 'FTTT' ? `/fttt-projects/${p.id}` : `/permit-clusters/${p.id}`)}>
                      <td style={{ padding: '8px 4px' }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{p.kind}</div>
                      </td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.budget)}</td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.spent)}</td>
                      <td style={{ padding: '8px 4px' }}>{p.utilizationPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>⚠️ TOP OVER BUDGET</div>
          {topOverBudget.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Tidak ada project over budget.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: '6px 4px' }}>Project</th>
                    <th style={{ padding: '6px 4px' }}>Budget</th>
                    <th style={{ padding: '6px 4px' }}>Terpakai</th>
                    <th style={{ padding: '6px 4px' }}>Over</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverBudget.slice(0, 10).map((p) => (
                    <tr key={p.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }} onClick={() => router.push(p.kind === 'FTTT' ? `/fttt-projects/${p.id}` : `/permit-clusters/${p.id}`)}>
                      <td style={{ padding: '8px 4px' }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{p.kind}</div>
                      </td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.budget)}</td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.spent)}</td>
                      <td style={{ padding: '8px 4px', color: '#EF4444', fontWeight: 700 }}>{formatRupiah(p.overAmount ?? p.spent - p.budget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                    <th style={{ padding: '6px 4px' }}>PM</th>
                    <th style={{ padding: '6px 4px' }}>Progress</th>
                    <th style={{ padding: '6px 4px' }}>Budget</th>
                    <th style={{ padding: '6px 4px' }}>Used</th>
                    <th style={{ padding: '6px 4px' }}>Last Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {onProgressProjects.map((p) => (
                    <tr key={p.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }} onClick={() => router.push(p.kind === 'FTTT' ? `/fttt-projects/${p.id}` : `/permit-clusters/${p.id}`)}>
                      <td style={{ padding: '8px 4px' }}>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{p.kind}</div>
                      </td>
                      <td style={{ padding: '8px 4px' }}>{p.pmName ?? '-'}</td>
                      <td style={{ padding: '8px 4px' }}>{p.progressPct}%</td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.budget ?? 0)}</td>
                      <td style={{ padding: '8px 4px' }}>{formatRupiah(p.budgetUsed ?? 0)}</td>
                      <td style={{ padding: '8px 4px', fontSize: 11, color: 'var(--color-text-secondary)' }}>{timeAgo(p.lastActivityAt) || '-'}</td>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    {(p.reasons ?? []).map((r) => {
                      const severity = ATTENTION_SEVERITY[r] ?? { label: 'Info', color: '#6B7280' };
                      return (
                        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                          <span style={{ padding: '1px 6px', borderRadius: 6, background: severity.color, color: '#fff', fontWeight: 700, fontSize: 10 }}>
                            {severity.label}
                          </span>
                          <span style={{ color: '#B91C1C' }}>{ATTENTION_REASON_LABELS[r] ?? r}</span>
                        </div>
                      );
                    })}
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
