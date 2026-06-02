'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft, CheckCircle, XCircle, RotateCcw, Download } from 'lucide-react';
import { apiGet, apiPost, fixFileUrl } from '../../../../lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '../../../../store/authStore';
import type { StockOut } from '../../../../types/api.types';
import { STOCK_OUT_STATUS_LABELS } from '../../../../types/api.types';

const ReasonSchema = z.object({ reason: z.string().min(1, 'Alasan wajib').max(1000) });
const DoSchema = z.object({ doNumber: z.string().min(1, 'DO Number wajib diisi') });

type StockOutDetail = StockOut & {
  requestedBy?: { id: string; name: string };
  fulfilledBy?: { id: string; name: string } | null;
  adminStockApprover?: { id: string; name: string } | null;
  pmConfirmer?: { id: string; name: string } | null;
  financeApprover?: { id: string; name: string } | null;
  permitCluster?: { id: string; clusterCode?: string | null } | null;
  suratJalan?: { id: string; documentNumber: string; pdfUrl: string | null; status: string } | null;
};

const STEP_STATUS_MAP = {
  DRAFT:              1,
  PENDING:            1,
  PENDING_PM_CONFIRM: 2,
  PENDING_FINANCE:    3,
  FULFILLED:          4,
  REJECTED:           0,
} as const;

const STATUS_COLOR: Record<string, string> = {
  DRAFT:              'bg-orange-100 text-orange-800',
  PENDING:            'bg-amber-100 text-amber-800',
  PENDING_PM_CONFIRM: 'bg-blue-100 text-blue-800',
  PENDING_FINANCE:    'bg-purple-100 text-purple-800',
  FULFILLED:          'bg-emerald-100 text-emerald-800',
  REJECTED:           'bg-red-100 text-red-800',
};

export default function StockOutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [row, setRow] = useState<StockOutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Admin Stock fields
  const [doNumber, setDoNumber] = useState('');
  // Return / reject reason
  const [reason, setReason] = useState('');

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

  useEffect(() => { void load(); }, [load]);

  const act = async (endpoint: string, body: Record<string, unknown> = {}) => {
    setBusy(endpoint);
    try {
      await apiPost(`/stock-out/${id}/${endpoint}`, body);
      toast.success('Berhasil');
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !row) return <div style={{ padding: 24 }}>Memuat…</div>;
  if (!row) return <div style={{ padding: 24 }}>Data tidak ditemukan.</div>;

  const role = user?.role;
  const isAdminStock  = role === 'ADMIN_STOCK';
  const isFinance     = role === 'FINANCE';
  const isPM          = row.requestedById === user?.id && ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'].includes(role ?? '');
  const statusLabel   = STOCK_OUT_STATUS_LABELS[row.status];
  const step          = STEP_STATUS_MAP[row.status] ?? 0;

  const downloadSJ = async () => {
    if (!row.suratJalan?.id) return;
    try {
      const result = await apiGet<{ url: string }>(`/surat-jalan/${row.suratJalan.id}/download-url`);
      window.open(fixFileUrl(result.url), '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Gagal mendapat link unduhan');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <Link href="/stock-out" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Stock Out
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{row.requestNumber}</h1>
          <p style={{ margin: '4px 0 0', color: '#57606a', fontSize: 14 }}>
            Pemohon: {row.requestedBy?.name ?? row.requestedById}
            {row.permitCluster?.clusterCode ? ` • Cluster ${row.permitCluster.clusterCode}` : ''}
          </p>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${STATUS_COLOR[row.status] ?? 'bg-slate-100 text-slate-700'}`}>
          {statusLabel.label}
        </span>
      </div>

      {/* Progress steps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20 }}>
        {[
          { n: 1, label: 'Admin Stock' },
          { n: 2, label: 'Konfirmasi PM' },
          { n: 3, label: 'Finance' },
          { n: 4, label: 'Selesai' },
        ].map(({ n, label }, idx) => (
          <React.Fragment key={n}>
            <div style={{ textAlign: 'center', minWidth: 72 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', margin: '0 auto 4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: step >= n ? '#00D4B4' : step === 0 && n === 1 ? '#CF222E' : '#EAEEF2',
                color: step >= n ? '#0D1117' : '#57606a',
              }}>{n}</div>
              <div style={{ fontSize: 10, color: '#57606a', lineHeight: 1.3 }}>{label}</div>
            </div>
            {idx < 3 && <div style={{ flex: 1, height: 2, background: step > n ? '#00D4B4' : '#EAEEF2', marginBottom: 18 }} />}
          </React.Fragment>
        ))}
      </div>

      {/* Revision note */}
      {row.revisionNotes && (
        <div style={{ background: '#FFF8F0', border: '1px solid #FFA500', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <strong>Catatan revisi:</strong> {row.revisionNotes}
        </div>
      )}

      {/* Request info */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, marginBottom: 12 }}>
          {row.recipient && (
            <div><span style={{ color: '#57606a' }}>Up./Penerima:</span> <strong>{row.recipient}</strong></div>
          )}
          {row.doNumber && (
            <div><span style={{ color: '#57606a' }}>DO Number:</span> <strong>{row.doNumber}</strong></div>
          )}
        </div>
        <strong style={{ fontSize: 14 }}>Item Barang</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(Array.isArray(row.items) ? row.items : []).map((it, i) => (
            <li key={`${it.stockItemId}-${i}`} style={{ marginBottom: 6 }}>
              {it.itemName || it.stockItemId} × {it.qty}
              {it.notes ? ` — ${it.notes}` : ''}
            </li>
          ))}
        </ul>
        {row.notes && <p style={{ marginTop: 8, fontSize: 13, color: '#57606a' }}><strong>Catatan:</strong> {row.notes}</p>}
      </div>

      {/* Approval trail */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
        <strong style={{ fontSize: 14 }}>Riwayat Persetujuan</strong>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          {row.adminStockApprover && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} style={{ color: '#2DA44E', flexShrink: 0 }} />
              <span><strong>Admin Stock:</strong> {row.adminStockApprover.name}
                {row.adminStockApprovedAt ? ` — ${new Date(row.adminStockApprovedAt).toLocaleString('id-ID')}` : ''}
                {row.doNumber ? ` • DO: ${row.doNumber}` : ''}
              </span>
            </div>
          )}
          {row.pmConfirmer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} style={{ color: '#2DA44E', flexShrink: 0 }} />
              <span><strong>PM Konfirmasi:</strong> {row.pmConfirmer.name}
                {row.pmConfirmedAt ? ` — ${new Date(row.pmConfirmedAt).toLocaleString('id-ID')}` : ''}
              </span>
            </div>
          )}
          {row.financeApprover && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} style={{ color: '#2DA44E', flexShrink: 0 }} />
              <span><strong>Finance:</strong> {row.financeApprover.name}
                {row.financeApprovedAt ? ` — ${new Date(row.financeApprovedAt).toLocaleString('id-ID')}` : ''}
              </span>
            </div>
          )}
          {!row.adminStockApprover && !row.pmConfirmer && !row.financeApprover && (
            <p style={{ color: '#57606a', margin: 0 }}>Belum ada approval.</p>
          )}
        </div>
      </div>

      {/* Surat Jalan download */}
      {row.suratJalan && (
        <div style={{ background: '#F0FFF8', border: '1px solid #2DA44E', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13 }}>
            <strong>Surat Jalan:</strong> {row.suratJalan.documentNumber}
          </div>
          <button
            type="button"
            onClick={() => { void downloadSJ(); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#2DA44E', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >
            <Download size={15} /> Unduh PDF
          </button>
        </div>
      )}

      {/* ── Action panels ── */}

      {/* Admin Stock: PENDING → approve (with DO#) or return to PM */}
      {isAdminStock && row.status === 'PENDING' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>Admin Stock — Tindakan</p>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            <span>DO Number <span style={{ color: '#CF222E' }}>*</span></span>
            <input
              value={doNumber}
              onChange={(e) => setDoNumber(e.target.value)}
              placeholder="Contoh: DO-2026-001"
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={busy !== null || !doNumber.trim()}
              onClick={() => {
                const r = DoSchema.safeParse({ doNumber: doNumber.trim() });
                if (r.success === false) { toast.error(r.error.errors[0]?.message ?? 'DO Number wajib'); return; }
                void act('admin-approve', { doNumber: doNumber.trim() });
              }}
              style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, background: busy ? '#8C959F' : '#2DA44E', color: '#fff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === 'admin-approve' ? 'Memproses…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={busy !== null || !reason.trim()}
              onClick={() => {
                const r = ReasonSchema.safeParse({ reason: reason.trim() });
                if (r.success === false) { toast.error(r.error.errors[0]?.message ?? 'Alasan wajib'); return; }
                void act('admin-return', { reason: reason.trim() });
              }}
              style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, background: busy ? '#8C959F' : '#CF222E', color: '#fff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === 'admin-return' ? 'Memproses…' : 'Kembalikan ke PM'}
            </button>
          </div>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            <span>Alasan pengembalian (isi jika mengembalikan)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }} />
          </label>
        </div>
      )}

      {/* PM: PENDING_PM_CONFIRM → confirm or return to Admin Stock */}
      {isPM && row.status === 'PENDING_PM_CONFIRM' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>PM — Konfirmasi</p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#57606a' }}>
            Admin Stock telah menyetujui dengan DO Number: <strong>{row.doNumber}</strong>.
            Pastikan semua data sudah benar sebelum diteruskan ke Finance.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('pm-confirm')}
              style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, background: busy ? '#8C959F' : '#2DA44E', color: '#fff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === 'pm-confirm' ? 'Memproses…' : 'Konfirmasi & Teruskan ke Finance'}
            </button>
          </div>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Alasan pengembalian ke Admin Stock</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }} />
          </label>
          <button
            type="button"
            disabled={busy !== null || !reason.trim()}
            onClick={() => {
              const r = ReasonSchema.safeParse({ reason: reason.trim() });
              if (r.success === false) { toast.error(r.error.errors[0]?.message ?? 'Alasan wajib'); return; }
              void act('pm-return', { reason: reason.trim() });
            }}
            style={{ marginTop: 8, width: '100%', padding: '10px 16px', borderRadius: 8, border: '1px solid #D0D7DE', fontWeight: 600, background: '#fff', color: '#CF222E', cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy === 'pm-return' ? 'Memproses…' : 'Kembalikan ke Admin Stock'}
          </button>
        </div>
      )}

      {/* Finance: PENDING_FINANCE → approve or return to PM */}
      {isFinance && row.status === 'PENDING_FINANCE' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', padding: 16, marginBottom: 16 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>Finance — Approval Final</p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#57606a' }}>
            Setelah approve, stok akan dikurangi dan Surat Jalan akan ter-generate otomatis.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('finance-approve')}
              style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', fontWeight: 600, background: busy ? '#8C959F' : '#2DA44E', color: '#fff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy === 'finance-approve' ? 'Memproses…' : 'Approve & Generate Surat Jalan'}
            </button>
          </div>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Alasan pengembalian ke PM</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }} />
          </label>
          <button
            type="button"
            disabled={busy !== null || !reason.trim()}
            onClick={() => {
              const r = ReasonSchema.safeParse({ reason: reason.trim() });
              if (r.success === false) { toast.error(r.error.errors[0]?.message ?? 'Alasan wajib'); return; }
              void act('finance-return', { reason: reason.trim() });
            }}
            style={{ marginTop: 8, width: '100%', padding: '10px 16px', borderRadius: 8, border: '1px solid #D0D7DE', fontWeight: 600, background: '#fff', color: '#CF222E', cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy === 'finance-return' ? 'Memproses…' : 'Kembalikan ke PM'}
          </button>
        </div>
      )}

      {/* PM: DRAFT → prompt to revise and resubmit */}
      {isPM && row.status === 'DRAFT' && (
        <div style={{ background: '#FFF8F0', border: '1px solid #FFA500', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <p style={{ margin: 0 }}>Request ini dikembalikan untuk revisi. Silakan buat permintaan baru atau edit melalui halaman revisi.</p>
        </div>
      )}
    </div>
  );
}
