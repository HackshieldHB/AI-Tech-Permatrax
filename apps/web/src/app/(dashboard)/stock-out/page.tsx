'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse, StockOutStatus } from '../../../types/api.types';
import { STOCK_OUT_STATUS_LABELS } from '../../../types/api.types';

type StockOutRow = {
  id: string;
  requestNumber: string;
  status: StockOutStatus;
  createdAt: string;
  notes: string | null;
  requestedBy?: { id: string; name: string };
  permitCluster?: { id: string; clusterCode: string } | null;
};

export default function StockOutListPage() {
  const [tab, setTab] = useState<'inbox' | 'mine'>('inbox');
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [result, setResult] = useState<PaginatedResponse<StockOutRow> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetPaginated<StockOutRow>('/stock-out', {
        page,
        limit,
        scope: tab,
        status: 'all',
      });
      setResult(res);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [page, limit, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Stock Out</h1>
        <Link
          href="/stock-out/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 8,
            background: '#00D4B4',
            color: '#0D1117',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          <Plus size={18} /> Permintaan baru
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['inbox', 'mine'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k);
              setPage(1);
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: tab === k ? '1px solid #00D4B4' : '1px solid #D0D7DE',
              background: tab === k ? '#E6FFF9' : '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {k === 'inbox' ? 'Inbox' : 'Permintaan saya'}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #D0D7DE', background: '#F6F8FA', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Nomor</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Pemohon</th>
              <th style={{ padding: 12 }}>Cluster</th>
              <th style={{ padding: 12 }}>Dibuat</th>
              <th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24 }}>
                  Memuat…
                </td>
              </tr>
            ) : (result?.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24 }}>
                  Tidak ada data.
                </td>
              </tr>
            ) : (
              (result?.data ?? []).map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #EAEEF2' }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{r.requestNumber}</td>
                  <td style={{ padding: 12 }}>{STOCK_OUT_STATUS_LABELS[r.status].label}</td>
                  <td style={{ padding: 12 }}>{r.requestedBy?.name ?? '—'}</td>
                  <td style={{ padding: 12 }}>{r.permitCluster?.clusterCode ?? '—'}</td>
                  <td style={{ padding: 12 }}>{new Date(r.createdAt).toLocaleString('id-ID')}</td>
                  <td style={{ padding: 12 }}>
                    <Link href={`/stock-out/${r.id}`} style={{ color: '#0969DA' }}>
                      Detail
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result ? (
        <Pagination total={result.meta.total} page={page} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      ) : null}
    </div>
  );
}
