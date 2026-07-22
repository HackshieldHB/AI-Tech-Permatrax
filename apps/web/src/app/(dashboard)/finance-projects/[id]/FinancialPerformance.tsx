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
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const po = detail.poCustomerAmount != null ? detail.poCustomerAmount : num(detail.poCustomer);
  const rab = detail.totalRab != null ? detail.totalRab : num(detail.totalBudget);
  const actual = detail.actualCost != null ? detail.actualCost : (detail.totalSpent != null ? num(detail.totalSpent) : 0);
  const estMargin = detail.estimatedMargin != null ? detail.estimatedMargin : (po != null && !Number.isNaN(po) ? po - rab : null);
  const profit = detail.actualProfit != null ? detail.actualProfit : (po != null && !Number.isNaN(po) ? po - actual : null);
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
    setAmount(po != null && !Number.isNaN(po) ? String(Math.round(po)) : '');
    setReason('');
    setFile(null);
    setModalOpen(true);
  };

  const submitPo = async () => {
    const n = Number(String(amount).replace(/\./g, '').replace(/,/g, '.'));
    if (!n || n <= 0) { toast.error('Nominal PO Customer wajib diisi'); return; }
    if (!detail.poCustomer && !detail.poCustomerDocUrl && !file) {
      toast.error('Dokumen PO wajib diunggah untuk pengajuan pertama');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(n));
      if (reason.trim()) fd.append('reason', reason.trim());
      if (file) fd.append('file', file);
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

  const review = async (requestId: string, decision: 'APPROVE' | 'REJECT') => {
    setReviewingId(requestId);
    try {
      await apiPost(`/finance-projects/${detail.id}/po-customer/${requestId}/review`, { decision });
      toast.success(decision === 'APPROVE' ? 'PO Customer disetujui' : 'PO Customer ditolak');
      onRefresh();
      void loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memproses');
    } finally {
      setReviewingId(null);
    }
  };

  const profitColor = profit == null ? '#57606a' : profit >= 0 ? '#1a7f37' : '#cf222e';
  const profitLabel = profit == null ? '—' : `${profit >= 0 ? '🟢 Profit' : '🔴 Loss'} ${formatRupiah(Math.abs(profit))}`;

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
            {isSegment ? 'Profit Segment' : 'Actual P/L'}
          </div>
          <div className="font-bold mt-0.5" style={{ color: profitColor }}>{profitLabel}</div>
          {estMargin != null ? (
            <div className="text-[11px] text-slate-500 mt-1">
              Estimasi Margin: {formatRupiah(estMargin)}
            </div>
          ) : null}
        </div>
      </div>

      {(canEdit || isGm) && history.length > 0 ? (
        <div>
          <div className="text-xs font-bold text-slate-600 mb-2">Riwayat PO Customer</div>
          <div className="border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
            {history.slice(0, 8).map((h) => (
              <div key={h.id} className="px-3 py-2 text-xs flex flex-wrap gap-2 justify-between items-center">
                <div>
                  <span className="font-semibold">{formatRupiah(Number(h.proposedAmount))}</span>
                  {h.previousAmount != null ? (
                    <span className="text-slate-400"> ← {formatRupiah(Number(h.previousAmount))}</span>
                  ) : null}
                  <span className="ml-2 text-slate-500">{h.status}</span>
                  {h.submittedBy?.name ? <span className="text-slate-400"> · {h.submittedBy.name}</span> : null}
                </div>
                {isGm && h.status === 'PENDING' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={reviewingId === h.id}
                      onClick={() => void review(h.id, 'APPROVE')}
                      className="px-2 py-1 rounded bg-emerald-600 text-white font-bold"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={reviewingId === h.id}
                      onClick={() => void review(h.id, 'REJECT')}
                      className="px-2 py-1 rounded bg-red-600 text-white font-bold"
                    >
                      Reject
                    </button>
                  </div>
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
              Nominal PO Customer
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
              Dokumen PO {detail.poCustomer || detail.poCustomerDocUrl ? '(opsional jika sudah ada)' : '(wajib)'}
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
    </div>
  );
}
