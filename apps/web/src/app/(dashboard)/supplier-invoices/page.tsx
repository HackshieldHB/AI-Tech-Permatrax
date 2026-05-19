'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse, SupplierInvoiceStatus } from '../../../types/api.types';
import { SUPPLIER_INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '../../../types/api.types';

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceAmount: string;
  status: SupplierInvoiceStatus;
  paymentMethod: keyof typeof PAYMENT_METHOD_LABELS;
  orderId: string;
  supplierId: string;
  createdAt: string;
};

export default function SupplierInvoicesPage() {
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [status, setStatus] = useState<'all' | SupplierInvoiceStatus>('all');
  const [result, setResult] = useState<PaginatedResponse<InvoiceRow> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetPaginated<InvoiceRow>('/supplier-invoices', {
        page,
        limit,
        status,
      });
      setResult(res);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat tagihan');
    } finally {
      setLoading(false);
    }
  }, [page, limit, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 16px', fontSize: 22 }}>Tagihan Supplier</h1>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, marginRight: 8 }}>Status:</label>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'all' | SupplierInvoiceStatus);
            setPage(1);
          }}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #D0D7DE' }}
        >
          <option value="all">Semua</option>
          {(Object.keys(SUPPLIER_INVOICE_STATUS_LABELS) as SupplierInvoiceStatus[]).map((s) => (
            <option key={s} value={s}>
              {SUPPLIER_INVOICE_STATUS_LABELS[s].label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #D0D7DE', background: '#F6F8FA', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>No. Tagihan</th>
              <th style={{ padding: 12 }}>Nominal</th>
              <th style={{ padding: 12 }}>Metode bayar</th>
              <th style={{ padding: 12 }}>Status</th>
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
                  <td style={{ padding: 12, fontWeight: 600 }}>{r.invoiceNumber}</td>
                  <td style={{ padding: 12 }}>{r.invoiceAmount}</td>
                  <td style={{ padding: 12 }}>{PAYMENT_METHOD_LABELS[r.paymentMethod]}</td>
                  <td style={{ padding: 12 }}>{SUPPLIER_INVOICE_STATUS_LABELS[r.status].label}</td>
                  <td style={{ padding: 12 }}>{new Date(r.createdAt).toLocaleString('id-ID')}</td>
                  <td style={{ padding: 12 }}>
                    <Link href={`/supplier-invoices/${r.id}`} style={{ color: '#0969DA' }}>
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
