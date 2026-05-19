'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { PlusCircle, Trash2, Upload, X } from 'lucide-react';
import { uploadFile, fixFileUrl } from '../../lib/api';
import type { CashOpRealisasiItem, CashOperationRequest } from '../../types/api.types';
import { formatRupiah } from '../../lib/cash-op-utils';

export interface RealisasiItemInput {
  itemNumber: number;
  description: string;
  /** Local date YYYY-MM-DD */
  paymentDate: string;
  amount: number;
  photoUrl: string | null;
}

export interface RealisasiFormProps {
  cashOp: CashOperationRequest;
  initialItems?: CashOpRealisasiItem[];
  onSaveDraft: (items: RealisasiItemInput[]) => Promise<void>;
  onSubmit: (items: RealisasiItemInput[]) => Promise<void>;
  isReadOnly?: boolean;
}

function toInputsFromApi(items: CashOpRealisasiItem[]): RealisasiItemInput[] {
  return items.map((i) => ({
    itemNumber: i.itemNumber,
    description: i.description,
    paymentDate: i.paymentDate.slice(0, 10),
    amount: Number(i.amount),
    photoUrl: i.photoUrl,
  }));
}

export function RealisasiForm({
  cashOp,
  initialItems = [],
  onSaveDraft,
  onSubmit,
  isReadOnly = false,
}: RealisasiFormProps) {
  const [items, setItems] = useState<RealisasiItemInput[]>(() =>
    initialItems.length > 0
      ? toInputsFromApi(initialItems)
      : [{ itemNumber: 1, description: '', paymentDate: '', amount: 0, photoUrl: null }],
  );
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);

  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
  const finalApproved = Number(cashOp.finalApprovedAmount ?? 0);
  const isExceedApproved = finalApproved > 0 && total > finalApproved;

  const renumber = (rows: RealisasiItemInput[]) =>
    rows.map((r, idx) => ({ ...r, itemNumber: idx + 1 }));

  const addRow = () => {
    setItems((prev) =>
      renumber([
        ...prev,
        { itemNumber: 0, description: '', paymentDate: '', amount: 0, photoUrl: null },
      ]),
    );
  };

  const removeRow = (idx: number) => {
    if (items.length <= 1) return;
    setItems((prev) => renumber(prev.filter((_, i) => i !== idx)));
  };

  const updateRow = (idx: number, patch: Partial<RealisasiItemInput>) => {
    setItems((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const onPickPhoto = useCallback(async (idx: number, fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 10MB');
      return;
    }
    setUploadingIdx(idx);
    try {
      const url = await uploadFile(file, 'cash-operation/photos', 'general');
      setItems((prev) => {
        const next = [...prev];
        if (next[idx]) next[idx] = { ...next[idx], photoUrl: url };
        return next;
      });
      toast.success('Foto terunggah');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setUploadingIdx(null);
    }
  }, []);

  const rowValid = (i: RealisasiItemInput) =>
    i.description.trim().length > 0 && i.paymentDate.length > 0 && i.amount > 0;

  const canSubmit = items.length > 0 && items.every(rowValid);

  const runDraft = async () => {
    if (!items.every(rowValid)) {
      toast.error('Lengkapi semua baris (keterangan, tanggal bayar, nominal lebih dari 0)');
      return;
    }
    setSaving('draft');
    try {
      await onSaveDraft(items);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan draft realisasi. Coba lagi.');
    } finally {
      setSaving(null);
    }
  };

  const runSubmit = async () => {
    if (!canSubmit) {
      toast.error('Lengkapi semua baris sebelum mengajukan');
      return;
    }
    setSaving('submit');
    try {
      await onSubmit(items);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengajukan realisasi. Coba lagi.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-black text-slate-900">Rincian realisasi penggunaan dana</h3>
        <p className="text-sm text-slate-600 mt-1">
          Final disetujui: Rp {formatRupiah(cashOp.finalApprovedAmount ?? '0')}
        </p>
      </div>

      {isExceedApproved ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Total realisasi (Rp {formatRupiah(total)}) melebihi nominal disetujui (Rp{' '}
          {formatRupiah(cashOp.finalApprovedAmount ?? '0')}). Selisih menjadi beban pribadi dan tidak dipotong dari
          budget perusahaan.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left text-xs font-bold">No</th>
              <th className="px-2 py-2 text-left text-xs font-bold">Keterangan</th>
              <th className="px-2 py-2 text-left text-xs font-bold">Tanggal bayar</th>
              <th className="px-2 py-2 text-right text-xs font-bold">Nominal</th>
              <th className="px-2 py-2 text-left text-xs font-bold">Foto</th>
              {!isReadOnly ? <th className="px-2 py-2 text-left text-xs font-bold">Aksi</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-2 py-2 align-middle font-semibold">{item.itemNumber}</td>
                <td className="px-2 py-2 align-middle">
                  <input
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
                    value={item.description}
                    onChange={(e) => updateRow(idx, { description: e.target.value })}
                    disabled={isReadOnly}
                  />
                </td>
                <td className="px-2 py-2 align-middle">
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5"
                    value={item.paymentDate}
                    onChange={(e) => updateRow(idx, { paymentDate: e.target.value })}
                    disabled={isReadOnly}
                  />
                </td>
                <td className="px-2 py-2 align-middle">
                  <input
                    type="number"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-right"
                    value={item.amount || ''}
                    onChange={(e) => updateRow(idx, { amount: Number(e.target.value) || 0 })}
                    disabled={isReadOnly}
                    min={0}
                  />
                </td>
                <td className="px-2 py-2 align-middle">
                  {item.photoUrl ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={fixFileUrl(item.photoUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-teal-600 truncate max-w-[100px]"
                      >
                        Lihat
                      </a>
                      {!isReadOnly ? (
                        <button
                          type="button"
                          className="text-red-600"
                          onClick={() => updateRow(idx, { photoUrl: null })}
                          aria-label="Hapus foto"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>
                  ) : !isReadOnly ? (
                    <label className="inline-flex items-center gap-1 text-xs font-bold text-teal-600 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingIdx === idx ? '…' : 'Unggah'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingIdx !== null}
                        onChange={(e) => void onPickPhoto(idx, e.target.files)}
                      />
                    </label>
                  ) : (
                    '—'
                  )}
                </td>
                {!isReadOnly ? (
                  <td className="px-2 py-2 align-middle">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={items.length <= 1}
                      className="p-1.5 rounded-lg text-red-600 disabled:opacity-30"
                      aria-label="Hapus baris"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            <tr className="bg-slate-50 font-bold border-t border-slate-200">
              <td colSpan={3} className="px-2 py-2 text-right">
                Total
              </td>
              <td className="px-2 py-2 text-right">Rp {formatRupiah(total)}</td>
              <td colSpan={isReadOnly ? 1 : 2} />
            </tr>
          </tbody>
        </table>
      </div>

      {!isReadOnly ? (
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-slate-200 font-bold text-slate-700"
          >
            <PlusCircle className="w-4 h-4" />
            Tambah baris
          </button>
          <button
            type="button"
            onClick={() => void runDraft()}
            disabled={!canSubmit || saving !== null}
            className="px-4 py-2 rounded-xl border border-teal-300 text-teal-800 font-bold disabled:opacity-50"
          >
            {saving === 'draft' ? 'Menyimpan…' : 'Simpan draft'}
          </button>
          <button
            type="button"
            onClick={() => void runSubmit()}
            disabled={!canSubmit || saving !== null}
            className="px-4 py-2 rounded-xl bg-[#00D4B4] text-[#0F1B2D] font-bold disabled:opacity-50"
          >
            {saving === 'submit' ? 'Mengajukan…' : 'Ajukan realisasi'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
