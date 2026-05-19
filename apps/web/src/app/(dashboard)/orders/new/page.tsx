'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, PlusCircle, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../../../store/authStore';
import { apiFetch } from '../../../../lib/auth';
import { apiPost, apiGetPaginated } from '../../../../lib/api';
import { FinanceProjectPicker } from '../../../../components/finance/FinanceProjectPicker';
import { toast } from 'sonner';

type CatalogRow = {
  stockItemId: string | null;
  itemName: string;
  itemCode?: string;
  category?: string;
  unit: string;
  requestedQty: number;
  unitPrice?: number;
  searchQ: string;
  suggestions: any[];
  showNew: boolean;
};

type ApprovalRow = { name: string; quantity: number; unit: string; notes: string };

type FinanceProjectOption = {
  id: string;
  code: string;
  name: string;
  isDefaultUncategorized: boolean;
};

const emptyCatalogRow = (): CatalogRow => ({
  stockItemId: null,
  itemName: '',
  unit: 'Pcs',
  requestedQty: 1,
  searchQ: '',
  suggestions: [],
  showNew: false,
});

const emptyApprovalRow = (): ApprovalRow => ({
  name: '',
  quantity: 1,
  unit: 'pcs',
  notes: '',
});

export default function NewOrderPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  // FIX: dua alur — katalog/stok (Surat Jalan) vs pengajuan item (approval chain)
  const [flow, setFlow] = useState<'catalog' | 'approval'>('catalog');

  const [fiberType, setFiberType] = useState<'FTTH' | 'FTTB' | 'FTTT'>('FTTH');
  const [projectRef, setProjectRef] = useState(''); // FIX: projectRef is now mandatory
  const [projectRefError, setProjectRefError] = useState(false); // FIX
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<CatalogRow[]>([emptyCatalogRow()]);
  const [approvalRows, setApprovalRows] = useState<ApprovalRow[]>([emptyApprovalRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [financeProjectId, setFinanceProjectId] = useState('');
  const [financeProjectLabel, setFinanceProjectLabel] = useState('');
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiGetPaginated<FinanceProjectOption>('/finance-projects', {
          limit: 100,
          status: 'ACTIVE',
        });
        if (cancelled) return;
        const general = res.data.find((p) => p.isDefaultUncategorized);
        if (general) {
          setFinanceProjectId(general.id);
          setFinanceProjectLabel(
            general.isDefaultUncategorized
              ? `${general.code} · ${general.name} (Belum dialokasi)`
              : `${general.code} · ${general.name}`,
          );
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canCreate = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN_STOCK'].includes(user?.role ?? '');

  // FIX: validasi Referensi Proyek sebelum submit
  const validateProjectRef = (): boolean => {
    if (!projectRef.trim()) {
      setProjectRefError(true);
      toast.error('Referensi Proyek wajib diisi');
      return false;
    }
    setProjectRefError(false);
    return true;
  };

  const searchStock = useCallback(
    async (q: string, idx: number) => {
      if (!q.trim()) {
        setRows((r) => r.map((row, i) => (i === idx ? { ...row, suggestions: [] } : row)));
        return;
      }
      const res = await apiFetch(`/stock/search?q=${encodeURIComponent(q)}`, {}, user?.id);
      if (!res.ok) return;
      const data = await res.json();
      setRows((r) => r.map((row, i) => (i === idx ? { ...row, suggestions: data, searchQ: q } : row)));
    },
    [user?.id],
  );

  const queueSearch = (idx: number, q: string) => {
    clearTimeout(searchTimers.current[idx]);
    searchTimers.current[idx] = setTimeout(() => searchStock(q, idx), 300);
  };

  const pickSuggestion = (idx: number, s: any) => {
    setRows((r) =>
      r.map((row, i) =>
        i === idx
          ? {
              ...row,
              stockItemId: s.id,
              itemName: s.name,
              itemCode: s.code,
              category: s.category,
              unit: s.unit,
              suggestions: [],
              searchQ: s.name,
              showNew: false,
            }
          : row,
      ),
    );
  };

  const summary = () => {
    let fromStock = 0;
    let needBuy = 0;
    let est = 0;
    rows.forEach((row) => {
      if (row.stockItemId) fromStock++;
      else if (row.itemName.trim()) {
        needBuy++;
        est += (row.unitPrice ?? 0) * row.requestedQty;
      }
    });
    return { fromStock, needBuy, est };
  };

  const runSubmitCatalog = async () => {
    if (!validateProjectRef()) return; // FIX
    setSubmitting(true);
    try {
      const items = rows
        .filter((r) => r.itemName.trim())
        .map((r) => ({
          stockItemId: r.stockItemId,
          itemName: r.itemName,
          itemCode: r.itemCode,
          category: r.category,
          unit: r.unit,
          requestedQty: r.requestedQty,
          ...(r.stockItemId ? {} : { unitPrice: r.unitPrice ?? 0 }),
        }));
      const res = await apiFetch(
        '/orders',
        {
          method: 'POST',
          body: JSON.stringify({
            fiberType,
            projectRef: projectRef.trim(), // FIX: wajib
            notes: notes || undefined,
            financeProjectId: financeProjectId || undefined,
            items,
          }),
        },
        user?.id,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || 'Gagal membuat order');
      }
      const order = await res.json();
      const sub = await apiFetch(`/orders/${order.id}/submit`, { method: 'POST' }, user?.id);
      if (!sub.ok) {
        const err = await sub.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || 'Submit gagal');
      }
      toast.success('Order berhasil disubmit');
      router.push(`/orders/${order.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const runSubmitApproval = async () => {
    if (!validateProjectRef()) return; // FIX
    const valid = approvalRows.filter((r) => r.name.trim());
    if (!valid.length) {
      toast.error('Isi minimal satu nama barang');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiPost<{ id: string }>('/orders', {
        fiberType,
        projectRef: projectRef.trim(), // FIX: wajib
        notes: notes || undefined,
        financeProjectId: financeProjectId || undefined,
        requestedItems: valid.map((r) => ({
          name: r.name.trim(),
          quantity: Number(r.quantity) || 1,
          unit: r.unit || 'pcs',
          notes: r.notes || undefined,
        })),
      });
      toast.success('Pengajuan dibuat — menunggu Admin Stok');
      router.push(`/orders/${created.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat pengajuan');
    } finally {
      setSubmitting(false);
    }
  };

  const { fromStock, needBuy, est } = summary();

  if (!canCreate) {
    return (
      <div className="max-w-3xl py-12 text-center text-slate-600">
        Hanya PM atau Admin Stok yang dapat membuat order.
        <div className="mt-4">
          <Link href="/orders" className="text-[#00D4B4] font-bold">
            ← Kembali ke daftar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-[#00D4B4]">
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>

      <div>
        <h2 className="text-2xl font-black text-slate-800">Buat Order Baru</h2>
        <p className="text-sm text-slate-500 mt-1">Pilih alur: katalog/stok atau pengajuan pembelian</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFlow('catalog')}
          className={`px-4 py-2 rounded-xl text-sm font-bold ${flow === 'catalog' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Dari katalog / stok
        </button>
        <button
          type="button"
          onClick={() => setFlow('approval')}
          className={`px-4 py-2 rounded-xl text-sm font-bold ${flow === 'approval' ? 'bg-[#0F1B2D] text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          Pengajuan item (approval)
        </button>
      </div>

      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
        <h3 className="font-bold text-slate-800">Info order</h3>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Jenis Fiber</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            value={fiberType}
            onChange={(e) => setFiberType(e.target.value as 'FTTH' | 'FTTB' | 'FTTT')}
          >
            <option value="FTTH">FTTH</option>
            <option value="FTTB">FTTB</option>
            <option value="FTTT">FTTT</option>
          </select>
        </div>
        {/* FIX: field UI with mandatory indicator + error state */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 600,
              marginBottom: 6,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Referensi Proyek *
            <span style={{ color: '#EF4444', marginLeft: 4 }}>(Wajib)</span>
          </label>
          <input
            type="text"
            value={projectRef}
            onChange={(e) => {
              setProjectRef(e.target.value);
              if (e.target.value.trim()) setProjectRefError(false); // FIX
            }}
            placeholder="Masukkan kode atau nama proyek terkait..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '9px 12px',
              borderRadius: 8,
              fontSize: 13,
              border: `1.5px solid ${projectRefError ? '#EF4444' : 'var(--color-border-tertiary)'}`,
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
          />
          {projectRefError ? (
            <div style={{ fontSize: 11, color: '#EF4444', marginTop: 3 }}>⚠ Referensi Proyek wajib diisi</div>
          ) : null}
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Proyek budget (finance)</label>
          <FinanceProjectPicker
            value={financeProjectId}
            onChange={(id, p) => {
              setFinanceProjectId(id);
              if (p) {
                setFinanceProjectLabel(
                  p.isDefaultUncategorized
                    ? `${p.code} · ${p.name} (Belum dialokasi)`
                    : `${p.code} · ${p.name}`,
                );
              } else {
                setFinanceProjectLabel('');
              }
            }}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Pilih project untuk auto-deduct budget. Pilih GENERAL/Belum dialokasi jika belum tahu.
          </p>
          <p className="text-xs text-slate-500 mt-1">Default: GENERAL untuk transaksi belum dikategorikan.</p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Catatan</label>
          <textarea
            className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </section>

      {flow === 'catalog' ? (
        <>
          <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-slate-800">Daftar barang</h3>
            {rows.map((row, idx) => (
              <div key={idx} className="border border-slate-100 rounded-xl p-4 space-y-3">
                <div className="relative">
                  <label className="text-xs font-bold text-slate-500">Cari barang</label>
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    value={row.searchQ}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((r) => r.map((x, i) => (i === idx ? { ...x, searchQ: v, itemName: v, stockItemId: null } : x)));
                      queueSearch(idx, v);
                    }}
                    placeholder="Nama atau kode…"
                  />
                  {row.suggestions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {row.suggestions.map((s: any) => (
                        <button
                          key={s.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b last:border-0"
                          onClick={() => pickSuggestion(idx, s)}
                        >
                          <span className="font-mono text-[#00D4B4]">{s.code}</span> — {s.name}{' '}
                          <span className="text-slate-500">
                            Stok: {s.currentQty} {s.unit}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs text-amber-700 font-bold hover:bg-amber-50"
                        onClick={() =>
                          setRows((r) => r.map((x, i) => (i === idx ? { ...x, stockItemId: null, showNew: true, suggestions: [] } : x)))
                        }
                      >
                        Tambah sebagai barang baru (di luar katalog)
                      </button>
                    </div>
                  )}
                </div>
                {(row.stockItemId || row.showNew) && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-slate-500">Qty</label>
                        <input
                          type="number"
                          min={1}
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={row.requestedQty}
                          onChange={(e) =>
                            setRows((r) => r.map((x, i) => (i === idx ? { ...x, requestedQty: +e.target.value } : x)))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500">Satuan</label>
                        <input
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={row.unit}
                          onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                        />
                      </div>
                    </div>
                    {!row.stockItemId && (
                      <div>
                        <label className="text-xs font-bold text-slate-500">Harga satuan (IDR)</label>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={row.unitPrice ?? ''}
                          onChange={(e) =>
                            setRows((r) => r.map((x, i) => (i === idx ? { ...x, unitPrice: +e.target.value } : x)))
                          }
                        />
                      </div>
                    )}
                    <div className="text-xs">
                      {row.stockItemId ? (
                        <span className="text-emerald-700 font-medium">Dari katalog — akan mengurangi stok</span>
                      ) : (
                        <span className="text-amber-700 font-medium">Barang baru — perlu estimasi harga untuk PR</span>
                      )}
                    </div>
                  </>
                )}
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="text-red-600 text-xs font-bold flex items-center gap-1"
                    onClick={() => setRows((r) => r.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus baris
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm font-bold text-[#00D4B4]"
              onClick={() => setRows((r) => [...r, emptyCatalogRow()])}
            >
              <Plus className="w-4 h-4" />
              Tambah Barang
            </button>
          </section>

          <div className="bg-slate-50 rounded-2xl p-4 text-sm space-y-1">
            <p>
              Barang dari stok: <strong>{fromStock}</strong> item → dapat menghasilkan Surat Jalan
            </p>
            <p>
              Barang perlu dibeli: <strong>{needBuy}</strong> item → ke Finance
            </p>
            <p>
              Estimasi pembelian: <strong>Rp {est.toLocaleString('id-ID')}</strong>
            </p>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={() => {
              if (!validateProjectRef()) return; // FIX: cek sebelum modal
              setConfirmOpen(true);
            }}
            className="w-full py-3.5 rounded-xl bg-[#0F1B2D] text-white font-bold disabled:opacity-50"
          >
            {submitting ? 'Memproses…' : 'Submit Order'}
          </button>
        </>
      ) : (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Isi item yang diminta. Admin Stok mengisi harga, lalu Ops → GM → Finance → verifikasi.
          </p>
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800">Item diminta</h3>
            <button
              type="button"
              onClick={() => setApprovalRows((p) => [...p, emptyApprovalRow()])}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary"
            >
              <PlusCircle className="w-4 h-4" />
              Tambah baris
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2 w-20">Jml</th>
                  <th className="px-3 py-2 w-24">Satuan</th>
                  <th className="px-3 py-2">Ket</th>
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {approvalRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <input
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                        value={row.name}
                        onChange={(e) =>
                          setApprovalRows((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                        }
                        placeholder="Nama barang"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                        value={row.quantity}
                        onChange={(e) =>
                          setApprovalRows((p) => p.map((r, j) => (j === i ? { ...r, quantity: +e.target.value } : r)))
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                        value={row.unit}
                        onChange={(e) =>
                          setApprovalRows((p) => p.map((r, j) => (j === i ? { ...r, unit: e.target.value } : r)))
                        }
                      >
                        {['pcs', 'meter', 'roll', 'box', 'unit', 'set', 'kg', 'liter'].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                        value={row.notes}
                        onChange={(e) =>
                          setApprovalRows((p) => p.map((r, j) => (j === i ? { ...r, notes: e.target.value } : r)))
                        }
                        placeholder="Opsional"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={approvalRows.length === 1}
                        className="text-red-500 disabled:opacity-30"
                        onClick={() => setApprovalRows((p) => p.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void runSubmitApproval()}
            className="w-full py-3.5 rounded-xl bg-[#00D4B4] text-[#0F1B2D] font-bold disabled:opacity-50"
          >
            {submitting ? 'Menyimpan…' : 'Kirim pengajuan'}
          </button>
        </section>
      )}

      {flow === 'catalog' && confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h4 className="font-bold text-lg text-slate-800">Konfirmasi</h4>
            <p className="text-sm text-slate-600">
              Order ini akan:
              <br />✓ Mengurangi stok untuk barang dari katalog
              <br />✓ Membuat Surat Jalan jika stok mencukupi
              <br />✓ Mengirim permintaan pembelian untuk barang di luar katalog / stok tidak cukup
            </p>
            <p className="text-sm text-slate-700">
              <span className="font-semibold">Proyek budget:</span>{' '}
              {financeProjectLabel || '—'}
            </p>
            <div className="flex gap-2">
              <button type="button" className="flex-1 py-2.5 rounded-xl border font-medium" onClick={() => setConfirmOpen(false)}>
                Batal
              </button>
              <button type="button" className="flex-1 py-2.5 rounded-xl bg-[#00D4B4] font-bold text-[#0F1B2D]" onClick={runSubmitCatalog}>
                Ya, Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
