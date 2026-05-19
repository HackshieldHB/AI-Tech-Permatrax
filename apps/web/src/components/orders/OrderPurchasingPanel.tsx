'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { apiGet, apiPost } from '../../lib/api';
import { toast } from 'sonner';
import type { Supplier } from '../../types/api.types';

type OrderItemRow = {
  id: string;
  itemName: string;
  unit: string;
  requestedQty: number;
};

const SubmitSchema = z.object({
  supplierId: z.string().min(1, 'Supplier wajib dipilih'),
  notes: z.string().optional(),
  ppnType: z.enum(['PERCENT', 'NOMINAL', '']).optional(),
  ppnValue: z.number().optional(),
});

export function OrderPurchasingPanel({
  orderId,
  items,
  onDone,
}: {
  orderId: string;
  items: OrderItemRow[];
  onDone: () => Promise<void>;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [priceByItem, setPriceByItem] = useState<Record<string, number>>({});
  const [ppnType, setPpnType] = useState<'PERCENT' | 'NOMINAL' | ''>('');
  const [ppnValue, setPpnValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    const init: Record<string, number> = {};
    for (const it of items) init[it.id] = 0;
    setPriceByItem(init);
  }, [items]);

  const loadSuppliers = useCallback(async () => {
    setLoadErr(null);
    try {
      const list = await apiGet<Supplier[]>('/suppliers/active');
      setSuppliers(list);
    } catch (e: unknown) {
      setLoadErr(e instanceof Error ? e.message : 'Gagal memuat supplier');
    }
  }, []);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t));
  }, [suppliers, q]);

  const selected = suppliers.find((s) => s.id === supplierId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const itemsPayload = items.map((it) => ({
      orderItemId: it.id,
      unitPrice: Number(priceByItem[it.id] ?? 0),
    }));
    if (itemsPayload.some((x) => !x.unitPrice || x.unitPrice <= 0)) {
      toast.error('Semua baris harus memiliki harga satuan lebih dari nol.');
      return;
    }
    const parsed = SubmitSchema.safeParse({
      supplierId,
      notes: notes.trim() || undefined,
      ppnType: ppnType || undefined,
      ppnValue: ppnType && ppnValue ? Number(ppnValue) : undefined,
    });
    if (parsed.success === false) {
      toast.error(parsed.error.errors[0]?.message ?? 'Data tidak valid');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost(`/purchasing/orders/${orderId}/submit-price`, {
        supplierId,
        notes: parsed.data.notes,
        ppnType: parsed.data.ppnType,
        ppnValue: parsed.data.ppnValue,
        items: itemsPayload,
      });
      toast.success('Harga & supplier berhasil dikirim');
      await onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal kirim');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border-l-4 border-[#0D9488] border border-slate-100 shadow-sm p-5 space-y-4">
      <h3 className="font-bold text-slate-800">Purchasing — input harga & supplier</h3>
      <p className="text-sm text-slate-600">
        Isi harga satuan per baris. Total order akan terhitung otomatis di server.
      </p>
      {loadErr ? <p className="text-red-600 text-sm">{loadErr}</p> : null}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Supplier *</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari kode atau nama..."
            className="w-full rounded-xl border px-3 py-2 text-sm mb-2"
          />
          <select
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          >
            <option value="">— Pilih supplier —</option>
            {filtered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          {selected?.email ? <p className="text-xs text-slate-500 mt-1">Email: {selected.email}</p> : null}
        </div>

        <div className="overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2 whitespace-nowrap">Harga satuan (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-2">
                    {it.itemName} <span className="text-slate-400 text-xs">{it.unit}</span>
                  </td>
                  <td className="px-3 py-2">{it.requestedQty}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-32 rounded-lg border px-2 py-1 text-right"
                      placeholder="0"
                      value={priceByItem[it.id] ? Number(priceByItem[it.id]).toLocaleString('id-ID') : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setPriceByItem((p) => ({ ...p, [it.id]: Number(raw) || 0 }));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-4 items-start">
          <div className="flex-1">
            <label className="block text-xs font-bold text-slate-500 mb-1">Tipe PPN</label>
            <select
              value={ppnType}
              onChange={(e) => {
                setPpnType(e.target.value as any);
                setPpnValue('');
              }}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">— Tanpa PPN —</option>
              <option value="PERCENT">Persentase (%)</option>
              <option value="NOMINAL">Nominal (Rp)</option>
            </select>
          </div>
          {ppnType ? (
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-500 mb-1">
                {ppnType === 'PERCENT' ? 'Nilai PPN (%)' : 'Nilai PPN (Rp)'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                className="w-full rounded-xl border px-3 py-2 text-sm text-right"
                placeholder="0"
                value={ppnType === 'PERCENT' ? ppnValue : (ppnValue ? Number(ppnValue).toLocaleString('id-ID') : '')}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, '');
                  if (ppnType === 'PERCENT' && Number(raw) > 100) return;
                  setPpnValue(raw);
                }}
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Catatan purchasing (opsional)"
          className="w-full rounded-xl border px-3 py-2 text-sm"
        />

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-[#0D9488] text-white font-bold disabled:opacity-50"
        >
          {submitting ? 'Mengirim…' : 'Kirim ke approval berikutnya'}
        </button>
      </form>
    </section>
  );
}
