'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPatch, apiPost } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import type { CashOperationRequest, CashOpApprovalStep, RealisasiBundle, RealisasiStatus } from '../../../../types/api.types';
import { REALISASI_STATUS_LABELS } from '../../../../types/api.types';
import {
  formatDateId,
  formatRealisasiOpenAt,
  formatRupiah,
  isRealisasiOpen,
} from '../../../../lib/cash-op-utils';
import { ApprovalDialog } from '../../../../components/cash-op/ApprovalDialog';
import { RealisasiForm, type RealisasiItemInput } from '../../../../components/cash-op/RealisasiForm';
import { RealisasiTimeline } from '../../../../components/cash-op/RealisasiTimeline';

type ApprovalStepRow = CashOpApprovalStep;

function itemsToDraftPayload(items: RealisasiItemInput[]) {
  return {
    items: items.map((i) => ({
      itemNumber: i.itemNumber,
      description: i.description.trim(),
      paymentDate: new Date(`${i.paymentDate}T12:00:00.000Z`).toISOString(),
      amount: i.amount,
      photoUrl: i.photoUrl ?? undefined,
    })),
  };
}

const REALISASI_REJECTION_LABELS: Record<string, string> = {
  REALISASI_REJECTED_BY_OPS: 'Ops Manager',
  REALISASI_REJECTED_BY_FINANCE: 'Finance',
  REALISASI_REJECTED_BY_GM: 'General Manager',
  REALISASI_REJECTED_BY_MARKETING_HEAD: 'Marketing Head',
  REALISASI_REJECTED_BY_PM: 'PM Senior',
};

async function refreshAfterApproval(
  loadDetailFn: () => Promise<unknown>,
  loadBundleFn: () => Promise<void>,
) {
  try {
    await loadDetailFn();
    await loadBundleFn();
  } catch {
    window.location.reload();
  }
}

function isHttpSuccessError(e: unknown): boolean {
  const err = e as Error & { status?: number };
  return typeof err.status === 'number' && err.status >= 200 && err.status < 300;
}

export default function CashOperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [detail, setDetail] = useState<CashOperationRequest | null>(null);
  const [bundle, setBundle] = useState<RealisasiBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [realisasiRejectOpen, setRealisasiRejectOpen] = useState(false);
  const [realisasiRejectReason, setRealisasiRejectReason] = useState('');
  const [opsNotes, setOpsNotes] = useState('');
  const [opsRejectOpen, setOpsRejectOpen] = useState(false);
  const [marketingHeadNotes, setMarketingHeadNotes] = useState('');
  const [marketingHeadRejectOpen, setMarketingHeadRejectOpen] = useState(false);
  const [financeRejectOpen, setFinanceRejectOpen] = useState(false);
  const [nomorRekeningFinance, setNomorRekeningFinance] = useState('');
  const [activeTab, setActiveTab] = useState<'detail' | 'summary'>('detail');
  const [showRevisasiForm, setShowRevisasiForm] = useState(false);
  const [gmRejectOpen, setGmRejectOpen] = useState(false);

  const [pmNotes, setPmNotes] = useState('');
  const [gmNotes, setGmNotes] = useState('');
  const [showPmRejectModal, setShowPmRejectModal] = useState(false);

  const loadDetail = useCallback(
    async (opts?: { silent?: boolean }): Promise<CashOperationRequest | null> => {
      if (!opts?.silent) setLoading(true);
      try {
        const data = await apiGet<CashOperationRequest>(`/cash-operation/${id}`);
        setDetail(data);
        return data;
      } catch {
        if (!opts?.silent) toast.error('Gagal memuat detail');
        setDetail(null);
        return null;
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [id],
  );

  const loadBundle = useCallback(async () => {
    if (!id) return;
    setBundleLoading(true);
    try {
      const b = await apiGet<RealisasiBundle>(`/cash-operation/${id}/realisasi`);
      setBundle(b);
    } catch {
      setBundle(null);
    } finally {
      setBundleLoading(false);
    }
  }, [id]);

  /** Synchronous guard — avoids double-submit before React re-renders `saving`. */
  const actionBusyRef = useRef(false);
  const runExclusive = async (fn: () => Promise<void>) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true;
    setSaving(true);
    try {
      await fn();
    } finally {
      actionBusyRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    if (id) void loadDetail();
  }, [id, loadDetail]);

  useEffect(() => {
    if (detail?.type === 'CASH_ADVANCE') void loadBundle();
    else setBundle(null);
  }, [detail?.type, detail?.status, detail?.realisasiStatus, loadBundle]);

  const activeStepRole = detail?.currentApproverRole ?? detail?.currentStepRole;
  const canActStep =
    !!detail &&
    ['SUBMITTED', 'IN_REVIEW'].includes(detail.status) &&
    !!user?.role &&
    !!activeStepRole &&
    (user.role === activeStepRole ||
      (user.role === 'PM_SENIOR' && ['PM_FTTH', 'PM_FTTB', 'PM_FTTT'].includes(activeStepRole)));

  const pendingApprovalStep = useMemo((): ApprovalStepRow | undefined => {
    if (!detail?.approvalSteps?.length) return undefined;
    const role = detail.currentApproverRole ?? detail.currentStepRole;
    const byRole = detail.approvalSteps.find((s) => s.status === 'PENDING' && s.approverRole === role);
    return byRole ?? detail.approvalSteps.find((s) => s.status === 'PENDING');
  }, [detail]);

  const currentStepOrder = pendingApprovalStep?.stepOrder ?? 1;

  const legacyDisburse =
    !!detail &&
    user?.role === 'FINANCE' &&
    detail.status === 'APPROVED' &&
    detail.finalApprovedAmount == null &&
    detail.type !== 'CASH_ADVANCE';

  const cashOpForUi: CashOperationRequest | null = bundle?.cashOp ?? detail;

  const realisasiStatus = (bundle?.cashOp?.realisasiStatus ?? detail?.realisasiStatus) as RealisasiStatus | null;

  const financeRealisasiAct =
    user?.role === 'FINANCE' && realisasiStatus === 'PENDING_FINANCE_REVIEW';
  const marketingHeadRealisasiAct =
    user?.role === 'MARKETING_HEAD' && realisasiStatus === 'PENDING_MARKETING_HEAD_REVIEW';

  const showApprovedCaBanner =
    !!detail && detail.type === 'CASH_ADVANCE' && detail.status === 'APPROVED' && !realisasiStatus;

  const showStage2Section =
    !!detail &&
    detail.type === 'CASH_ADVANCE' &&
    (detail.status === 'APPROVED' ||
      detail.status === 'REALISASI_IN_PROGRESS' ||
      detail.status === 'DONE' ||
      !!realisasiStatus);

  const realisasiItems = bundle?.items ?? [];
  const totalFinalRealisasi = realisasiItems.reduce(
    (sum, item) => sum + Number(item.finalAmount ?? item.amount ?? 0),
    0,
  );

  const onApproveStage1 = async (approvedAmount: number, approvalNotes?: string) => {
    if (!detail) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${detail.id}/approve`, {
          action: 'APPROVE',
          notes: approvalNotes,
          approvedAmount,
        });
        toast.success('Request disetujui');
        setApprovalOpen(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };

  const onRejectStage1 = async () => {
    if (!detail) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${detail.id}/approve`, {
          action: 'REJECT',
          notes: rejectReason.trim(),
        });
        toast.success('Request ditolak');
        setRejectOpen(false);
        setRejectReason('');
        await loadDetail();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses');
      }
    });
  };

  const onSaveRealisasiDraft = async (items: RealisasiItemInput[]) => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/draft`, itemsToDraftPayload(items));
        toast.success('Draft realisasi tersimpan');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal menyimpan draft');
      }
    });
  };

  const onSubmitRealisasi = async (items: RealisasiItemInput[]) => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/draft`, itemsToDraftPayload(items));
        await apiPost(`/cash-operation/${id}/realisasi/submit`, {});
        toast.success('Realisasi diajukan');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal mengajukan');
      }
    });
  };

  const onRealisasiApproveFinance = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-finance`, { notes: notes.trim() || undefined });
        toast.success('Pengajuan berhasil di-approve');
        setNotes('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const onRealisasiRejectFinance = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Pengajuan berhasil ditolak');
        setRealisasiRejectOpen(false);
        setRealisasiRejectReason('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleOpsApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-ops`, { notes: opsNotes.trim() || undefined });
        toast.success('Pengajuan berhasil di-approve');
        setOpsNotes('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleOpsReject = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-ops`, { reason: realisasiRejectReason.trim() });
        toast.success('Pengajuan berhasil ditolak');
        setOpsRejectOpen(false);
        setRealisasiRejectReason('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleMarketingHeadApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve`, {
          notes: marketingHeadNotes.trim() || undefined,
        });
        toast.success('Pengajuan berhasil di-approve');
        setMarketingHeadNotes('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleMarketingHeadReject = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject`, {
          reason: realisasiRejectReason.trim(),
        });
        toast.success('Pengajuan berhasil ditolak');
        setMarketingHeadRejectOpen(false);
        setRealisasiRejectReason('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleFinanceApprove = async () => {
    if (!id) return;
    if (!nomorRekeningFinance.trim()) {
      toast.error('Nomor rekening tujuan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPatch(`/cash-operation/${id}/realisasi/finance-review`, {
          nomorRekeningFinance: nomorRekeningFinance.trim(),
        });
        toast.success('Pengajuan berhasil di-approve');
        setNomorRekeningFinance('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (err: unknown) {
        if (!isHttpSuccessError(err)) {
          toast.error(err instanceof Error ? err.message : 'Gagal memproses approval');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleFinanceReject = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Pengajuan berhasil ditolak');
        setFinanceRejectOpen(false);
        setRealisasiRejectReason('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handlePmApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-pm`, { notes: pmNotes || undefined });
        toast.success('Pengajuan berhasil di-approve');
        setPmNotes('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handlePmReject = async (reason: string) => {
    if (!id || !reason.trim()) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-pm`, { reason: reason.trim() });
        toast.success('Pengajuan berhasil ditolak');
        setShowPmRejectModal(false);
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const handleGmApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-gm`, { notes: gmNotes.trim() || undefined });
        toast.success('Pengajuan berhasil di-approve');
        setGmNotes('');
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const onResubmitRealisasi = async (items: RealisasiItemInput[]) => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/resubmit`, itemsToDraftPayload(items));
        toast.success('Realisasi berhasil diajukan ulang');
        setShowRevisasiForm(false);
        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
      } catch (e: unknown) {
        if (!isHttpSuccessError(e)) {
          toast.error(e instanceof Error ? e.message : 'Gagal mengajukan ulang');
        } else {
          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
        }
      }
    });
  };

  const canRepairCashOpApproval =
    user?.role === 'ADMIN' || user?.role === 'GENERAL_MANAGER' || user?.role === 'FINANCE';

  const onRepairCashOpApproval = async () => {
    if (!detail?.id || !canRepairCashOpApproval) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${detail.id}/repair-approval`, {});
        toast.success('Langkah approval diperbarui dari approvalChain');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memperbaiki approval');
      }
    });
  };

  if (loading) return <div className="p-8 text-slate-500">Memuat...</div>;
  if (!detail) return <div className="p-8 text-slate-500">Request tidak ditemukan</div>;

  const isRealisasiRejected = Object.keys(REALISASI_REJECTION_LABELS).includes(detail.status);
  const realisasiRejectedByLabel = REALISASI_REJECTION_LABELS[detail.status] ?? 'Approver';

  const slaDeadlineMs = detail.slaDeadline ? new Date(detail.slaDeadline).getTime() : NaN;
  const slaInfo =
    detail.slaDeadline == null
      ? '—'
      : detail.slaBreached
        ? 'LEWAT SLA'
        : Number.isNaN(slaDeadlineMs)
          ? '—'
          : `${Math.ceil((slaDeadlineMs - Date.now()) / (1000 * 60 * 60 * 24))} hari lagi`;
  const settlementBase = detail.finalApprovedAmount ?? detail.amount;
  const settlementFallback = !detail.finalApprovedAmount;
  const settlementDiff = Number(detail.realisasiTotal ?? 0) - Number(settlementBase);
  const selisih = totalFinalRealisasi - Number(detail.finalApprovedAmount ?? detail.amount ?? 0);

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">{detail.requestNumber}</p>
              <h1 className="text-xl font-black text-slate-900 mt-1">
                {detail.type === 'CASH_ADVANCE' ? 'Cash Advance' : 'Reimbursement'}
              </h1>
            </div>
            <Link href="/cash-operation" className="text-sm font-bold text-[#00D4B4]">
              Kembali
            </Link>
          </div>
          <p className="mt-4 text-sm text-slate-700 whitespace-pre-wrap">{detail.description}</p>
          {detail.finalApprovedAmount != null && Number(detail.finalApprovedAmount) !== Number(detail.amount) ? (
            <div className="mt-4 flex flex-wrap gap-8">
              <div>
                <p className="text-sm text-slate-500">Total Pengajuan Awal</p>
                <p className="text-xl font-black text-slate-500 line-through">Rp {formatRupiah(detail.amount)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Total Disetujui</p>
                <p className="text-2xl font-black text-teal-600">Rp {formatRupiah(detail.finalApprovedAmount)}</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-3xl font-black text-slate-900">Rp {formatRupiah(detail.amount)}</p>
          )}
          {detail.type === 'CASH_ADVANCE' && (detail.periodeFrom || detail.periodeTo) ? (
            <p className="mt-2 text-sm text-slate-600">
              Periode penggunaan: {formatDateId(detail.periodeFrom)} — {formatDateId(detail.periodeTo)}
            </p>
          ) : null}
          {detail.nomorRekeningPengaju ? (
            <p className="mt-2 text-sm text-slate-600">
              Nomor Rekening Pengaju: {detail.nomorRekeningPengaju}
            </p>
          ) : null}
          {realisasiStatus ? (
            <p className="mt-2 text-sm">
              <span className="font-bold">Realisasi:</span>{' '}
              {REALISASI_STATUS_LABELS[realisasiStatus]?.label ?? realisasiStatus}
            </p>
          ) : null}
          {realisasiStatus === 'REJECTED' && (bundle?.cashOp.realisasiRejectionReason || detail.realisasiRejectionReason) ? (
            <p className="mt-2 text-sm text-red-600">
              Alasan penolakan: {bundle?.cashOp.realisasiRejectionReason ?? detail.realisasiRejectionReason}
            </p>
          ) : null}
          <div className="mt-3 text-xs text-slate-500 flex flex-wrap gap-3">
            <span>Kategori: {detail.category ?? '—'}</span>
            <span>Ref Proyek: {detail.financeProject?.name || detail.projectRef || '—'}</span>
            <span>Dibuat: {formatDateId(detail.createdAt)}</span>
          </div>

          <div className="flex gap-4 border-b border-slate-200 mt-6">
            <button
              onClick={() => setActiveTab('detail')}
              className={`pb-2 font-bold text-sm border-b-2 ${activeTab === 'detail' ? 'border-[#0F1B2D] text-[#0F1B2D]' : 'border-transparent text-slate-500'}`}
            >
              Detail & Realisasi
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-2 font-bold text-sm border-b-2 ${activeTab === 'summary' ? 'border-[#0F1B2D] text-[#0F1B2D]' : 'border-transparent text-slate-500'}`}
            >
              📊 Summary Settlement
            </button>
          </div>
        </div>

        {activeTab === 'detail' && (
          <>

        {detail?.approvalDebug?.repairSuggestion &&
        ['SUBMITTED', 'IN_REVIEW'].includes(detail.status) ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-950 mb-4">
            <p className="font-bold">Peringatan: data langkah approval tidak selaras</p>
            <p className="mt-1 text-amber-900/95">{detail.approvalDebug.repairSuggestion}</p>
            {canRepairCashOpApproval ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onRepairCashOpApproval()}
                className="mt-3 px-3 py-2 rounded-xl bg-amber-900 text-white text-sm font-bold disabled:opacity-50"
              >
                Perbaiki langkah approval dari approvalChain
              </button>
            ) : null}
          </div>
        ) : null}

        {showApprovedCaBanner ? (
          <CashAdvanceApprovedBanner cashOp={detail} onReload={() => void loadBundle()} />
        ) : null}

        {showStage2Section ? (
          <div id="realisasi-section" className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h2 className="font-black text-slate-900">Tahap 2 — Realisasi</h2>
            {bundleLoading ? (
              <p className="text-sm text-slate-500">Memuat data realisasi…</p>
            ) : bundle && cashOpForUi ? (
              <>
                {(() => {
                  const owner = user?.id === cashOpForUi.requestedBy;
                  const windowOpen = bundle.isWindowOpen;
                  const rs = realisasiStatus;
                  const editable =
                    owner &&
                    (rs === null || rs === 'DRAFT' || rs === 'REJECTED') &&
                    (detail?.status === 'APPROVED' || detail?.status === 'REALISASI_IN_PROGRESS') &&
                    (windowOpen || rs === 'REJECTED');

                  const showWaitMessage =
                    owner &&
                    (rs === null || rs === 'DRAFT') &&
                    !windowOpen &&
                    (detail?.status === 'APPROVED' || detail?.status === 'REALISASI_IN_PROGRESS');

                  return (
                    <>
                      {showWaitMessage ? (
                        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-sm text-slate-700">
                          Pengisian realisasi dibuka mulai <strong>{formatRealisasiOpenAt(bundle.cashOp.periodeTo)}</strong>{' '}
                          (prediksi zona WIB — keputusan akhir di server).
                        </div>
                      ) : null}

                      {editable ? (
                        <RealisasiForm
                          cashOp={cashOpForUi}
                          initialItems={bundle.items}
                          onSaveDraft={onSaveRealisasiDraft}
                          onSubmit={onSubmitRealisasi}
                          isReadOnly={false}
                        />
                      ) : (bundle.items?.length ?? 0) > 0 || (rs != null && rs !== 'DRAFT') ? (
                        <RealisasiForm
                          cashOp={cashOpForUi}
                          initialItems={bundle.items}
                          onSaveDraft={async () => {}}
                          onSubmit={async () => {}}
                          isReadOnly
                        />
                      ) : null}
                    </>
                  );
                })()}

                <div>
                  <h3 className="font-bold text-slate-800 mb-2">Alur persetujuan realisasi</h3>
                  <RealisasiTimeline steps={bundle.steps} />
                </div>

                {financeRealisasiAct ? (
                  <div className="border rounded-xl p-4 space-y-4">
                    <h3 className="font-medium">💰 Review Realisasi — Finance</h3>
                    <div className="space-y-2 text-sm">
                      {realisasiItems.map((item) => (
                        <div key={item.id} className="flex justify-between border-b py-2">
                          <span>{item.description}</span>
                          <span>{formatRupiah(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Nomor Rekening Tujuan <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Rekening tujuan transfer kelebihan dana"
                        value={nomorRekeningFinance}
                        onChange={(e) => setNomorRekeningFinance(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                      <p className="text-xs text-gray-500">Wajib diisi sebelum melakukan approval.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleFinanceApprove()}
                        disabled={saving || !nomorRekeningFinance.trim()}
                        className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        ✅ Approve
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setRealisasiRejectReason('');
                          setFinanceRejectOpen(true);
                        }}
                        className="flex-1 border border-red-500 text-red-500 rounded-lg py-2 text-sm"
                      >
                        âŒ Tolak
                      </button>
                    </div>
                  </div>
                ) : null}

                {detail.status === 'REALISASI_DONE' && user?.id === detail.requestedBy ? (
                  <div className="border rounded-xl p-4 space-y-3 bg-green-50 border-green-200">
                    <h3 className="font-medium text-green-800">✅ Realisasi Disetujui</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Nominal Disetujui</span>
                        <span className="font-medium">{formatRupiah(detail.finalApprovedAmount ?? detail.amount)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Realisasi Final</span>
                        <span className="font-medium">{formatRupiah(totalFinalRealisasi)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600">Selisih</span>
                        <span className={selisih < 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                          {selisih < 0 ? '▼' : '▲'} {formatRupiah(Math.abs(selisih))}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {detail.realisasiNomorRekeningFinance && (
                        <div className="bg-white border border-green-300 rounded-lg p-3 text-sm">
                          <p className="text-green-700 font-medium">Rekening Finance (untuk kelebihan dana):</p>
                          <p className="font-mono text-lg mt-1">🏦 {detail.realisasiNomorRekeningFinance}</p>
                        </div>
                      )}
                      {detail.nomorRekeningPengaju && (
                        <div className="bg-white border border-primary/30 rounded-lg p-3 text-sm">
                          <p className="text-primary font-medium">Rekening Pengaju:</p>
                          <p className="font-mono text-lg mt-1">🏦 {detail.nomorRekeningPengaju}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {isRealisasiRejected && user?.id === detail.requestedBy ? (
                  <div className="border rounded-xl p-4 space-y-3 bg-red-50 border-red-200">
                    <h3 className="font-medium text-red-800">âŒ Realisasi Ditolak</h3>
                    <p className="text-sm text-gray-600">Ditolak oleh: {realisasiRejectedByLabel}</p>
                    <p className="text-sm bg-white border border-red-200 rounded-lg p-3">
                      {detail.realisasiRejectedReason ?? detail.realisasiRejectionReason ?? 'Tidak ada alasan diberikan.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowRevisasiForm(true)}
                      className="w-full border border-primary text-primary rounded-lg py-2 text-sm font-medium"
                    >
                      Revisi & Ajukan Ulang
                    </button>
                  </div>
                ) : null}

                {showRevisasiForm && isRealisasiRejected && user?.id === detail.requestedBy && cashOpForUi ? (
                  <div className="border rounded-xl p-4 space-y-3 bg-white border-slate-200">
                    <div className="flex justify-between items-center">
                      <h3 className="font-black text-slate-900">Revisi Rincian Realisasi</h3>
                      <button
                        type="button"
                        onClick={() => setShowRevisasiForm(false)}
                        className="text-slate-400 hover:text-slate-600 text-sm"
                      >
                        Tutup
                      </button>
                    </div>
                    <RealisasiForm
                      cashOp={cashOpForUi}
                      initialItems={realisasiItems}
                      onSaveDraft={onSaveRealisasiDraft}
                      onSubmit={onResubmitRealisasi}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">Tidak dapat memuat bundle realisasi.</p>
            )}

            {/* â”€â”€ Approval action cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                Rendered OUTSIDE the bundle block so they appear even when the
                bundle is still loading or failed to fetch.
                Conditions use realisasiStatus (consistent with Finance/GM pattern). */}

            {/* PM Senior */}
            {realisasiStatus === 'PENDING_PM_REVIEW' && user?.role === 'PM_SENIOR' && (
              <div className="border rounded-xl p-4 space-y-3 bg-primary/10 border-primary/20">
                <h3 className="font-medium text-primary">
                  📋 Realisasi Menunggu Approval PM Senior
                </h3>
                <div className="space-y-2 text-sm">
                  {realisasiItems.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.description}</span>
                      <span className="font-medium">{formatRupiah(item.amount)}</span>
                    </div>
                  ))}
                </div>
                <textarea
                  placeholder="Catatan (opsional)"
                  className="w-full border rounded-lg p-2 text-sm"
                  rows={2}
                  value={pmNotes}
                  onChange={e => setPmNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handlePmApprove()}
                    className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                  >
                    ✅ Approve
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setShowPmRejectModal(true)}
                    className="flex-1 border border-red-500 text-red-500 rounded-lg py-2 text-sm font-medium"
                  >
                    âŒ Tolak
                  </button>
                </div>
              </div>
            )}

            {marketingHeadRealisasiAct && (
              <div className="border border-amber-200 rounded-xl p-4 space-y-3 bg-amber-50 mb-3">
                <h3 className="font-medium text-amber-900">Approval Marketing Head</h3>
                <label className="text-sm font-semibold">Catatan (opsional)</label>
                <textarea
                  value={marketingHeadNotes}
                  onChange={(e) => setMarketingHeadNotes(e.target.value)}
                  rows={3}
                  className="w-full mt-1.5 mb-3 p-2 border border-gray-300 rounded-lg text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleMarketingHeadApprove()}
                    disabled={saving}
                    className="flex-1 py-2.5 px-4 bg-green-600 text-white border-none rounded-lg font-semibold disabled:opacity-50"
                  >
                    ✅“ Setuju
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarketingHeadRejectOpen(true)}
                    disabled={saving}
                    className="flex-1 py-2.5 px-4 bg-red-600 text-white border-none rounded-lg font-semibold disabled:opacity-50"
                  >
                    ✗ Tolak
                  </button>
                </div>
                {marketingHeadRejectOpen && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      placeholder="Alasan penolakan..."
                      value={realisasiRejectReason}
                      onChange={(e) => setRealisasiRejectReason(e.target.value)}
                      rows={3}
                      className="w-full p-2 border border-red-300 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void handleMarketingHeadReject()}
                      disabled={saving || !realisasiRejectReason.trim()}
                      className="py-2 px-4 bg-red-600 text-white border-none rounded-md disabled:opacity-50"
                    >
                      Konfirmasi Tolak
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Ops Manager */}
            {realisasiStatus === 'PENDING_OPS_REVIEW' && user?.role === 'OPERATIONAL_MANAGER' && (
              <div className="border rounded-xl p-4 space-y-3">
                <h3 className="font-medium">📋 Realisasi Menunggu Persetujuan Anda (Ops Manager)</h3>
                {realisasiItems.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span>{item.description}</span>
                    <span>{formatRupiah(item.amount)}</span>
                  </div>
                ))}
                <textarea
                  placeholder="Catatan (opsional)"
                  value={opsNotes}
                  onChange={(e) => setOpsNotes(e.target.value)}
                  className="w-full border rounded-lg p-2 text-sm"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleOpsApprove()}
                    className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-green-700"
                  >
                    ✅ Approve
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => { setRealisasiRejectReason(''); setOpsRejectOpen(true); }}
                    className="flex-1 border border-red-500 text-red-500 rounded-lg py-2 text-sm font-medium"
                  >
                    âŒ Tolak
                  </button>
                </div>
              </div>
            )}

            {/* GM */}
            {realisasiStatus === 'PENDING_GM_REVIEW' && user?.role === 'GENERAL_MANAGER' && (
              <div className="border rounded-xl p-4 space-y-4 bg-purple-50 border-purple-200">
                <h3 className="font-medium text-purple-800">
                  ✍️ Approval GM — Realisasi Cash Advance
                </h3>
                <div className="space-y-2 text-sm">
                  {realisasiItems.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.description}</span>
                      <span>{formatRupiah(item.amount)}</span>
                    </div>
                  ))}
                </div>
                <textarea
                  placeholder="Catatan (opsional)"
                  className="w-full border rounded-lg p-2 text-sm"
                  rows={2}
                  value={gmNotes}
                  onChange={e => setGmNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGmApprove()}
                    disabled={saving}
                    className="flex-1 bg-green-600 text-white rounded-lg py-2 text-sm disabled:opacity-50"
                  >
                    ✅ Approve
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setRealisasiRejectReason('');
                      setGmRejectOpen(true);
                    }}
                    className="flex-1 border border-red-500 text-red-500 rounded-lg py-2 text-sm"
                  >
                    âŒ Tolak
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-black text-slate-900 mb-3">Lampiran</h2>
          {detail.attachments.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada lampiran</p>
          ) : (
            <ul className="space-y-2">
              {detail.attachments.map((a) => (
                <li key={a.id} className="text-sm flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                  <span>{a.fileName}</span>
                  <a
                    href={a.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#00D4B4] font-bold text-xs"
                  >
                    Unduh
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
        )}

        {activeTab === 'summary' && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h2 className="font-black text-slate-900 mb-4">Summary Settlement</h2>
            {detail.realisasiStatus ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold border-b border-slate-200">Komponen</th>
                      <th className="px-4 py-3 text-right font-bold border-b border-slate-200">Nominal Advance</th>
                      <th className="px-4 py-3 text-right font-bold border-b border-slate-200">Nominal Realisasi</th>
                      <th className="px-4 py-3 text-right font-bold border-b border-slate-200">Selisih</th>
                      <th className="px-4 py-3 text-center font-bold border-b border-slate-200">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-3">Total Penggunaan</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">Rp {formatRupiah(detail.finalApprovedAmount ?? detail.amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">Rp {formatRupiah(detail.realisasiTotal ?? 0)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${Number(detail.realisasiTotal ?? 0) - Number(detail.amount) > 0 ? 'text-red-600' : Number(detail.realisasiTotal ?? 0) - Number(detail.amount) < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                        Rp {formatRupiah(settlementDiff)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {(() => {
                           const selisih = settlementDiff;
                           if (selisih > 0) return <span className="px-2 py-1 bg-red-100 text-red-700 text-[10px] font-bold rounded-full">Lebih</span>;
                           if (selisih < 0) return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">Kurang</span>;
                           return <span className="px-2 py-1 bg-slate-100 text-slate-700 text-[10px] font-bold rounded-full">Sesuai</span>;
                        })()}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="pt-4">
                        <div className="flex flex-col gap-1 items-end pt-4 border-t border-slate-200">
                          <p className="text-sm">Total Advance: <span className="font-bold">Rp {formatRupiah(detail.finalApprovedAmount ?? detail.amount)}</span></p>
                          <p className="text-sm">Total Realisasi: <span className="font-bold">Rp {formatRupiah(detail.realisasiTotal ?? 0)}</span></p>
                          <p className="text-sm">Selisih Total: <span className={`font-bold ${Number(detail.realisasiTotal ?? 0) - Number(detail.amount) > 0 ? 'text-red-600' : Number(detail.realisasiTotal ?? 0) - Number(detail.amount) < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>Rp {formatRupiah(settlementDiff)}</span></p>
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-6">
                Belum ada data realisasi. Silakan lengkapi form realisasi terlebih dahulu.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-black text-slate-900 mb-3">Tahap 1 — Approval</h2>
          <div className="space-y-3">
            {detail.approvalSteps.map((s) => (
              <div key={s.id} className="flex gap-2">
                <div
                  className={`mt-1 w-2.5 h-2.5 rounded-full ${
                    s.status === 'APPROVED'
                      ? 'bg-emerald-500'
                      : s.status === 'REJECTED'
                        ? 'bg-red-500'
                        : activeStepRole === s.approverRole
                          ? 'bg-amber-500'
                          : 'bg-slate-300'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{s.approverRole.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-500">{s.status}</p>
                  {s.approvedAmount != null ? (
                    <p className="text-xs text-teal-700">Disetujui: Rp {formatRupiah(s.approvedAmount)}</p>
                  ) : null}
                  {s.approver?.name ? <p className="text-xs text-slate-500">{s.approver.name}</p> : null}
                  {s.notes ? <p className="text-xs text-slate-600 mt-1">{s.notes}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h2 className="font-black text-slate-900 mb-2">SLA</h2>
          <p className="text-sm text-slate-700">{detail.type === 'CASH_ADVANCE' ? 'Cash Advance' : 'Reimbursement'}</p>
          <p className={`text-sm font-bold mt-1 ${detail.slaBreached ? 'text-red-600' : 'text-slate-600'}`}>{slaInfo}</p>
        </div>

        {canActStep && pendingApprovalStep ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <h2 className="font-black text-slate-900">Aksi persetujuan</h2>
            <p className="text-xs text-slate-500">Gunakan dialog untuk memasukkan nominal disetujui sesuai alur persetujuan.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setApprovalOpen(true)}
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold"
              >
                Setujui…
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setRejectOpen(true)}
                className="px-3 py-2 rounded-xl border border-red-300 text-red-700 text-sm font-bold"
              >
                Tolak…
              </button>
            </div>
          </div>
        ) : null}

        {detail && ['SUBMITTED', 'IN_REVIEW'].includes(detail.status) && !pendingApprovalStep ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-950">
            <h2 className="font-black text-amber-950 mb-1">Alur approval</h2>
            <p className="text-amber-900">
              Approval step tidak ditemukan. Hubungi admin untuk memperbaiki data langkah persetujuan.
            </p>
            {detail.approvalDebug ? (
              <p className="text-xs mt-2 font-mono text-amber-900/85">
                pendingStepFound={String(detail.approvalDebug.pendingStepFound)} Â· steps{' '}
                {detail.approvalDebug.actualApprovalStepCount}/{detail.approvalDebug.expectedApprovalStepCount} Â·
                currentRole {detail.approvalDebug.currentApproverRole ?? '—'}
              </p>
            ) : null}
            {detail.approvalDebug?.repairSuggestion ? (
              <p className="text-xs mt-2 text-amber-900">{detail.approvalDebug.repairSuggestion}</p>
            ) : null}
            {detail.approvalDebug?.repairSuggestion && canRepairCashOpApproval ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onRepairCashOpApproval()}
                className="mt-3 px-3 py-2 rounded-xl bg-amber-900 text-white text-sm font-bold disabled:opacity-50"
              >
                Perbaiki langkah approval dari approvalChain
              </button>
            ) : null}
          </div>
        ) : null}

        {rejectOpen ? (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-4 border border-slate-100 shadow-xl">
              <h3 className="font-black text-slate-900 mb-2">Tolak request</h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                rows={4}
                placeholder="Alasan penolakan (wajib)"
              />
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  className="flex-1 py-2 rounded-xl border border-slate-200 font-bold text-sm"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onRejectStage1()}
                  className="flex-1 py-2 rounded-xl bg-red-600 text-white font-bold text-sm"
                >
                  Kirim penolakan
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {opsRejectOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
              <h3 className="font-black text-slate-900">Tolak Realisasi (Ops Manager)</h3>
              <textarea
                placeholder="Alasan penolakan (wajib diisi)..."
                value={realisasiRejectReason}
                onChange={(e) => setRealisasiRejectReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpsRejectOpen(false);
                    setRealisasiRejectReason('');
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpsReject()}
                  disabled={saving || !realisasiRejectReason.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
                >
                  {saving ? 'Memproses...' : 'Konfirmasi Tolak'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {financeRejectOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
              <h3 className="font-black text-slate-900">Tolak Realisasi (Finance)</h3>
              <textarea
                placeholder="Alasan penolakan (wajib diisi)..."
                value={realisasiRejectReason}
                onChange={(e) => setRealisasiRejectReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFinanceRejectOpen(false);
                    setRealisasiRejectReason('');
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleFinanceReject()}
                  disabled={saving || !realisasiRejectReason.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
                >
                  {saving ? 'Memproses...' : 'Konfirmasi Tolak'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {gmRejectOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
              <h3 className="font-black text-slate-900">Tolak Realisasi (General Manager)</h3>
              <textarea
                placeholder="Alasan penolakan (wajib diisi)..."
                value={realisasiRejectReason}
                onChange={(e) => setRealisasiRejectReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setGmRejectOpen(false);
                    setRealisasiRejectReason('');
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-700"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!id || !realisasiRejectReason.trim()) return;
                    await runExclusive(async () => {
                      try {
                        await apiPost(`/cash-operation/${id}/realisasi/reject-gm`, {
                          reason: realisasiRejectReason.trim(),
                        });
                        toast.success('Pengajuan berhasil ditolak');
                        setGmRejectOpen(false);
                        setRealisasiRejectReason('');
                        await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
                      } catch (e: unknown) {
                        if (!isHttpSuccessError(e)) {
                          toast.error(e instanceof Error ? e.message : 'Gagal');
                        } else {
                          await refreshAfterApproval(() => loadDetail({ silent: true }), loadBundle);
                        }
                      }
                    });
                  }}
                  disabled={saving || !realisasiRejectReason.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
                >
                  {saving ? 'Memproses...' : 'Konfirmasi Tolak'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {legacyDisburse ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
            <h2 className="font-black text-slate-900">Cairkan dana (legacy)</h2>
            <p className="text-xs text-slate-500">
              Alur baru tidak memerlukan pencairan manual setelah nominal final tercatat.
            </p>
          </div>
        ) : null}
      </div>

      {detail && pendingApprovalStep ? (
        <ApprovalDialog
          isOpen={approvalOpen}
          onClose={() => setApprovalOpen(false)}
          onConfirm={onApproveStage1}
          cashOp={detail}
          approvalSteps={detail.approvalSteps}
          currentStepOrder={currentStepOrder}
        />
      ) : null}
    </div>
  );
}

function CashAdvanceApprovedBanner({
  cashOp,
  onReload,
}: {
  cashOp: CashOperationRequest;
  onReload: () => void;
}) {
  const open = isRealisasiOpen(cashOp);
  const formatted = formatRealisasiOpenAt(cashOp.periodeTo);

  return (
    <div
      className={`rounded-2xl border p-5 ${
        open ? 'border-emerald-200 bg-emerald-50/80' : 'border-sky-200 bg-sky-50/80'
      }`}
    >
      <h3 className="text-lg font-black text-slate-900">Pengajuan Anda disetujui</h3>
      <p className="text-sm text-slate-700 mt-2">
        Final disetujui: Rp {formatRupiah(cashOp.finalApprovedAmount ?? cashOp.amount)}
      </p>
      <p className="text-sm text-slate-700">
        Periode: {formatDateId(cashOp.periodeFrom)} — {formatDateId(cashOp.periodeTo)}
      </p>
      {open ? (
        <button
          type="button"
          onClick={() => {
            onReload();
            const el = document.getElementById('realisasi-section');
            el?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="mt-4 px-4 py-2 rounded-xl bg-[#00D4B4] text-[#0F1B2D] text-sm font-bold"
        >
          Lapor realisasi penggunaan dana â†’
        </button>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          Tombol pengisian realisasi mengikuti jendela H+1 WIB. Perkiraan buka: <strong>{formatted}</strong>.
        </p>
      )}
    </div>
  );
}
