'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { apiGet, apiPost } from '../../../../lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../store/authStore';
import type { StockOut } from '../../../../types/api.types';
import { STOCK_OUT_STATUS_LABELS } from '../../../../types/api.types';

const RejectSchema = z.object({
  reason: z.string().min(1, 'Alasan wajib').max(1000),
});

type StockOutDetail = StockOut & {
  requestedBy?: { id: string; name: string };
  fulfilledBy?: { id: string; name: string } | null;
  permitCluster?: { id: string; clusterCode?: string | null } | null;
};

export default function StockOutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [row, setRow] = useState<StockOutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState<'fulfill' | 'reject' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<StockOutDetail>(`/stock-out/${id}`);
      setRow(r);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canFulfill = user?.role === 'ADMIN_STOCK';

  const fulfill = async () => {
    setBusy('fulfill');
    try {
      await apiPost(`/stock-out/${id}/fulfill`, {});
      toast.success('Permintaan dipenuhi');
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(null);
    }
  };

  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = RejectSchema.safeParse({ reason: rejectReason.trim() });
    if (parsed.success === false) {
      toast.error(parsed.error.errors[0]?.message ?? 'Data tidak valid');
      return;
    }
    setBusy('reject');
    try {
      await apiPost(`/stock-out/${id}/reject`, parsed.data);
      toast.success('Permintaan ditolak');
      setRejectReason('');
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !row) return <div style={{ padding: 24 }}>Memuat…</div>;
  if (!row) return <div style={{ padding: 24 }}>Data tidak ditemukan.</div>;

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Link href="/stock-out" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Stock Out
      </Link>

      <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{row.requestNumber}</h1>
      <p style={{ margin: '0 0 8px', color: '#57606a' }}>
        Status: <strong>{STOCK_OUT_STATUS_LABELS[row.status].label}</strong>
      </p>
      <p style={{ margin: '0 0 20px', color: '#57606a', fontSize: 14 }}>
        Pemohon: {row.requestedBy?.name ?? row.requestedById}
        {row.permitCluster?.clusterCode ? ` • Cluster ${row.permitCluster.clusterCode}` : ''}
      </p>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
        <strong style={{ fontSize: 14 }}>Item</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(Array.isArray(row.items) ? row.items : []).map((it: { stockItemId: string; qty: number; notes?: string; itemName?: string }, i: number) => (
            <li key={`${it.stockItemId}-${i}`} style={{ marginBottom: 6 }}>
              {it.itemName || it.stockItemId} × {it.qty}
              {it.notes ? ` — ${it.notes}` : ''}
            </li>
          ))}
        </ul>
      </div>

      {row.notes ? (
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          <strong>Catatan:</strong> {row.notes}
        </p>
      ) : null}

      {row.rejectionReason ? (
        <p style={{ fontSize: 14, marginBottom: 16, color: '#CF222E' }}>
          <strong>Penolakan:</strong> {row.rejectionReason}
        </p>
      ) : null}

      {row.status === 'PENDING' && canFulfill ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600 }}>Admin Stok — tindakan</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => fulfill()}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: 'none',
                fontWeight: 600,
                background: '#2DA44E',
                color: '#fff',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy === 'fulfill' ? 'Memproses…' : 'Penuhi permintaan'}
            </button>
            <form onSubmit={reject} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', flex: 1 }}>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Alasan penolakan…"
                style={{ flex: 1, minWidth: 160, padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
              />
              <button
                type="submit"
                disabled={busy !== null}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  fontWeight: 600,
                  background: '#CF222E',
                  color: '#fff',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                {busy === 'reject' ? 'Memproses…' : 'Tolak'}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
