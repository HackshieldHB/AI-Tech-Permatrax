'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiGet, fixFileUrl } from '../../../../lib/api';
import { toast } from 'sonner';
import type { SupplierInvoice } from '../../../../types/api.types';
import { SUPPLIER_INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '../../../../types/api.types';

type FetchError = { status?: number; message: string };

function parseFetchError(e: unknown): FetchError {
  const err = e as Error & { status?: number; statusCode?: number };
  const status = err.status ?? err.statusCode;
  const message = typeof err?.message === 'string' ? err.message : 'Gagal memuat tagihan';
  return { status, message };
}

export default function SupplierInvoiceDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<SupplierInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FetchError | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const inv = await apiGet<SupplierInvoice>(`/supplier-invoices/${id}`, undefined, {
        silentForbidden: true,
      });
      setRow(inv);
    } catch (e: unknown) {
      const parsed = parseFetchError(e);
      console.error('Failed to fetch supplier invoice:', { id, ...parsed, raw: e });
      setError(parsed);
      setRow(null);
      if (parsed.status === 403) {
        toast.error('Anda tidak punya akses ke detail tagihan ini');
      } else if (parsed.status === 404) {
        toast.error('Tagihan tidak ditemukan');
      } else {
        toast.error(parsed.message);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const btnStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #d0d7de',
    background: '#f6f8fa',
    cursor: 'pointer',
    fontSize: 14,
  };

  if (loading && !row && !error) {
    return <div style={{ padding: 24 }}>Memuat detail tagihan…</div>;
  }

  if (error?.status === 403) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>Akses ditolak</h2>
        <p style={{ marginTop: 12, color: '#57606a', lineHeight: 1.5 }}>
          Anda tidak punya akses untuk melihat detail tagihan ini. Silakan hubungi Finance atau Admin bila perlu.
        </p>
        <div style={{ marginTop: 16 }}>
          <button type="button" style={btnStyle} onClick={() => router.back()}>
            Kembali
          </button>
        </div>
      </div>
    );
  }

  if (error?.status === 404) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>Tagihan tidak ditemukan</h2>
        <p style={{ marginTop: 12, color: '#57606a', lineHeight: 1.5 }}>
          Tagihan dengan ID <code style={{ fontSize: 13 }}>{id}</code> tidak ada dalam sistem.
        </p>
        <div style={{ marginTop: 16 }}>
          <button type="button" style={btnStyle} onClick={() => router.back()}>
            Kembali
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>Gagal memuat tagihan</h2>
        <p style={{ marginTop: 12, color: '#cf222e' }}>{error.message}</p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btnStyle} onClick={() => void load()}>
            Coba lagi
          </button>
          <button type="button" style={btnStyle} onClick={() => router.back()}>
            Kembali
          </button>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div style={{ padding: 24 }}>
        <p>Data tagihan tidak tersedia.</p>
        <button type="button" style={{ ...btnStyle, marginTop: 12 }} onClick={() => router.back()}>
          Kembali
        </button>
      </div>
    );
  }

  const fileHref = fixFileUrl(row.invoiceFileUrl);

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Link href="/supplier-invoices" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Daftar tagihan
      </Link>
      <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{row.invoiceNumber}</h1>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 20, fontSize: 14 }}>
        <p>
          <strong>Status:</strong> {SUPPLIER_INVOICE_STATUS_LABELS[row.status].label}
        </p>
        <p>
          <strong>Nominal:</strong> {row.invoiceAmount}
        </p>
        <p>
          <strong>Metode pembayaran:</strong> {PAYMENT_METHOD_LABELS[row.paymentMethod]}
        </p>
        <p>
          <strong>Jatuh tempo:</strong> {row.paymentDueDate ? new Date(row.paymentDueDate).toLocaleString('id-ID') : '—'}
        </p>
        <p>
          <strong>Order ID:</strong> {row.orderId}
        </p>
        <p>
          <strong>Supplier ID:</strong> {row.supplierId}
        </p>
        {row.supplierRejectionReason ? (
          <p style={{ color: '#CF222E' }}>
            <strong>Alasan tolak supplier:</strong> {row.supplierRejectionReason}
          </p>
        ) : null}
        <p style={{ marginTop: 16 }}>
          <a href={fileHref} target="_blank" rel="noreferrer" style={{ color: '#0969DA' }}>
            Buka lampiran tagihan
          </a>
        </p>
      </div>
    </div>
  );
}
