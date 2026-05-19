'use client'; // FIX: interactive cash operation list + approval progress

import Link from 'next/link'; // FIX
import { useRouter } from 'next/navigation'; // FIX: navigate to edit page for rejected requests
import { useCallback, useEffect, useMemo, useState } from 'react'; // FIX
import { toast } from 'sonner'; // FIX
import { apiGet, apiGetPaginated, apiPost } from '../../../lib/api'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { usePagination } from '../../../hooks/usePagination'; // FIX
import { Pagination } from '../../../components/Pagination'; // FIX
import { ApprovalDialog } from '../../../components/cash-op/ApprovalDialog';
import type { CashOperationRequest } from '../../../types/api.types';

type CashOpRow = {
  id: string; // FIX
  requestNumber: string; // FIX
  type: 'CASH_ADVANCE' | 'REIMBURSEMENT'; // FIX
  description: string; // FIX
  amount: number | string; // FIX
  finalApprovedAmount?: number | string | null;
  status: string; // FIX
  currentStepRole: string | null; // FIX
  currentApproverRole?: string | null; // FIX: align with API persisted approver field
  currentStep?: number; // FIX
  approvalChain?: string[] | null; // FIX
  slaDeadline: string | null; // FIX
  slaBreached: boolean; // FIX
  requestedBy: string; // FIX
  requester?: { name?: string; role?: string }; // FIX
  realisasiStatus?: string | null;
  realisasiCurrentStepRole?: string | null;
}; // FIX

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Diajukan',
  IN_REVIEW: 'Dalam peninjauan',
  APPROVED: 'Disetujui',
  REALISASI_IN_PROGRESS: 'Realisasi berjalan',
  DONE: 'Selesai',
  DISBURSED: 'Dicairkan',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700', // FIX
  SUBMITTED: 'bg-slate-100 text-slate-700', // FIX
  IN_REVIEW: 'bg-amber-100 text-amber-700', // FIX
  APPROVED: 'bg-teal-100 text-teal-700', // FIX
  REALISASI_IN_PROGRESS: 'bg-indigo-100 text-indigo-800', // M4
  DONE: 'bg-emerald-100 text-emerald-800', // M4
  DISBURSED: 'bg-emerald-100 text-emerald-700', // FIX
  REJECTED: 'bg-red-100 text-red-700', // FIX
  CANCELLED: 'bg-slate-200 text-slate-600', // FIX
}; // FIX

function roleLabel(role: string | null) {
  if (!role) return '—'; // FIX
  return role.replace(/_/g, ' '); // FIX
} // FIX

function daysLeft(deadline: string | null) {
  if (!deadline) return null; // FIX
  const ms = new Date(deadline).getTime() - Date.now(); // FIX
  return Math.ceil(ms / (1000 * 60 * 60 * 24)); // FIX
} // FIX

/** FIX: show approval chain progress in list item */
function ApprovalProgress({
  chain,
  currentStep,
  status,
}: {
  chain: string[];
  currentStep: number;
  status: string;
}) {
  const ROLE_SHORT: Record<string, string> = {
    SURVEYOR_FTTH: 'Surv', // FIX
    SURVEYOR_FTTB: 'Surv', // FIX
    SURVEYOR_FTTT: 'Surv', // FIX
    PM_FTTH: 'PM', // FIX
    PM_FTTB: 'PM', // FIX
    PM_FTTT: 'PM', // FIX
    PM_SENIOR: 'PM Sr', // FIX
    ADMIN: 'Admin', // FIX
    ADMIN_STOCK: 'Admin', // FIX
    MARKETING: 'Mktg', // FIX
    MARKETING_HEAD: 'Mktg H', // FIX
    OPERATIONAL_MANAGER: 'Ops', // FIX
    GENERAL_MANAGER: 'GM', // FIX
    FINANCE: 'Finance', // FIX
    DESIGNER: 'Design', // FIX
  }; // FIX

  if (!chain || chain.length === 0) return null; // FIX

  const approvers = chain.slice(1); // FIX
  const approvedCount = Math.max(0, (currentStep || 1) - 1); // FIX

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 6, flexWrap: 'wrap' }}>
      {approvers.map((role, i) => {
        const isDone = status === 'APPROVED' || status === 'DISBURSED' || i < approvedCount; // FIX
        const isActive = (status === 'SUBMITTED' || status === 'IN_REVIEW') && i === approvedCount; // FIX
        return (
          <div key={`${role}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && (
              <div
                style={{
                  width: 8, // FIX
                  height: 1, // FIX
                  background: isDone ? '#00D4B4' : 'var(--color-border-tertiary, #e2e8f0)', // FIX
                }}
              />
            )}
            <div
              style={{
                padding: '2px 7px', // FIX
                borderRadius: 6, // FIX
                fontSize: 10, // FIX
                fontWeight: 600, // FIX
                background: isDone ? '#00D4B415' : isActive ? '#F59E0B15' : 'transparent', // FIX
                color: isDone ? '#00D4B4' : isActive ? '#F59E0B' : 'var(--color-text-secondary, #64748b)', // FIX
                border: `0.5px solid ${
                  isDone ? '#00D4B430' : isActive ? '#F59E0B30' : 'var(--color-border-tertiary, #e2e8f0)' // FIX
                }`,
              }}
            >
              {isDone && '✓ '}
              {ROLE_SHORT[role] || role}
              {isActive && ' ←'}
            </div>
          </div>
        );
      })}
    </div>
  );
} // FIX

function userCanActStage1(userRole: string | undefined, r: CashOpRow): boolean {
  const stepRole = r.currentApproverRole ?? r.currentStepRole;
  if (!userRole || !['SUBMITTED', 'IN_REVIEW'].includes(r.status)) return false;
  if (stepRole === userRole) return true;
  if (userRole === 'PM_SENIOR' && ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(stepRole ?? '')) return true;
  return false;
}

function userNeedsRealisasiAttention(userRole: string | undefined, r: CashOpRow): boolean {
  if (r.type !== 'CASH_ADVANCE') return false;
  if (userRole === 'FINANCE' && r.realisasiStatus === 'PENDING_FINANCE_REVIEW') return true;
  if (userRole === 'GENERAL_MANAGER' && r.realisasiStatus === 'PENDING_GM_REVIEW') return true;
  return false;
}

export default function CashOperationPage() {
  const router = useRouter(); // FIX
  const { user } = useAuthStore(); // FIX
  const { page, limit, setPage, setLimit } = usePagination(20); // FIX
  const [rows, setRows] = useState<CashOpRow[]>([]); // FIX
  const [loading, setLoading] = useState(true); // FIX
  const [metaTotal, setMetaTotal] = useState(0); // FIX
  const [status, setStatus] = useState(''); // FIX
  const [type, setType] = useState(''); // FIX
  const [tab, setTab] = useState<'mine' | 'pending' | 'all'>('mine'); // FIX
  const [inboxCount, setInboxCount] = useState(0); // FIX
  const [approveRow, setApproveRow] = useState<CashOpRow | null>(null);
  const [approveDetail, setApproveDetail] = useState<CashOperationRequest | null>(null);

  const openStage1Approve = useCallback(async (r: CashOpRow) => {
    setApproveRow(r);
    try {
      const d = await apiGet<CashOperationRequest>(`/cash-operation/${r.id}`);
      setApproveDetail(d);
    } catch {
      toast.error('Gagal memuat detail untuk persetujuan');
      setApproveRow(null);
      setApproveDetail(null);
    }
  }, []);

  const canSubmit = useMemo(
    () =>
      !!user &&
      (user.role.startsWith('SURVEYOR_') ||
        user.role.startsWith('PM_') ||
        user.role === 'MARKETING' ||
        user.role === 'MARKETING_HEAD' ||
        user.role === 'DESIGNER' ||
        ['ADMIN', 'ADMIN_STOCK', 'GENERAL_MANAGER', 'FINANCE', 'OPERATIONAL_MANAGER'].includes(user.role)),
    [user],
  );

  const canApprove = useMemo(
    () =>
      !!user &&
      [
        'PM_FTTH',
        'PM_FTTB',
        'PM_FTTT',
        'PM_SENIOR',
        'DESIGNER',
        'ADMIN',
        'ADMIN_STOCK',
        'OPERATIONAL_MANAGER',
        'GENERAL_MANAGER',
        'FINANCE',
        'MARKETING_HEAD',
      ].includes(user.role), // FIX
    [user],
  ); // FIX

  const load = useCallback(async () => {
    setLoading(true); // FIX
    try {
      const params: Record<string, string | number> = { page, limit }; // FIX
      if (status) params.status = status; // FIX
      if (type) params.type = type; // FIX
      const res = await apiGetPaginated<CashOpRow>('/cash-operation', params); // FIX
      let nextRows = res.data; // FIX
      if (tab === 'mine' && user) nextRows = nextRows.filter((r) => r.requestedBy === user.id); // FIX
      if (tab === 'pending' && user) {
        nextRows = nextRows.filter((r) => userCanActStage1(user.role, r) || userNeedsRealisasiAttention(user.role, r));
      }
      setRows(nextRows); // FIX
      setMetaTotal(res.meta.total); // FIX
    } catch {
      toast.error('Gagal memuat cash operation'); // FIX
    } finally {
      setLoading(false); // FIX
    }
  }, [limit, page, status, type, tab, user]); // FIX

  useEffect(() => {
    load(); // FIX
  }, [load]); // FIX

  useEffect(() => {
    apiGet<{ count: number }>('/cash-operation/inbox-count') // FIX
      .then((x) => setInboxCount(x.count)) // FIX
      .catch(() => setInboxCount(0)); // FIX
  }, []); // FIX

  const onSubmitDraft = async (id: string) => {
    try {
      await apiPost(`/cash-operation/${id}/submit`, {}); // FIX
      toast.success('Request berhasil disubmit'); // FIX
      load(); // FIX
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Submit gagal'); // FIX
    }
  }; // FIX

  const onApprove = async (id: string, action: 'APPROVE' | 'REJECT') => {
    try {
      await apiPost(`/cash-operation/${id}/approve`, { action, notes: action === 'REJECT' ? 'Ditolak dari daftar' : 'Disetujui' }); // FIX
      toast.success(action === 'APPROVE' ? 'Request disetujui' : 'Request ditolak'); // FIX
      load(); // FIX
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses'); // FIX
    }
  }; // FIX

  const onDisburse = async (row: CashOpRow) => {
    try {
      await apiPost(`/cash-operation/${row.id}/disburse`, { disbursedAmount: Number(row.amount), notes: 'Dicairkan dari list' }); // FIX
      toast.success('Dana dicairkan'); // FIX
      load(); // FIX
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencairkan'); // FIX
    }
  }; // FIX

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Cash Operation</h1>
          <p className="text-sm text-slate-500">Pengajuan & Reimbursement</p>
        </div>
        {canSubmit ? (
          <Link href="/cash-operation/new" className="px-4 py-2 rounded-xl bg-[#00D4B4] text-[#0F1B2D] text-sm font-bold">
            + Buat Request
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${tab === 'pending' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            Perlu Persetujuan {inboxCount > 0 ? `(${inboxCount})` : ''}
          </button>
        ) : null}
        <button type="button" onClick={() => setTab('all')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${tab === 'all' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-700'}`}>
          Semua Request
        </button>
        <button type="button" onClick={() => setTab('mine')} className={`px-3 py-1.5 rounded-full text-xs font-bold ${tab === 'mine' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-700'}`}>
          Request Saya
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-3 flex flex-wrap gap-2">
        <select className="px-3 py-2 rounded-xl border border-slate-200 text-sm" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All Type</option>
          <option value="CASH_ADVANCE">Cash Advance</option>
          <option value="REIMBURSEMENT">Reimbursement</option>
        </select>
        <select className="px-3 py-2 rounded-xl border border-slate-200 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {Object.keys(STATUS_LABELS).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {['No Request', 'Tipe', 'Deskripsi', 'Total Pengajuan Awal', 'Total Disetujui', 'Status', 'SLA', 'Step / Alur', 'Aksi'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Memuat...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Belum ada request
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const dLeft = daysLeft(r.slaDeadline); // FIX
                  const chain = Array.isArray(r.approvalChain) ? r.approvalChain : []; // FIX
                  const stepIdx = typeof r.currentStep === 'number' ? r.currentStep : 1; // FIX
                  const showNeedsApproval = userCanActStage1(user?.role, r) || userNeedsRealisasiAttention(user?.role, r);
                  const stage1Act = userCanActStage1(user?.role, r);
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs align-top">
                        <div className="flex flex-wrap items-center gap-1">
                          {r.requestNumber}
                          {stage1Act ? (
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: '#F59E0B15',
                                color: '#F59E0B',
                                fontSize: 10,
                                fontWeight: 700,
                                border: '0.5px solid #F59E0B30',
                              }}
                            >
                              ⏳ Perlu persetujuan Anda
                            </span>
                          ) : null}
                          {userNeedsRealisasiAttention(user?.role, r) ? (
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: '#6366F115',
                                color: '#4F46E5',
                                fontSize: 10,
                                fontWeight: 700,
                                border: '0.5px solid #6366F130',
                              }}
                            >
                              Realisasi menunggu Anda
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.type === 'CASH_ADVANCE' ? 'bg-primary/10 text-primary' : 'bg-purple-100 text-purple-700'}`}>
                          {r.type === 'CASH_ADVANCE' ? 'Pengajuan' : 'Reimburse'}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[260px] truncate align-top">{r.description}</td>
                      <td className="px-4 py-3 font-semibold align-top">Rp {Number(r.amount).toLocaleString('id-ID')}</td>
                      <td className="px-4 py-3 font-semibold align-top">
                        {r.finalApprovedAmount ? `Rp ${Number(r.finalApprovedAmount).toLocaleString('id-ID')}` : '—'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_CLASS[r.status] ?? 'bg-slate-100 text-slate-700'}`}>{STATUS_LABELS[r.status] ?? r.status}</span>
                      </td>
                      <td className="px-4 py-3 text-xs align-top">
                        {!r.slaDeadline || ['DISBURSED', 'REJECTED', 'CANCELLED'].includes(r.status) ? (
                          '—'
                        ) : r.slaBreached ? (
                          <span className="text-red-600 font-bold">LEWAT SLA</span>
                        ) : dLeft != null && dLeft <= 1 ? (
                          <span className="text-amber-600 font-bold">Besok</span>
                        ) : (
                          <span className="text-slate-500">{dLeft} hari</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 align-top max-w-[320px]">
                        {r.status === 'APPROVED' || r.status === 'DISBURSED' || r.status === 'DONE' || r.status === 'REALISASI_DONE' ? (
                          'Selesai ✓'
                        ) : r.status === 'REJECTED' ? (
                          'Ditolak'
                        ) : r.status === 'REALISASI_IN_PROGRESS' && r.realisasiStatus ? (
                          <div>
                            <div>Realisasi: {r.realisasiStatus.replace(/_/g, ' ')}</div>
                            {r.realisasiCurrentStepRole ? (
                              <div className="text-slate-500">Langkah: {roleLabel(r.realisasiCurrentStepRole)}</div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <div>Menunggu {roleLabel(r.currentApproverRole ?? r.currentStepRole)}</div>
                            {chain.length > 1 ? <ApprovalProgress chain={chain} currentStep={stepIdx} status={r.status} /> : null}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2 flex-wrap">
                          {r.status === 'DRAFT' ? (
                            <button type="button" onClick={() => onSubmitDraft(r.id)} className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800 text-xs font-bold">
                              Submit
                            </button>
                          ) : null}
                          {stage1Act ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void openStage1Approve(r)}
                                className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-bold"
                              >
                                Setujui…
                              </button>
                              <button type="button" onClick={() => onApprove(r.id, 'REJECT')} className="px-2 py-1 rounded-lg border border-red-300 text-red-700 text-xs font-bold">
                                Tolak
                              </button>
                            </>
                          ) : userNeedsRealisasiAttention(user?.role, r) ? (
                            <Link
                              href={`/cash-operation/${r.id}`}
                              className="px-2 py-1 rounded-lg bg-indigo-100 text-indigo-800 text-xs font-bold inline-block"
                            >
                              Proses realisasi
                            </Link>
                          ) : null}
                          {user?.role === 'FINANCE' && r.status === 'APPROVED' && r.type !== 'CASH_ADVANCE' ? (
                            <button type="button" onClick={() => onDisburse(r)} className="px-2 py-1 rounded-lg bg-teal-100 text-teal-700 text-xs font-bold">
                              Cairkan
                            </button>
                          ) : null}
                          {r.status === 'REJECTED' && r.requestedBy === user?.id ? (
                            <button
                              type="button"
                              onClick={() => router.push(`/cash-operation/${r.id}/edit`)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/80"
                            >
                              ✏️ Edit & Submit Ulang
                            </button>
                          ) : null}
                          <Link href={`/cash-operation/${r.id}`} className="text-xs font-bold text-[#00D4B4]">
                            Detail
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination total={metaTotal} page={page} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {approveDetail && approveRow ? (
        <ApprovalDialog
          isOpen
          onClose={() => {
            setApproveRow(null);
            setApproveDetail(null);
          }}
          onConfirm={async (approvedAmount, notes) => {
            await apiPost(`/cash-operation/${approveDetail.id}/approve`, {
              action: 'APPROVE',
              approvedAmount,
              notes,
            });
            toast.success('Request disetujui');
            setApproveRow(null);
            setApproveDetail(null);
            void load();
          }}
          cashOp={approveDetail}
          approvalSteps={approveDetail.approvalSteps}
          currentStepOrder={
            approveDetail.approvalSteps.find(
              (s) =>
                s.status === 'PENDING' &&
                s.approverRole === (approveDetail.currentApproverRole ?? approveDetail.currentStepRole ?? ''),
            )?.stepOrder ??
            approveDetail.approvalSteps.find((s) => s.status === 'PENDING')?.stepOrder ??
            1
          }
        />
      ) : null}
    </div>
  );
}
