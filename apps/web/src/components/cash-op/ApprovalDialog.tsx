'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { CashOperationRequest, CashOpApprovalStep } from '../../types/api.types';
import { computeApprovalCeiling, formatRupiah } from '../../lib/cash-op-utils';

export interface ApprovalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (approvedAmount: number, notes?: string) => Promise<void>;
  cashOp: CashOperationRequest;
  approvalSteps: CashOpApprovalStep[];
  currentStepOrder: number;
}

export function ApprovalDialog({
  isOpen,
  onClose,
  onConfirm,
  cashOp,
  approvalSteps,
  currentStepOrder,
}: ApprovalDialogProps) {
  const ceiling = computeApprovalCeiling(approvalSteps, currentStepOrder, cashOp.amount);
  const [approvedAmount, setApprovedAmount] = useState<string>(ceiling);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApprovedAmount(ceiling);
      setNotes('');
    }
  }, [isOpen, ceiling]);

  if (!isOpen) return null;

  const ceilingNum = Number(ceiling);
  const inputNum = Number(approvedAmount);
  const isValid = inputNum > 0 && inputNum <= ceilingNum && Number.isFinite(inputNum);

  const submit = async () => {
    if (!isValid) return;
    setBusy(true);
    try {
      await onConfirm(inputNum, notes.trim() || undefined);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-dialog-title"
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg max-h-[95vh] overflow-y-auto border border-slate-100">
        <div className="flex items-start justify-between gap-2 p-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 id="approval-dialog-title" className="text-lg font-black text-slate-900">
            Setujui {cashOp.type === 'CASH_ADVANCE' ? 'Cash Advance' : 'Reimbursement'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-50"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm">
          <div className="rounded-xl bg-slate-50 p-3 space-y-1 text-slate-700">
            <div>
              Nominal pengajuan: <strong>Rp {formatRupiah(cashOp.amount)}</strong>
            </div>
            {currentStepOrder > 1 ? (
              <div>
                Plafon dari step sebelumnya: <strong>Rp {formatRupiah(ceiling)}</strong>
              </div>
            ) : null}
          </div>

          <label className="block space-y-1">
            <span className="font-bold text-slate-800">Nominal disetujui Anda *</span>
            <input
              type="number"
              value={approvedAmount}
              onChange={(e) => setApprovedAmount(e.target.value)}
              min={0}
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
            <span className="text-xs text-slate-500">Maksimal Rp {formatRupiah(ceiling)}</span>
            {inputNum > ceilingNum ? (
              <span className="text-xs text-red-600 block">Nominal tidak boleh melebihi plafon.</span>
            ) : null}
            {inputNum <= 0 || !Number.isFinite(inputNum) ? (
              <span className="text-xs text-red-600 block">Nominal harus lebih dari 0.</span>
            ) : null}
          </label>

          <label className="block space-y-1">
            <span className="font-bold text-slate-800">Catatan (opsional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2"
            />
          </label>

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-700"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!isValid || busy}
              className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50"
            >
              {busy ? 'Memproses…' : 'Setujui'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
