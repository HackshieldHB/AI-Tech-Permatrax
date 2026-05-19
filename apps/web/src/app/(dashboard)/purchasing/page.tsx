'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { OrderTrigger } from '../../../types/api.types';

type OrderInboxRow = {
  id: string;
  orderNumber: string;
  status: string;
  orderTrigger?: OrderTrigger;
  createdAt: string;
  creator?: { name?: string };
};

export default function PurchasingInboxPage() {
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [trigger, setTrigger] = useState<'all' | OrderTrigger>('all');
  const [result, setResult] = useState<{ data: OrderInboxRow[]; meta: { total: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetPaginated<OrderInboxRow>('/purchasing/inbox', {
        page,
        limit,
        orderTrigger: trigger,
      });
      setResult(res);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat inbox');
    } finally {
      setLoading(false);
    }
  }, [page, limit, trigger]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 22 }}>Purchasing — Inbox</h1>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#57606a' }}>
        Order dengan status menunggu input harga purchasing.
      </p>

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>Trigger:</span>
        <select
          value={trigger}
          onChange={(e) => {
            setTrigger(e.target.value as 'all' | OrderTrigger);
            setPage(1);
          }}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14 }}
        >
          <option value="all">Semua</option>
          <option value="PROJECT_REQUEST">PROJECT_REQUEST</option>
          <option value="STOCK_RESTOCK">STOCK_RESTOCK</option>
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #D0D7DE', background: '#F6F8FA', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Nomor Order</th>
              <th style={{ padding: 12 }}>Status</th>
              <th style={{ padding: 12 }}>Trigger</th>
              <th style={{ padding: 12 }}>Pemohon</th>
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
                  Tidak ada order di inbox.
                </td>
              </tr>
            ) : (
              (result?.data ?? []).map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #EAEEF2' }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{r.orderNumber}</td>
                  <td style={{ padding: 12 }}>{r.status}</td>
                  <td style={{ padding: 12 }}>{r.orderTrigger ?? '—'}</td>
                  <td style={{ padding: 12 }}>{r.creator?.name ?? '—'}</td>
                  <td style={{ padding: 12 }}>{new Date(r.createdAt).toLocaleString('id-ID')}</td>
                  <td style={{ padding: 12 }}>
                    <Link href={`/purchasing/${r.id}`} style={{ color: '#0969DA' }}>
                      Input harga
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
