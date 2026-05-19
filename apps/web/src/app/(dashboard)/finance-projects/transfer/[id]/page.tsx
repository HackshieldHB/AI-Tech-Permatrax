'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPatch, apiPost } from '../../../../../lib/api';
import { formatRupiah, formatDateTimeID } from '../../../../../lib/format';
import type { BudgetTransfer } from '../../../../../types/api.types';
import { TRANSFER_STATUS_LABELS } from '../../../../../lib/budget-transfer-status';

export default function BudgetTransferDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { user } = useAuthStore();
  const [row, setRow] = useState<BudgetTransfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await apiGet<BudgetTransfer>(`/budget-transfers/${id}`);
      setRow(t);
    } catch {
      toast.error('Transfer tidak ditemukan');
      router.push('/finance-projects/transfer');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !row) {
    return <div className="p-8 text-slate-500">Memuat…</div>;
  }

  const isGm = user?.role === 'GENERAL_MANAGER';
  const isPending = row.status === 'PENDING_GM_APPROVAL';
  const own = user?.id === row.submittedById;

  return (
    <div className="max-w-2xl mx-auto px-3 py-8 space-y-6">
      <Link href="/finance-projects/transfer" className="text-sm text-slate-600">
        ← Daftar transfer
      </Link>
      <h1 className="text-2xl font-black">Detail Transfer</h1>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 space-y-3 text-sm">
        <div>
          <span className="text-slate-500">Sumber:</span>{' '}
          <Link href={`/finance-projects/${row.sourceFinanceProjectId}`} className="font-bold text-[#00D4B4]">
            {row.sourceProject?.code ?? row.sourceFinanceProjectId}
          </Link>
        </div>
        <div>
          <span className="text-slate-500">Target:</span>{' '}
          <Link href={`/finance-projects/${row.targetFinanceProjectId}`} className="font-bold text-[#00D4B4]">
            {row.targetProject?.code ?? row.targetFinanceProjectId}
          </Link>
        </div>
        <div>
          Kategori: {row.sourceCategory} → {row.targetCategory}
        </div>
        <div className="text-xl font-black">{formatRupiah(row.amount)}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500">Status:</span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${TRANSFER_STATUS_LABELS[row.status].className}`}
          >
            {TRANSFER_STATUS_LABELS[row.status].label}
          </span>
        </div>
        <div>Alasan: {row.reason}</div>
        <div>
          Diajukan: {row.submittedBy?.name ?? row.submittedById} @ {formatDateTimeID(row.createdAt)}
        </div>
        {row.decidedAt ? (
          <div>
            Keputusan: {row.decidedBy?.name ?? row.decidedById ?? '—'} @ {formatDateTimeID(row.decidedAt)}
            {row.rejectionReason ? ` — ${row.rejectionReason}` : null}
          </div>
        ) : null}
      </div>

      {isPending && isGm ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-bold"
            onClick={() => setApproveOpen(true)}
          >
            Setujui
          </button>
          <button
            type="button"
            className="rounded-xl border border-red-300 text-red-700 px-4 py-2 text-sm font-bold"
            onClick={() => setRejectOpen(true)}
          >
            Tolak
          </button>
        </div>
      ) : null}

      {isPending && own ? (
        <button
          type="button"
          className="rounded-xl border px-4 py-2 text-sm font-bold"
          onClick={async () => {
            setBusy(true);
            try {
              await apiPost(`/budget-transfers/${id}/cancel`, {});
              toast.success('Dibatalkan');
              await load();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Gagal');
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          Batalkan pengajuan
        </button>
      ) : null}

      {approveOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-3">
            <h3 className="font-bold">Konfirmasi setujui</h3>
            <textarea
              className="w-full border rounded-lg p-2 text-sm"
              placeholder="Catatan (opsional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="button" className="flex-1 border py-2 rounded-xl" onClick={() => setApproveOpen(false)}>
                Batal
              </button>
              <button
                type="button"
                className="flex-1 bg-emerald-600 text-white py-2 rounded-xl font-bold"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await apiPatch(`/budget-transfers/${id}/approve`, { notes: notes || undefined });
                    toast.success('Disetujui');
                    setApproveOpen(false);
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Gagal');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Setujui
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-3">
            <h3 className="font-bold">Alasan penolakan</h3>
            <textarea
              className="w-full border rounded-lg p-2 text-sm"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="button" className="flex-1 border py-2 rounded-xl" onClick={() => setRejectOpen(false)}>
                Batal
              </button>
              <button
                type="button"
                className="flex-1 bg-red-600 text-white py-2 rounded-xl font-bold"
                onClick={async () => {
                  if (rejectReason.trim().length < 5) {
                    toast.error('Alasan minimal 5 karakter');
                    return;
                  }
                  setBusy(true);
                  try {
                    await apiPatch(`/budget-transfers/${id}/reject`, { reason: rejectReason.trim() });
                    toast.success('Ditolak');
                    setRejectOpen(false);
                    await load();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Gagal');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Tolak
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
