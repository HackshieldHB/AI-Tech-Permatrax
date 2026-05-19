'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Eye } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { apiGetPaginated, apiPatch, apiPost } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import { isPmRole as checkPmRole, isSurveyorRole } from '../../../lib/roles';

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'bg-slate-100 text-slate-600' },
  PM_REVIEW_VISIT: { label: 'Review jadwal PM', color: 'bg-amber-100 text-amber-800' },
  APPROVED_PENDING_DATA: { label: 'Isi data survey', color: 'bg-sky-100 text-sky-800' },
  PM_REVIEW_SURVEY: { label: 'Review hasil survey', color: 'bg-orange-100 text-orange-800' },
  PM_SENIOR_REVIEW: { label: 'Review PM Senior', color: 'bg-orange-100 text-orange-700' },
  ADMIN_REVIEW: { label: 'Review Admin', color: 'bg-purple-100 text-purple-800' },
  APPROVED: { label: 'Disetujui', color: 'bg-emerald-100 text-emerald-800' },
  REJECTED: { label: 'Ditolak', color: 'bg-red-100 text-red-800' },
  EXISTING_FIBER: { label: 'Existing Fiber', color: 'bg-red-50 text-red-500' },
};

// FIX: phase → progress map (Fix 4 — shows full permit lifecycle, not just "APPROVED")
const PHASE_PROGRESS: Record<string, { label: string; pct: number }> = {
  CLUSTER_INTAKE:       { label: 'Intake Cluster',        pct: 15 },
  VISIT_REQUEST:        { label: 'Visit Request',         pct: 15 },
  BA_OPEN:              { label: 'BA Open dibuat',        pct: 20 },
  SITE_VISIT:           { label: 'Kunjungan Lapangan',    pct: 25 },
  SURVEY_INPUT:         { label: 'Input Data Survey',     pct: 30 },
  ROUTE_SURVEY:         { label: 'Route Survey',          pct: 35 },
  BA_SURVEY:            { label: 'BA Survey',             pct: 40 },
  SIP_REQUEST:          { label: 'SIP ke ISP',            pct: 45 },
  HLD_SUBMISSION:       { label: 'Review HLD',            pct: 50 },
  LLD_SUBMISSION:       { label: 'Review LLD',            pct: 55 },
  PR_BR_ISSUANCE:       { label: 'PR/BR dari ISP',        pct: 60 },
  CONTRACT_MANAGEMENT:  { label: 'PKS/PO Kontrak',        pct: 65 },
  SKOM_BUDGET:          { label: 'Budget SKOM',           pct: 70 },
  MANAGEMENT_APPROVAL:  { label: 'Approval Management',   pct: 73 },
  FUND_DISBURSEMENT:    { label: 'Pencairan Dana',        pct: 76 },
  BAK_GENERATION:       { label: 'BAK dibuat',            pct: 80 },
  BAKP_COMPILATION:     { label: 'BAKP Kompilasi',        pct: 85 },
  CLAIM_SUBMISSION:     { label: 'Submit Dokumen Klaim',  pct: 90 },
  INVOICE_PACKAGE:      { label: 'Invoice ke Finance',    pct: 95 },
  PERMIT_DONE:          { label: '🎉 Permit Selesai',     pct: 100 },
};

// FIX: compute progress based on VR status → permit cluster phase
function getPermitProgressLabel(vr: any): { label: string; color: string; pct: number } {
  if (vr.status === 'DRAFT' && vr.rejectionReason) {
    return { label: 'Perlu revisi jadwal', color: '#CA8A04', pct: 0 };
  }
  if (vr.status === 'DRAFT') return { label: 'Draft', color: '#9CA3AF', pct: 0 };
  if (vr.status === 'PM_REVIEW_VISIT') return { label: 'Menunggu PM (jadwal)', color: '#F59E0B', pct: 4 };
  if (vr.status === 'APPROVED_PENDING_DATA') return { label: 'Isi data survey', color: '#0EA5E9', pct: 6 };
  if (vr.status === 'PM_REVIEW_SURVEY') return { label: 'Menunggu PM (survey)', color: '#F59E0B', pct: 8 };
  if (vr.status === 'PM_SENIOR_REVIEW') return { label: 'Menunggu PM Senior', color: '#F97316', pct: 8 };
  if (vr.status === 'ADMIN_REVIEW') return { label: 'Menunggu Admin', color: '#8B5CF6', pct: 10 };
  if (vr.status === 'REJECTED') return { label: 'Ditolak', color: '#EF4444', pct: 0 };
  if (vr.status === 'EXISTING_FIBER') return { label: 'Existing Fiber', color: '#DC2626', pct: 0 };

  const cluster = vr.permitCluster;
  if (!cluster) return { label: 'Disetujui — Memulai Survey', color: '#22C55E', pct: 15 };

  const progress = PHASE_PROGRESS[cluster.currentPhase];
  if (!progress) return { label: cluster.currentPhase || 'Processing', color: '#6B7280', pct: 50 };

  const color =
    progress.pct === 100 ? '#22C55E' :
    progress.pct >= 70   ? '#8B5CF6' :
    progress.pct >= 40   ? '#3B82F6' :
                           '#F59E0B';

  return { label: progress.label, color, pct: progress.pct };
}

function getVisitRequestStatusBadge(row: any): { label: string; color: string } {
  if (row.status === 'DRAFT' && row.rejectionReason) {
    return { label: 'Perlu revisi jadwal', color: 'bg-amber-100 text-amber-900' };
  }
  const meta = STATUS_BADGES[row.status];
  return { label: meta?.label ?? row.status, color: meta?.color ?? 'bg-slate-100 text-slate-500' };
}

// FIX: row progress display — shows permit lifecycle instead of only VR status
function StatusProgress({ row }: { row: any }) {
  const progress = getPermitProgressLabel(row);
  const badge = getVisitRequestStatusBadge(row);

  return (
    <div className="flex flex-col gap-1 min-w-40">
      <span
        className={`self-start px-2 py-0.5 rounded-full text-[10px] font-black ${badge.color}`}
      >
        {badge.label}
      </span>
      {row.status !== 'REJECTED' && row.status !== 'EXISTING_FIBER' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 2 }}>
            <span style={{ color: progress.color, fontWeight: 600 }}>{progress.label}</span>
            <span style={{ color: '#64748b' }}>{progress.pct}%</span>
          </div>
          <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress.pct}%`, background: progress.color }}
            />
          </div>
        </>
      )}
    </div>
  );
}

const TABS = ['Semua', 'Menunggu Review', 'Disetujui', 'Ditolak'];
const TAB_STATUS: Record<string, string> = {
  'Menunggu Review':
    'PM_REVIEW_VISIT,APPROVED_PENDING_DATA,PM_REVIEW_SURVEY,ADMIN_REVIEW,PM_SENIOR_REVIEW',
  Disetujui: 'APPROVED',
  Ditolak: 'REJECTED',
};

function VisitRequestsPageInner() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isSurveyor = isSurveyorRole(user?.role);
  const { page, limit, setPage, setLimit } = usePagination(20);

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Semua');
  const [meta, setMeta] = useState<{ total: number; totalPages: number } | null>(null);
  const [rejectModal, setRejectModal] = useState<{
    id: string;
    kind: 'pm_visit' | 'pm_survey' | 'admin';
  } | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  useEffect(() => {
    if (!user) return;
    if (checkPmRole(user.role) || user.role === 'ADMIN') {
      setActiveTab('Menunggu Review');
    }
  }, [user?.id, user?.role]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = TAB_STATUS[activeTab] ?? '';
      const res = await apiGetPaginated('/visit-requests', {
        page,
        limit,
        ...(statusParam && { status: statusParam }),
      });
      setData(res.data);
      setMeta({ total: res.meta.total, totalPages: res.meta.totalPages });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }, [page, limit, activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, setPage]);

  const isPmRole = user && checkPmRole(user.role);
  const isAdmin = user?.role === 'ADMIN';

  const handleQuickApprove = async (id: string, kind: 'pm_visit' | 'pm_survey' | 'admin') => {
    try {
      if (kind === 'pm_visit') {
        await apiPatch(`/visit-requests/${id}/pm-visit-review`, { action: 'APPROVE' });
      } else if (kind === 'pm_survey') {
        await apiPatch(`/visit-requests/${id}/pm-review`, { action: 'APPROVE' });
      } else {
        await apiPatch(`/visit-requests/${id}/admin-approve`, { action: 'APPROVE' });
      }
      toast.success('Visit request disetujui');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyetujui');
    }
  };

  const confirmQuickReject = async () => {
    if (!rejectModal || !rejectNotes.trim()) {
      toast.error(
        rejectModal?.kind === 'pm_visit'
          ? 'Alasan penolakan wajib diisi'
          : 'Catatan wajib untuk menolak',
      );
      return;
    }
    try {
      if (rejectModal.kind === 'pm_visit') {
        await apiPatch(`/visit-requests/${rejectModal.id}/pm-visit-review`, {
          action: 'REJECT',
          rejectionReason: rejectNotes.trim(),
        });
      } else if (rejectModal.kind === 'pm_survey') {
        await apiPatch(`/visit-requests/${rejectModal.id}/pm-review`, {
          action: 'REJECT',
          notes: rejectNotes.trim(),
        });
      } else {
        await apiPatch(`/visit-requests/${rejectModal.id}/admin-approve`, {
          action: 'REJECT',
          notes: rejectNotes.trim(),
        });
      }
      toast.success('Visit request ditolak');
      setRejectModal(null);
      setRejectNotes('');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      await apiPost(`/visit-requests/${id}/submit`, {});
      toast.success('Disubmit ke PM');
      await fetchData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal submit');
    }
  };

  return (
    <div className="space-y-6">
      {rejectModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: 'var(--color-background-primary, #fff)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 380,
              width: '100%',
            }}
          >
            <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>
              {rejectModal.kind === 'pm_visit' ? 'Alasan penolakan jadwal' : 'Alasan penolakan'}
            </h4>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder={
                rejectModal.kind === 'pm_visit'
                  ? 'Wajib — jelaskan mengapa jadwal ditolak…'
                  : 'Wajib diisi — jelaskan alasan penolakan…'
              }
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: 12 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={!rejectNotes.trim()}
                onClick={confirmQuickReject}
                style={{
                  flex: 1,
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: '#EF4444',
                  color: 'white',
                  border: 'none',
                  cursor: rejectNotes.trim() ? 'pointer' : 'not-allowed',
                  opacity: rejectNotes.trim() ? 1 : 0.5,
                  fontSize: 13,
                }}
              >
                Konfirmasi Tolak
              </button>
              <button
                type="button"
                onClick={() => { setRejectModal(null); setRejectNotes(''); }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-background-secondary, #f1f5f9)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Visit Request</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manajemen kunjungan lapangan fiber</p>
        </div>
        {isSurveyor && (
          <Link
            href="/visit-requests/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-[#00D4B4] text-[#0F1B2D] rounded-xl font-bold text-sm hover:bg-[#00BFA3] transition-colors shadow-md shadow-[#00D4B4]/20"
          >
            <Plus className="w-4 h-4" />
            Buat Visit Request
          </Link>
        )}
      </div>

      <div className="flex gap-1 bg-white rounded-2xl p-1 shadow-sm border border-slate-100 w-fit flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              activeTab === tab ? 'bg-[#0F1B2D] text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Kode RW', 'ISP', 'FiberType', 'Surveyor', 'Status / Progress', 'Tgl Kunjungan', 'Updated', 'Aksi'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (<td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 animate-pulse rounded-md" /></td>))}</tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-16 text-slate-400">Tidak ada data visit request.</td></tr>
              ) : (
                data.map((row: any) => {
                  const status = row.status;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-bold text-slate-800">{row.cleanList?.rwCode ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{row.ispCustomer}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-sky-100 text-sky-700">{row.fiberType}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.requester?.name ?? '—'}</td>
                      <td className="px-4 py-3"><StatusProgress row={row} /></td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {row.visitDate ? new Date(row.visitDate).toLocaleDateString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {new Date(row.updatedAt).toLocaleDateString('id-ID')}
                      </td>
                      <td className="px-4 py-3">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            title="Lihat Detail"
                            onClick={() => router.push(`/visit-requests/${row.id}`)} // FIX: client nav
                            style={{
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: 'var(--color-background-secondary, #f1f5f9)',
                              cursor: 'pointer',
                              color: 'var(--color-text-secondary, #64748b)',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            <Eye style={{ width: 14, height: 14 }} />
                          </button>
                          {isPmRole && status === 'PM_REVIEW_VISIT' ? (
                            <>
                              <button
                                type="button"
                                title="Setujui jadwal"
                                onClick={() => handleQuickApprove(row.id, 'pm_visit')}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#DCFCE7',
                                  color: '#166534',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✓ Jadwal
                              </button>
                              <button
                                type="button"
                                title="Tolak jadwal"
                                onClick={() => {
                                  setRejectModal({ id: row.id, kind: 'pm_visit' });
                                  setRejectNotes('');
                                }}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✗ Jadwal
                              </button>
                            </>
                          ) : null}
                          {isPmRole && status === 'PM_REVIEW_SURVEY' ? (
                            <>
                              <button
                                type="button"
                                title="Setujui hasil survey"
                                onClick={() => handleQuickApprove(row.id, 'pm_survey')}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#DCFCE7',
                                  color: '#166534',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✓ Survey
                              </button>
                              <button
                                type="button"
                                title="Tolak hasil survey"
                                onClick={() => {
                                  setRejectModal({ id: row.id, kind: 'pm_survey' });
                                  setRejectNotes('');
                                }}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✗ Survey
                              </button>
                            </>
                          ) : null}
                          {isAdmin && status === 'ADMIN_REVIEW' ? (
                            <>
                              <button
                                type="button"
                                title="Setujui Final"
                                onClick={() => handleQuickApprove(row.id, 'admin')}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#DBEAFE',
                                  color: '#1E40AF',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✓ Final
                              </button>
                              <button
                                type="button"
                                title="Tolak"
                                onClick={() => { setRejectModal({ id: row.id, kind: 'admin' }); setRejectNotes(''); }}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: 500,
                                }}
                              >
                                ✗ Tolak
                              </button>
                            </>
                          ) : null}
                          {isSurveyor && status === 'REJECTED' && row.requester?.id === user?.id ? (
                            <span className="text-[10px] text-red-700 max-w-[120px] truncate" title={row.rejectionReason}>Ditolak</span>
                          ) : null}
                          {isSurveyor && status === 'DRAFT' && row.requester?.id === user?.id ? (
                            <button
                              type="button"
                              onClick={() => handleSubmit(row.id)}
                              className="px-2 py-1 bg-sky-600 text-white rounded text-[10px] font-black"
                            >
                              Submit
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.total > 0 && (
          <Pagination total={meta.total} page={page} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
        )}
      </div>
    </div>
  );
}

export default function VisitRequestsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat...</div>}>
      <VisitRequestsPageInner />
    </Suspense>
  );
}
