'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost } from '../../../../../lib/api';
import { formatRupiah } from '../../../../../lib/format';
import type { FinanceProjectDetail } from '../../../../../types/api.types';
import { FinanceProjectPicker } from '../../../../../components/finance/FinanceProjectPicker';
import { num } from '../../_lib/num';

export default function NewBudgetTransferPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [sourceCat, setSourceCat] = useState<'MATERIAL' | 'JASA'>('MATERIAL');
  const [targetCat, setTargetCat] = useState<'MATERIAL' | 'JASA'>('MATERIAL');
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('');
  const [sourceDetail, setSourceDetail] = useState<FinanceProjectDetail | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.role && user.role !== 'FINANCE') {
      toast.error('Hanya Finance yang dapat mengajukan transfer');
      router.replace('/finance-projects/transfer');
    }
  }, [user?.role, router]);

  useEffect(() => {
    if (!sourceId) {
      setSourceDetail(null);
      return;
    }
    let c = false;
    void (async () => {
      try {
        const d = await apiGet<FinanceProjectDetail>(`/finance-projects/${sourceId}`);
        if (!c) setSourceDetail(d);
      } catch {
        if (!c) setSourceDetail(null);
      }
    })();
    return () => {
      c = true;
    };
  }, [sourceId]);

  const amountN = Number(amountStr.replace(/\D/g, '')) || 0;
  const remaining =
    sourceDetail == null
      ? 0
      : sourceCat === 'MATERIAL'
        ? num(sourceDetail.materialRemaining)
        : num(sourceDetail.jasaRemaining);

  const invalidAmount = amountN > 0 && amountN > remaining;

  const submit = async () => {
    if (sourceId === targetId) {
      toast.error('Source dan target tidak boleh sama');
      return;
    }
    if (reason.trim().length < 10) {
      toast.error('Alasan minimal 10 karakter');
      return;
    }
    if (amountN <= 0) {
      toast.error('Jumlah harus lebih dari 0');
      return;
    }
    if (invalidAmount) {
      toast.error('Jumlah melebihi sisa kategori di source');
      return;
    }
    setSubmitting(true);
    try {
      const row = await apiPost<{ id: string }>('/budget-transfers', {
        sourceFinanceProjectId: sourceId,
        targetFinanceProjectId: targetId,
        sourceCategory: sourceCat,
        targetCategory: targetCat,
        amount: amountN,
        reason: reason.trim(),
      });
      toast.success('Transfer diajukan');
      router.push(`/finance-projects/transfer/${row.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengajukan');
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-3 py-8 space-y-6">
      <Link href="/finance-projects/transfer" className="inline-flex items-center gap-2 text-sm text-slate-600">
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>
      <h1 className="text-2xl font-black">Transfer Alokasi Baru</h1>

      <section className="space-y-4 bg-white rounded-2xl border border-slate-100 p-6">
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Proyek sumber</label>
          <FinanceProjectPicker value={sourceId} onChange={setSourceId} excludeId={targetId || undefined} />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={sourceCat === 'MATERIAL'}
              onChange={() => setSourceCat('MATERIAL')}
            />
            Material
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={sourceCat === 'JASA'} onChange={() => setSourceCat('JASA')} />
            Jasa
          </label>
        </div>
        {sourceId ? (
          <p className="text-sm text-slate-600">
            Sisa {sourceCat === 'MATERIAL' ? 'material' : 'jasa'}:{' '}
            <span className="font-bold">{formatRupiah(remaining)}</span>
          </p>
        ) : null}

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Proyek target</label>
          <FinanceProjectPicker value={targetId} onChange={setTargetId} excludeId={sourceId || undefined} />
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={targetCat === 'MATERIAL'}
              onChange={() => setTargetCat('MATERIAL')}
            />
            Material
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={targetCat === 'JASA'} onChange={() => setTargetCat('JASA')} />
            Jasa
          </label>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Jumlah (IDR)</label>
          <input
            className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm ${invalidAmount ? 'border-red-400' : 'border-slate-200'}`}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value.replace(/\D/g, ''))}
          />
          {invalidAmount ? (
            <p className="text-xs text-red-600 mt-1">Melebihi sisa source untuk kategori ini</p>
          ) : null}
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Alasan *</label>
          <textarea
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm min-h-[100px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={submitting}
          onClick={() => setConfirmOpen(true)}
          className="w-full rounded-xl bg-[#0F1B2D] text-white py-3 text-sm font-bold disabled:opacity-50"
        >
          Ajukan
        </button>
      </section>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 shadow-xl">
            <h3 className="font-black text-lg">Konfirmasi Transfer Alokasi</h3>
            <p className="text-sm text-slate-700">
              Dari: {sourceDetail?.code} ({sourceCat}) — sisa {formatRupiah(remaining)}
              <br />
              Ke: target dipilih ({targetCat})
              <br />
              Jumlah: {formatRupiah(amountN)}
            </p>
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-2">
              Transfer ini menggeser plafon alokasi. Realisasi yang sudah terjadi tidak dipindahkan.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 border rounded-xl py-2 text-sm font-bold"
                onClick={() => setConfirmOpen(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="flex-1 bg-[#0F1B2D] text-white rounded-xl py-2 text-sm font-bold"
                onClick={() => void submit()}
                disabled={submitting}
              >
                Konfirmasi & Ajukan
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
