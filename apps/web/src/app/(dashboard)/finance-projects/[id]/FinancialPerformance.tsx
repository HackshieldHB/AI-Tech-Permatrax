'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPostForm, fixFileUrl } from '../../../../lib/api';
import { formatRupiah } from '../../../../lib/format';
import type { FinanceProjectDetail } from '../../../../types/api.types';
import { num } from '../_lib/num';

type PoHistoryItem = {
  id: string;
  previousAmount: string | number | null;
  proposedAmount: string | number;
  previousPoNumber?: string | null;
  proposedPoNumber?: string | null;
  docUrl: string | null;
  reason: string | null;
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  submittedBy?: { id: string; name: string } | null;
  reviewedBy?: { id: string; name: string } | null;
};

type Props = {
  detail: FinanceProjectDetail;
  canEdit: boolean;
  isGm: boolean;
  onRefresh: () => void;
};

export function FinancialPerformance({ detail, canEdit, isGm, onRefresh }: Props) {
  const [history, setHistory] = useState<PoHistoryItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [poNumber, setPoNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const po = detail.poCustomerAmount != null ? detail.poCustomerAmount : num(detail.poCustomer);
  const rab = detail.totalRab != null ? detail.totalRab : num(detail.totalBudget);
  const actual = detail.actualCost != null ? detail.actualCost : (detail.totalSpent != null ? num(detail.totalSpent) : 0);
  // Integra V5: Estimasi Profit/Loss = PO Customer − Estimated Cost (RAB) — NOT PO − Actual Cost
  const estimasi =
    detail.estimatedMargin != null
      ? detail.estimatedMargin
      : (po != null && !Number.isNaN(po) ? po - rab : null);
  const actualPl = po != null && !Number.isNaN(po) ? po - actual : null;
  const isSegment = detail.hierarchyLevel === 'SEGMENT';
  const pending = detail.poApprovalStatus === 'PENDING';

  const loadHistory = useCallback(async () => {
    try {
      const rows = await apiGet<PoHistoryItem[]>(`/finance-projects/${detail.id}/po-history`);
      setHistory(rows);
    } catch {
      setHistory([]);
    }
  }, [detail.id]);

  useEffect(() => {
    if (canEdit || isGm) void loadHistory();
  }, [canEdit, isGm, loadHistory]);

  const openModal = () => {
    setPoNumber(detail.poCustomerNumber ?? '');
    setAmount(po != null && !Number.isNaN(po) ? String(Math.round(po)) : '');
    setReason('');
    setFile(null);
    setModalOpen(true);
  };

  const submitPo = async () => {
    if (!poNumber.trim()) { toast.error('Nomor PO Customer wajib diisi'); return; }
    const n = Number(String(amount).replace(/\./g, '').replace(/,/g, '.'));
    if (!n || n <= 0) { toast.error('Nominal PO Customer wajib diisi'); return; }
    if (!file) { toast.error('Dokumen PO Customer wajib diunggah'); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(n));
      fd.append('poNumber', poNumber.trim());
      if (reason.trim()) fd.append('reason', reason.trim());
      fd.append('file', file);
      await apiPostForm(`/finance-projects/${detail.id}/po-customer`, fd);
      toast.success('Pengajuan PO Customer dikirim ke GM');
      setModalOpen(false);
      onRefresh();
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengajukan PO');
    } finally {
      setSubmitting(false);
    }
  };

  const reviewApprove = async (requestId: string) => {
    setReviewingId(requestId);
    try {
      await apiPost(`/finance-projects/${detail.id}/po-customer/${requestId}/review`, { decision: 'APPROVE' });
      toast.success('PO Customer disetujui');
      onRefresh();
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses');
    } finally {
      setReviewingId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectModalId) return;
    if (!rejectReason.trim()) { toast.error('Alasan penolakan wajib diisi'); return; }
    setReviewingId(rejectModalId);
    try {
      await apiPost(`/finance-projects/${detail.id}/po-customer/${rejectModalId}/review`, {
        decision: 'REJECT',
        reviewNote: rejectReason.trim(),
      });
      toast.success('PO Customer ditolak');
      setRejectModalId(null);
      setRejectReason('');
      onRefresh();
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses');
    } finally {
      setReviewingId(null);
    }
  };

  const profitColor = estimasi == null ? '#57606a' : estimasi > 0 ? '#1a7f37' : estimasi < 0 ? '#cf222e' : '#57606a';
  // Integra V5: status + Estimasi amount both use PO − RAB
  const statusLabel =
    estimasi == null ? '—' : estimasi > 0 ? '🟢 Profit' : estimasi < 0 ? '🔴 Loss' : 'Break Even';
  const estimasiLabel =
    estimasi == null
      ? null
      : estimasi > 0
        ? `Estimasi Profit: ${formatRupiah(estimasi)}`
        : estimasi < 0
          ? `Estimasi Loss: ${formatRupiah(Math.abs(estimasi))}`
          : 'Estimasi: Rp0';
  const actualPlLabel =
    actualPl == null
      ? null
      : `Actual P/L: ${formatRupiah(actualPl)}`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-base">Financial Performance</h3>
        {canEdit && !isSegment && (
          <button
            type="button"
            onClick={openModal}
            disabled={pending}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-white disabled:opacity-50"
          >
            {po != null && !Number.isNaN(po) ? 'Edit PO Customer' : 'Input PO Customer'}
          </button>
        )}
      </div>

      {pending ? (
        <div className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Pengajuan PO menunggu approval General Manager
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">PO Customer</div>
          <div className="font-bold text-slate-900 mt-0.5">
            {po != null && !Number.isNaN(po) ? formatRupiah(po) : '—'}
          </div>
          {detail.poCustomerNumber ? (
            <div className="text-[11px] text-slate-600 mt-0.5 font-medium">{detail.poCustomerNumber}</div>
          ) : null}
          {detail.poCustomerDocUrl ? (
            <a href={fixFileUrl(detail.poCustomerDocUrl)} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600">
              Lihat dokumen ↗
            </a>
          ) : null}
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">
            {isSegment ? 'Total RAB (Segment)' : 'Estimated Cost (RAB)'}
          </div>
          <div className="font-bold text-slate-900 mt-0.5">{formatRupiah(rab)}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">Actual Cost</div>
          <div className="font-bold text-slate-900 mt-0.5">{formatRupiah(actual)}</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500 font-semibold uppercase">
            {isSegment ? 'Profit Segment' : 'Estimasi P/L'}
          </div>
          <div className="font-bold mt-0.5" style={{ color: profitColor }}>{statusLabel}</div>
          {estimasiLabel ? (
            <div className="text-[11px] mt-1 font-semibold" style={{ color: profitColor }}>
              {estimasiLabel}
            </div>
          ) : null}
          {actualPlLabel && actual > 0 ? (
            <div className="text-[10px] mt-1 text-slate-500">{actualPlLabel}</div>
          ) : null}
        </div>
      </div>

      {(canEdit || isGm) && history.length > 0 ? (
        <div>
          <div className="text-xs font-bold text-slate-600 mb-2">Riwayat PO Customer</div>
          <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
            {history.slice(0, 8).map((h) => (
              <div key={h.id} className="px-3 py-2 text-xs flex flex-wrap gap-2 justify-between items-start">
                <div>
                  {h.proposedPoNumber ? <div className="font-semibold text-slate-800">{h.proposedPoNumber}</div> : null}
                  <span className="font-semibold">{formatRupiah(Number(h.proposedAmount))}</span>
                  {h.previousAmount != null ? (
                    <span className="text-slate-400"> ← {formatRupiah(Number(h.previousAmount))}</span>
                  ) : null}
                  <span className="ml-2 text-slate-500">{h.status}</span>
                  {h.submittedBy?.name ? <span className="text-slate-400"> · {h.submittedBy.name}</span> : null}
                  {h.status === 'REJECTED' && h.reviewNote ? (
                    <div className="text-red-700 mt-1">Alasan reject: {h.reviewNote}</div>
                  ) : null}
                </div>
                {isGm && h.status === 'PENDING' ? (
                  <div className="flex gap-2 flex-wrap">
                    {h.docUrl ? (
                      <a
                        href={fixFileUrl(h.docUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-800 font-bold no-underline"
                      >
                        Lihat Dokumen
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={reviewingId === h.id}
                      onClick={() => void reviewApprove(h.id)}
                      className="px-2 py-1 rounded bg-emerald-600 text-white font-bold"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === h.id}
                      onClick={() => { setRejectModalId(h.id); setRejectReason(''); }}
                      className="px-2 py-1 rounded bg-red-600 text-white font-bold"
                    >
                      Reject
                    </button>
                  </div>
                ) : h.docUrl ? (
                  <a
                    href={fixFileUrl(h.docUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-blue-600 font-semibold"
                  >
                    Lihat Dokumen ↗
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h4 className="font-bold text-slate-900">Ajukan Approval PO Customer</h4>
            <p className="text-xs text-slate-500">
              Perubahan tidak langsung tersimpan. Ajukan ke GM untuk approval.
            </p>
            <label className="block text-xs font-semibold text-slate-600">
              Nomor PO Customer <span className="text-red-600">*</span>
              <input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Contoh: PO/BIZ/2026/00125"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Nominal PO Customer <span className="text-red-600">*</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="Contoh: 13800000"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Keterangan (opsional)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              Dokumen PO <span className="text-red-600">*</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-xs"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-2 text-sm rounded-lg border">
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitPo()}
                className="px-3 py-2 text-sm rounded-lg bg-[#00D4B4] text-slate-900 font-bold"
              >
                {submitting ? 'Mengirim…' : 'Ajukan Approval'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectModalId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h4 className="font-bold text-slate-900">Alasan Penolakan PO</h4>
            <p className="text-xs text-slate-500">Alasan penolakan wajib diisi agar Finance dapat merevisi.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Tuliskan alasan penolakan…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setRejectModalId(null)} className="px-3 py-2 text-sm rounded-lg border">
                Batal
              </button>
              <button
                type="button"
                disabled={reviewingId === rejectModalId}
                onClick={() => void submitReject()}
                className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white font-bold"
              >
                {reviewingId === rejectModalId ? 'Memproses…' : 'Reject PO'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
