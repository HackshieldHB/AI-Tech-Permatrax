'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { apiGetPaginated, apiPost } from '../../../../lib/api';
import { apiFetch } from '../../../../lib/auth';
import { useAuthStore } from '../../../../store/authStore';
import { toast } from 'sonner';

type ClusterOpt = { id: string; clusterCode: string };

type StockSearchHit = {
  id: string;
  name: string;
  code: string;
  unit: string;
  category: string | null;
  currentQty: number;
  isLowStock: boolean;
};

type ItemRowUi = {
  stockItemId: string;
  qty: number;
  notes?: string;
  query: string;
  label: string;
  suggestions: StockSearchHit[];
  suggestOpen: boolean;
};

const ItemSchema = z.object({
  stockItemId: z.string().min(1, 'ID barang wajib'),
  qty: z.coerce.number().int().positive('Qty harus > 0'),
  notes: z.string().optional(),
});

const FormSchema = z.object({
  items: z.array(ItemSchema).min(1, 'Minimal satu item'),
  permitClusterId: z.string().optional(),
  recipient: z.string().min(1, 'Penerima wajib diisi'),
  recipientCompany: z.string().optional(),
  recipientAddress: z.string().optional(),
  recipientTelp: z.string().optional(),
  notes: z.string().optional(),
});

const emptyRow = (): ItemRowUi => ({
  stockItemId: '',
  qty: 1,
  notes: '',
  query: '',
  label: '',
  suggestions: [],
  suggestOpen: false,
});

export default function NewStockOutPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [clusters, setClusters] = useState<ClusterOpt[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [permitClusterId, setPermitClusterId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientCompany, setRecipientCompany] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientTelp, setRecipientTelp] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<ItemRowUi[]>(() => [emptyRow()]);
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const loadClusters = useCallback(async () => {
    setLoadingClusters(true);
    try {
      const res = await apiGetPaginated<ClusterOpt>('/permit-clusters', { page: 1, limit: 100 });
      setClusters(res.data ?? []);
    } catch {
      setClusters([]);
    } finally {
      setLoadingClusters(false);
    }
  }, []);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  const searchStock = useCallback(
    async (idx: number, q: string) => {
      if (!q.trim()) {
        setRows((r) =>
          r.map((row, i) => (i === idx ? { ...row, suggestions: [], suggestOpen: false } : row)),
        );
        return;
      }
      try {
        const res = await apiFetch(`/stock/search?q=${encodeURIComponent(q.trim())}`, {}, user?.id);
        if (!res.ok) return;
        const data = (await res.json()) as StockSearchHit[];
        setRows((r) =>
          r.map((row, i) =>
            i === idx ? { ...row, suggestions: Array.isArray(data) ? data : [], suggestOpen: true } : row,
          ),
        );
      } catch {
        setRows((r) => r.map((row, i) => (i === idx ? { ...row, suggestions: [] } : row)));
      }
    },
    [user?.id],
  );

  const queueSearch = (idx: number, q: string) => {
    clearTimeout(searchTimers.current[idx]);
    searchTimers.current[idx] = setTimeout(() => void searchStock(idx, q), 300);
  };

  const pickSuggestion = (idx: number, s: StockSearchHit) => {
    setRows((r) =>
      r.map((row, i) =>
        i === idx
          ? {
              ...row,
              stockItemId: s.id,
              label: `${s.name} (${s.code})`,
              query: s.name,
              suggestions: [],
              suggestOpen: false,
            }
          : row,
      ),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      items: rows.map((r) => ({
        stockItemId: r.stockItemId.trim(),
        qty: r.qty,
        notes: r.notes?.trim() || undefined,
      })),
      permitClusterId: permitClusterId || undefined,
      recipient: recipient.trim(),
      recipientCompany: recipientCompany.trim() || undefined,
      recipientAddress: recipientAddress.trim() || undefined,
      recipientTelp: recipientTelp.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    if (parsed.success === false) {
      toast.error(parsed.error.errors[0]?.message ?? 'Data tidak valid');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiPost<{ id: string }>('/stock-out', parsed.data);
      toast.success('Permintaan dikirim');
      router.replace(`/stock-out/${created.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Link
        href="/stock-out"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}
      >
        <ArrowLeft size={16} /> Daftar Stock Out
      </Link>
      <h1 style={{ margin: '0 0 16px', fontSize: 22 }}>Permintaan ambil barang</h1>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16 }}>
          <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span>Pipeline / cluster (opsional)</span>
            <select
              value={permitClusterId}
              onChange={(e) => setPermitClusterId(e.target.value)}
              disabled={loadingClusters}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            >
              <option value="">— Tanpa cluster —</option>
              {clusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clusterCode}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Up./Penerima <span style={{ color: '#CF222E' }}>*</span></span>
            <span style={{ fontSize: 12, color: '#57606a' }}>Nama orang/unit yang akan menerima barang</span>
            <input
              required
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Nama penerima barang…"
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            />
          </label>
          <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Company Name</span>
            <span style={{ fontSize: 12, color: '#57606a' }}>Nama perusahaan tujuan pengiriman</span>
            <input
              value={recipientCompany}
              onChange={(e) => setRecipientCompany(e.target.value)}
              placeholder="Contoh: PT Mitra Konstruksi…"
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            />
          </label>
          <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Address</span>
            <span style={{ fontSize: 12, color: '#57606a' }}>Alamat pengiriman yang dituju</span>
            <input
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="Alamat lengkap tujuan…"
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            />
          </label>
          <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Telp</span>
            <span style={{ fontSize: 12, color: '#57606a' }}>Nomor telepon yang dituju</span>
            <input
              value={recipientTelp}
              onChange={(e) => setRecipientTelp(e.target.value)}
              placeholder="Contoh: 0812-xxxx-xxxx…"
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            />
          </label>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16 }}>
          <strong style={{ fontSize: 14 }}>Barang dari katalog stok</strong>
          <p style={{ margin: '6px 0 12px', fontSize: 13, color: '#57606a' }}>
            Ketik nama atau kode barang — pilih dari daftar (stok tersedia ditampilkan).
          </p>
          {rows.map((r, idx) => (
            <div
              key={`row-${idx}`}
              style={{
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: idx < rows.length - 1 ? '1px solid #EAEEF2' : 'none',
              }}
            >
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span>Cari barang</span>
                  <input
                    value={r.query}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                query: v,
                                stockItemId: '',
                                label: '',
                                suggestOpen: v.trim().length > 0,
                              }
                            : row,
                        ),
                      );
                      queueSearch(idx, v);
                    }}
                    onFocus={() => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, suggestOpen: true } : row)))}
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', width: '100%', boxSizing: 'border-box' }}
                    placeholder="Nama atau kode…"
                    autoComplete="off"
                  />
                </label>
                {r.stockItemId ? (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#1a7f37' }}>
                    Dipilih: {r.label}{' '}
                    <button
                      type="button"
                      style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
                      onClick={() =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? emptyRow() : row)))
                      }
                    >
                      Ganti
                    </button>
                  </p>
                ) : null}
                {r.suggestOpen && r.suggestions.length > 0 ? (
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: '4px 0 0',
                      padding: 0,
                      border: '1px solid #D0D7DE',
                      borderRadius: 8,
                      maxHeight: 220,
                      overflowY: 'auto',
                      background: '#fff',
                      position: 'absolute',
                      zIndex: 10,
                      left: 0,
                      right: 0,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                  >
                    {r.suggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => pickSuggestion(idx, s)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            border: 'none',
                            borderBottom: '1px solid #EAEEF2',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: 13,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{s.name}</span>
                          <span style={{ color: '#57606a', marginLeft: 6 }}>({s.code})</span>
                          <span style={{ display: 'block', fontSize: 11, color: '#57606a', marginTop: 2 }}>
                            Stok: {s.currentQty} {s.unit}
                            {s.isLowStock ? ' · stok rendah' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8, marginTop: 10, alignItems: 'end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span>Qty</span>
                  <input
                    type="number"
                    min={1}
                    value={r.qty}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10) || 1;
                      setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, qty: n } : row)));
                    }}
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <span>Catatan baris (opsional)</span>
                  <input
                    value={r.notes ?? ''}
                    onChange={(e) =>
                      setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, notes: e.target.value } : row)))
                    }
                    style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((x) => [...x, emptyRow()])}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#F6F8FA', cursor: 'pointer' }}
          >
            + Baris
          </button>
        </div>

        <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>Catatan</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }} />
        </label>

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            background: submitting ? '#8C959F' : '#00D4B4',
            color: '#0D1117',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Mengirim…' : 'Kirim permintaan'}
        </button>
      </form>
    </div>
  );
}
