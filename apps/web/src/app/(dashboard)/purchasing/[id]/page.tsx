'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { apiGet, apiPost } from '../../../../lib/api';
import { toast } from 'sonner';
import type { Supplier } from '../../../../types/api.types';

type OrderItemRow = {
  id: string;
  itemName: string;
  unit: string;
  requestedQty: number;
};

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  supplierId?: string | null;
  orderTrigger?: string;
  projectRef?: string;
  creator?: { name?: string };
  items: OrderItemRow[];
};

const SubmitSchema = z.object({
  supplierId: z.string().min(1, 'Supplier wajib dipilih'),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        unitPrice: z.number().positive('Harga harus > 0'),
      }),
    )
    .min(1),
  notes: z.string().optional(),
  ppnType: z.enum(['PERCENT', 'NOMINAL', '']).optional(),
  ppnValue: z.number().optional(),
});

export default function PurchasingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [ppnType, setPpnType] = useState<'PERCENT' | 'NOMINAL' | ''>('');
  const [ppnValue, setPpnValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, sList] = await Promise.all([
        apiGet<OrderDetail>(`/orders/${id}`),
        apiGet<Supplier[]>('/suppliers/active'),
      ]);
      setOrder(o);
      setSuppliers(sList);
      setSupplierId(o.supplierId ?? '');
      const p: Record<string, number> = {};
      for (const it of o.items) p[it.id] = p[it.id] ?? 0;
      setPrices(p);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemsPayload = useMemo(
    () =>
      (order?.items ?? []).map((it) => ({
        orderItemId: it.id,
        unitPrice: Number(prices[it.id] ?? 0),
      })),
    [order?.items, prices],
  );

  const filteredSuppliers = React.useMemo(() => {
    const t = supplierSearch.trim().toLowerCase();
    if (!t) return suppliers;
    return suppliers.filter(
      (s) => s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t),
    );
  }, [suppliers, supplierSearch]);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      toast.error('Pilih supplier');
      return;
    }
    const parsed = SubmitSchema.safeParse({
      supplierId,
      items: itemsPayload,
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
      await apiPost(`/purchasing/orders/${id}/submit-price`, {
        supplierId: parsed.data.supplierId,
        notes: parsed.data.notes,
        ppnType: parsed.data.ppnType,
        ppnValue: parsed.data.ppnValue,
        items: parsed.data.items,
      });
      toast.success('Harga & supplier berhasil dikirim');
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !order) return <div style={{ padding: 24 }}>Memuat…</div>;
  if (!order) return <div style={{ padding: 24 }}>Order tidak ditemukan.</div>;

  const canSubmit = order.status === 'PENDING_PURCHASING_INPUT';

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Link href="/purchasing" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Inbox purchasing
      </Link>
      <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>{order.orderNumber}</h1>
      <p style={{ margin: '0 0 4px', color: '#57606a', fontSize: 13 }}>
        {order.orderTrigger ?? ''} · {order.projectRef ?? ''} · {order.creator?.name ?? '—'}
      </p>
      <p style={{ margin: '0 0 20px', color: '#57606a', fontSize: 13 }}>Status: {order.status}</p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Supplier — with search, matching Form A */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#57606a', display: 'block', marginBottom: 6 }}>
            Supplier *
          </span>
          <input
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            placeholder="Cari kode atau nama..."
            disabled={!canSubmit}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #D0D7DE', marginBottom: 8, fontSize: 14 }}
          />
          <select
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={!canSubmit}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14 }}
          >
            <option value="">— Pilih supplier —</option>
            {filteredSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
          {selectedSupplier?.email ? (
            <p style={{ fontSize: 12, color: '#57606a', marginTop: 4 }}>Email: {selectedSupplier.email}</p>
          ) : null}
        </div>

        {/* Items table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#F6F8FA', textAlign: 'left', borderBottom: '1px solid #D0D7DE' }}>
                <th style={{ padding: 12 }}>Item</th>
                <th style={{ padding: 12 }}>Qty</th>
                <th style={{ padding: 12, whiteSpace: 'nowrap' }}>Harga satuan (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #EAEEF2' }}>
                  <td style={{ padding: 12 }}>
                    {it.itemName} <span style={{ color: '#57606a', fontSize: 12 }}>{it.unit}</span>
                  </td>
                  <td style={{ padding: 12 }}>{it.requestedQty}</td>
                  <td style={{ padding: 12 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={!canSubmit}
                      value={prices[it.id] ? Number(prices[it.id]).toLocaleString('id-ID') : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        setPrices((prev) => ({ ...prev, [it.id]: Number(raw) || 0 }));
                      }}
                      placeholder="0"
                      style={{ width: 140, padding: 8, borderRadius: 8, border: '1px solid #D0D7DE', textAlign: 'right' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* PPN section — matching Form A (OrderPurchasingPanel) */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#57606a', display: 'block', marginBottom: 6 }}>
              Tipe PPN
            </label>
            <select
              value={ppnType}
              disabled={!canSubmit}
              onChange={(e) => {
                setPpnType(e.target.value as 'PERCENT' | 'NOMINAL' | '');
                setPpnValue('');
              }}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14 }}
            >
              <option value="">— Tanpa PPN —</option>
              <option value="PERCENT">Persentase (%)</option>
              <option value="NOMINAL">Nominal (Rp)</option>
            </select>
          </div>
          {ppnType ? (
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#57606a', display: 'block', marginBottom: 6 }}>
                {ppnType === 'PERCENT' ? 'Nilai PPN (%)' : 'Nilai PPN (Rp)'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                disabled={!canSubmit}
                placeholder="0"
                value={ppnType === 'PERCENT' ? ppnValue : (ppnValue ? Number(ppnValue).toLocaleString('id-ID') : '')}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, '');
                  if (ppnType === 'PERCENT' && Number(raw) > 100) return;
                  setPpnValue(raw);
                }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14, textAlign: 'right' }}
              />
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}
        </div>

        {/* Notes */}
        <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 600, color: '#57606a' }}>Catatan purchasing</span>
          <textarea
            value={notes}
            disabled={!canSubmit}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Catatan purchasing (opsional)"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontFamily: 'inherit', fontSize: 14 }}
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 700,
            background: !canSubmit || submitting ? '#8C959F' : '#0D9488',
            color: '#fff',
            cursor: !canSubmit || submitting ? 'not-allowed' : 'pointer',
            fontSize: 15,
          }}
        >
          {submitting ? 'Mengirim…' : 'Kirim ke approval berikutnya'}
        </button>
        {!canSubmit ? <p style={{ fontSize: 13, color: '#57606a' }}>Order tidak lagi menunggu input purchasing.</p> : null}
      </form>
    </div>
  );
}
