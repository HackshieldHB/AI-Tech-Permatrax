'use client';

import React, { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download, PlusCircle, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../../../store/authStore';
import { apiFetch } from '../../../../lib/auth';
import { apiPost, uploadFile, downloadAuthenticatedBlob } from '../../../../lib/api';
import { toast } from 'sonner';
import { OrderWorkflowStepper } from '../../../../components/orders/OrderWorkflowStepper';
import { OrderPoSection } from '../../../../components/orders/OrderPoSection';
import { OrderPurchasingPanel } from '../../../../components/orders/OrderPurchasingPanel';
import { SimpleModal } from '../../../../components/ui/SimpleModal';

const LEGACY_STEPS = ['DRAFT', 'SUBMITTED', 'STOCK_AVAILABLE', 'FULFILLED'];

const APPROVAL_FLOW_STATUSES = new Set([
  'PENDING_ADMIN_STOCK',
  'PENDING_PURCHASING_INPUT',
  'PENDING_OPS_APPROVAL',
  'REJECTED_BY_OPS',
  'PENDING_GM_APPROVAL',
  'REJECTED_BY_GM',
  'PENDING_PAYMENT_RECEIPT',
  'PURCHASED',
  'PENDING_VERIFICATION',
]);

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  DRAFT: { label: 'Draft', icon: '📝', color: '#9CA3AF', bg: '#9CA3AF12' },
  SUBMITTED: { label: 'Diproses…', icon: '⚙️', color: '#3B82F6', bg: '#3B82F612' },
  STOCK_AVAILABLE: { label: 'Surat Jalan Siap', icon: '📄', color: '#22C55E', bg: '#22C55E12' },
  PARTIAL_STOCK: { label: 'Sebagian — SJ + PR', icon: '📦', color: '#0EA5E9', bg: '#0EA5E912' },
  NO_STOCK: { label: 'Pembelian Diperlukan', icon: '🛒', color: '#EF4444', bg: '#EF444412' },
  PENDING_ADMIN_STOCK: { label: 'Menunggu Admin Stok', icon: '📋', color: '#3B82F6', bg: '#3B82F612' },
  PENDING_PURCHASING_INPUT: { label: 'Menunggu Purchasing (harga)', icon: '🏷️', color: '#0D9488', bg: '#0D948812' },
  PENDING_OPS_APPROVAL: { label: 'Menunggu Ops Manager', icon: '⏳', color: '#F59E0B', bg: '#F59E0B12' },
  REJECTED_BY_OPS: { label: 'Ditolak Ops Manager', icon: '❌', color: '#EF4444', bg: '#EF444412' },
  PENDING_GM_APPROVAL: { label: 'Menunggu General Manager', icon: '⏳', color: '#8B5CF6', bg: '#8B5CF612' },
  REJECTED_BY_GM: { label: 'Ditolak GM', icon: '❌', color: '#EF4444', bg: '#EF444412' },
  PENDING_PAYMENT_RECEIPT: { label: 'Menunggu pembayaran / bukti', icon: '💳', color: '#06B6D4', bg: '#06B6D412' },
  PENDING_FINANCE: { label: 'Menunggu Finance (legacy)', icon: '💳', color: '#06B6D4', bg: '#06B6D412' },
  PURCHASED: { label: 'Sudah Dibeli', icon: '🚚', color: '#F59E0B', bg: '#F59E0B12' },
  PENDING_VERIFICATION: { label: 'Verifikasi Barang', icon: '🔍', color: '#F59E0B', bg: '#F59E0B12' },
  FULFILLED: { label: 'Selesai', icon: '✅', color: '#22C55E', bg: '#22C55E12' },
  CANCELLED: { label: 'Dibatalkan', icon: '🚫', color: '#6B7280', bg: '#6B728012' },
};

// FIX: badge header saat Admin Stok revisi setelah tolak Ops/GM
function getHeaderStatusConfig(
  order: Record<string, unknown>,
  statusStr: string,
): { label: string; icon: string; color: string; bg: string } {
  const revCount = Number(order.revisionCount ?? 0);
  const hasRej = Boolean(order.opsRejectionReason || order.gmRejectionReason);
  // FIX: revisi bisa tampil juga saat order masih DRAFT (setelah tolak, jarang)
  if ((statusStr === 'PENDING_ADMIN_STOCK' || statusStr === 'DRAFT') && (revCount > 0 || hasRej)) {
    return {
      label: `Revisi Admin Stok (ke-${revCount || 1})`,
      icon: '↺',
      color: '#EF4444',
      bg: '#EF444412',
    };
  }
  return STATUS_CONFIG[statusStr] ?? STATUS_CONFIG.DRAFT;
}

interface PurchaseItem {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  notes: string;
}

function formatRp(n: number): string {
  return `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
}

export default function OrderDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuthStore();
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([
    { name: '', quantity: 1, unit: 'pcs', unitPrice: 0, totalPrice: 0, notes: '' },
  ]);
  const [adminNotes, setAdminNotes] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'SESUAI' | 'TIDAK_SESUAI' | ''>('');
  const [verifyNotes, setVerifyNotes] = useState('');
  const [financeReceiptUrl, setFinanceReceiptUrl] = useState('');
  const [tagihanModalOpen, setTagihanModalOpen] = useState(false);
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CBD' | 'COD' | 'TERMIN'>('CBD');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [tagihanFileUploading, setTagihanFileUploading] = useState(false);
  const [invoiceFileUrlState, setInvoiceFileUrlState] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const isAdminStock = user?.role === 'ADMIN_STOCK';
  const isOps = user?.role === 'OPERATIONAL_MANAGER';
  const isGM = user?.role === 'GENERAL_MANAGER';
  const isFinance = user?.role === 'FINANCE';
  const isPurchasing = user?.role === 'PURCHASING';
  const isPM = ['PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR'].includes(user?.role ?? ''); // FIX: gate Surat Jalan
  const isAdminSJ = user?.role === 'ADMIN'; // FIX: PM atau Admin — akses unduh SJ

  const load = useCallback(async () => {
    setPageLoading(true);
    try {
      const res = await apiFetch(`/orders/${id}`, {}, user?.id);
      if (!res.ok) throw new Error('Order tidak ditemukan');
      const data = (await res.json()) as Record<string, unknown>;
      setOrder(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
      setOrder(null);
    } finally {
      setPageLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // FIX: pre-fill from PM's items when loading
  useEffect(() => {
    if (!order) return;
    const purchase = order.purchaseItems as PurchaseItem[] | undefined;
    const requested = order.requestedItems as
      | { name?: string; itemName?: string; quantity?: number; qty?: number; unit?: string; notes?: string }[]
      | undefined;
    const catalog = order.items as Record<string, unknown>[] | undefined;
    if (Array.isArray(purchase) && purchase.length > 0) {
      setPurchaseItems(
        purchase.map((p) => ({
          name: p.name ?? '',
          quantity: Number(p.quantity) || 1,
          unit: p.unit ?? 'pcs',
          unitPrice: Number(p.unitPrice) || 0,
          totalPrice: Number(p.totalPrice) || Number(p.quantity || 0) * Number(p.unitPrice || 0),
          notes: (p.notes as string) ?? '',
        })),
      );
    } else if (Array.isArray(requested) && requested.length > 0) {
      setPurchaseItems(
        requested.map((item) => ({
          name: item.name ?? item.itemName ?? '',
          quantity: item.quantity ?? item.qty ?? 1,
          unit: item.unit ?? 'pcs',
          unitPrice: 0,
          totalPrice: 0,
          notes: item.notes ?? '',
        })),
      );
    } else if (Array.isArray(catalog) && catalog.length > 0) {
      // FIX: pre-populate dari baris katalog/stok PM (DRAFT / legacy)
      setPurchaseItems(
        catalog.map((it) => {
          const up = Number(it.unitPrice) || 0;
          const q = Number(it.requestedQty) || 1;
          return {
            name: String(it.itemName ?? ''),
            quantity: q,
            unit: String(it.unit ?? 'pcs'),
            unitPrice: up,
            totalPrice: Number(it.totalPrice) || up * q,
            notes: '',
          };
        }),
      );
    } else {
      setPurchaseItems([{ name: '', quantity: 1, unit: 'pcs', unitPrice: 0, totalPrice: 0, notes: '' }]);
    }
  }, [order]);

  const handleDownloadSj = async () => {
    const sj = order?.suratJalan as { documentNumber?: string } | undefined;
    if (!sj?.documentNumber) return;
    setDownloading(true);
    try {
      const blob = await downloadAuthenticatedBlob(`/surat-jalan/by-order/${id}/download`);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `SJ-${String(sj.documentNumber).replace(/\//g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success('Surat Jalan berhasil diunduh');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal unduh PDF');
    } finally {
      setDownloading(false);
    }
  };

  const updatePurchaseItem = (idx: number, field: keyof PurchaseItem, value: string | number) => {
    setPurchaseItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        // FIX: total otomatis dari qty × harga satuan
        if (field === 'quantity' || field === 'unitPrice') {
          updated.totalPrice = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      }),
    );
  };

  const grandTotal = purchaseItems.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);

  const handleAdminStockSubmit = async () => {
    const validItems = purchaseItems.filter((i) => i.name.trim());
    if (!validItems.length) {
      toast.error('Minimal 1 item harus diisi');
      return;
    }
    // ISSUE 1.1 FIX: ADMIN_STOCK does not input price — Purchasing will handle it
    // Price validation removed for ADMIN_STOCK; unitPrice defaults to 0
    const itemsForSubmit = validItems.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      unitPrice: i.unitPrice || 0,
      totalPrice: (i.unitPrice || 0) * i.quantity,
      notes: i.notes,
    }));
    setSaving(true);
    try {
      await apiPost(`/orders/${id}/admin-stock-submit`, {
        purchaseItems: itemsForSubmit,
        adminStockNotes: adminNotes,
      });
      toast.success('Order disubmit — menunggu Purchasing (M3) / tahap berikutnya');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal submit');
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (endpoint: string, msg: string, extra?: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiPost(`/orders/${id}/${endpoint}`, { notes: approvalNotes, ...extra });
      toast.success(msg);
      setApprovalNotes('');
      if (endpoint === 'finance-process') setFinanceReceiptUrl('');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async (endpoint: string, msg: string) => {
    if (!approvalNotes.trim()) {
      toast.error('Alasan penolakan wajib diisi');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/orders/${id}/${endpoint}`, { notes: approvalNotes });
      toast.success(msg);
      setApprovalNotes('');
      setShowReject(false);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyStatus) {
      toast.error('Pilih status verifikasi');
      return;
    }
    if (verifyStatus === 'TIDAK_SESUAI' && !verifyNotes.trim()) {
      toast.error('Isi keterangan ketidaksesuaian');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/orders/${id}/verify-items`, {
        status: verifyStatus,
        verificationNotes: verifyNotes,
      });
      toast.success(verifyStatus === 'SESUAI' ? 'Barang sesuai — PM diberitahu' : 'Status pending verifikasi');
      setVerifyStatus('');
      setVerifyNotes('');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal verifikasi');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: 7,
    fontSize: 13,
    border: '1.5px solid var(--color-border-tertiary)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-primary)',
    outline: 'none',
  };

  if (pageLoading && !order) {
    return (
      <div className="max-w-4xl space-y-6 p-4">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-28 bg-slate-100 rounded-2xl animate-pulse" />
        <div className="h-20 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-4xl p-6 rounded-2xl border border-slate-200 bg-white text-center space-y-4">
        <p className="text-slate-600">Order tidak dapat dimuat atau tidak ditemukan.</p>
        <button
          type="button"
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold"
          onClick={() => void load()}
        >
          Coba lagi
        </button>
        <Link href="/orders" className="block text-sm text-[#00D4B4]">
          ← Kembali ke daftar
        </Link>
      </div>
    );
  }

  const statusStr = String(order.status);
  const orderTrigger = order.orderTrigger === 'STOCK_RESTOCK' ? 'STOCK_RESTOCK' : 'PROJECT_REQUEST';
  const sc = getHeaderStatusConfig(order, statusStr); // FIX: indikator revisi di header
  const requestedItems = (Array.isArray(order.requestedItems) ? order.requestedItems : []) as Record<string, unknown>[];
  const purchaseFromOrder = (Array.isArray(order.purchaseItems) ? order.purchaseItems : []) as PurchaseItem[];
  const catalogItems = (Array.isArray(order.items) ? order.items : []) as Record<string, unknown>[];
  const creator = order.creator as { name?: string; role?: string } | undefined;
  const revisionCount = Number(order.revisionCount ?? 0); // FIX: siklus revisi
  const isRevisionFlow =
    Boolean(order.opsRejectionReason || order.gmRejectionReason) && revisionCount > 0; // FIX: submit revisi
  const legacyStepIndex = Math.max(
    0,
    LEGACY_STEPS.indexOf(
      statusStr === 'PARTIAL_STOCK' || statusStr === 'NO_STOCK' ? 'STOCK_AVAILABLE' : statusStr,
    ),
  );

  const purchasingLineItems = catalogItems.filter((it): it is Record<string, unknown> & { id: string } => typeof it.id === 'string') as Array<{
    id: string;
    itemName: string;
    unit: string;
    requestedQty: number;
  }>;

  const supplierRow = order.supplier as Record<string, unknown> | undefined | null;
  const invoiceRow = order.supplierInvoice as Record<string, unknown> | undefined | null;
  const canCancelStatuses = [
    'DRAFT',
    'SUBMITTED',
    'STOCK_AVAILABLE',
    'PARTIAL_STOCK',
    'NO_STOCK',
    'PENDING_ADMIN_STOCK',
    'PENDING_PURCHASING_INPUT',
    'PENDING_OPS_APPROVAL',
    'PENDING_GM_APPROVAL',
    'PENDING_PAYMENT_RECEIPT',
    'PENDING_FINANCE',
  ];
  const creatorId = String(order.createdBy ?? '');
  const canTryCancel =
    canCancelStatuses.includes(statusStr) &&
    (creatorId === user?.id ||
      user?.role === 'PM_SENIOR' ||
      user?.role === 'FINANCE' ||
      user?.role === 'GENERAL_MANAGER' ||
      user?.role === 'ADMIN');

  const submitFinanceProcess = async () => {
    const body: Record<string, string | undefined> = { notes: approvalNotes.trim() || undefined };
    const ru = financeReceiptUrl.trim();
    if (ru) {
      try {
        // Selaras dengan FinanceProcessDto.receiptUrl (URL valid)
        void new URL(ru);
        body.receiptUrl = ru;
      } catch {
        toast.error('URL bukti pembayaran tidak valid (contoh: https://…)');
        return;
      }
    }
    setSaving(true);
    try {
      await apiPost(`/orders/${id}/finance-process`, body);
      toast.success('Pembayaran / bukti tercatat');
      setApprovalNotes('');
      setFinanceReceiptUrl('');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  };

  const uploadTagihanFile = async (file: File) => {
    setTagihanFileUploading(true);
    try {
      const url = await uploadFile(file, 'supplier-invoices');
      setInvoiceFileUrlState(url);
      toast.success('File berhasil diunggah');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setTagihanFileUploading(false);
    }
  };

  const submitNewTagihan = async () => {
    // PHASE 2: lampiran opsional — payload tidak mengirim string kosong
    const amt = Number(String(invoiceAmount).replace(/\./g, '').replace(',', '.'));
    if (!amt || amt <= 0) {
      toast.error('Nominal tagihan tidak valid.');
      return;
    }
    if (paymentMethod === 'TERMIN' && !paymentDueDate) {
      toast.error('Tanggal jatuh tempo wajib untuk TERMIN.');
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        orderId: id,
        invoiceAmount: amt,
        paymentMethod,
        paymentDueDate:
          paymentMethod === 'TERMIN' ? new Date(`${paymentDueDate}T12:00:00.000Z`).toISOString() : undefined,
      };
      const url = invoiceFileUrlState?.trim();
      if (url) payload.invoiceFileUrl = url;
      await apiPost('/supplier-invoices', payload);
      toast.success('Tagihan tersimpan (DRAFT)');
      setTagihanModalOpen(false);
      setInvoiceFileUrlState(null);
      setInvoiceAmount('');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan tagihan');
    }
  };

  const submitCancelOrder = async () => {
    if (!cancelReasonInput.trim()) {
      toast.error('Alasan pembatalan wajib.');
      return;
    }
    setCancelSubmitting(true);
    try {
      await apiPost(`/orders/${id}/cancel`, { reason: cancelReasonInput.trim() });
      toast.success('Order dibatalkan');
      setCancelModalOpen(false);
      setCancelReasonInput('');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Tidak dapat membatalkan order');
    } finally {
      setCancelSubmitting(false);
    }
  };

  // FIX: form harga — alur approval + katalog setelah submit (NO_STOCK / PARTIAL_STOCK memakai baris items)
  const showAdminStockPricing =
    isAdminStock &&
    (statusStr === 'PENDING_ADMIN_STOCK' ||
      statusStr === 'DRAFT' ||
      statusStr === 'NO_STOCK' ||
      statusStr === 'PARTIAL_STOCK');

  return (
    <div className="max-w-4xl space-y-8">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-[#00D4B4]">
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>

      <div
        className="rounded-2xl border p-5 flex flex-wrap justify-between gap-3"
        style={{ background: sc.bg, borderColor: `${sc.color}40` }}
      >
        <div>
          <h2 className="text-2xl font-black text-slate-800">
            {sc.icon} {String(order.orderNumber)}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {String(order.fiberType)} · {String(order.projectRef ?? '—')} · {creator?.name ?? '—'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className="self-start px-4 py-1.5 rounded-full text-xs font-bold"
            style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.color}55` }}
          >
            {sc.label}
          </span>
          <span className="text-[10px] uppercase font-bold text-slate-500">
            {orderTrigger === 'STOCK_RESTOCK' ? '📦 STOCK_RESTOCK' : '🏗 PROJECT_REQUEST'}
          </span>
        </div>
      </div>

      {APPROVAL_FLOW_STATUSES.has(statusStr) ||
      requestedItems.length > 0 ||
      statusStr === 'FULFILLED' ||
      ['PENDING_PAYMENT_RECEIPT', 'PURCHASED', 'PENDING_VERIFICATION', 'CANCELLED'].includes(statusStr) ? (
        <OrderWorkflowStepper
          orderTrigger={orderTrigger}
          status={statusStr}
          cancelReason={order.cancelReason != null ? String(order.cancelReason) : undefined}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {LEGACY_STEPS.map((s, i) => (
            <div
              key={s}
              className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                i <= legacyStepIndex ? 'bg-[#00D4B4]/20 text-[#0F1B2D]' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {s.replace(/_/g, ' ')}
            </div>
          ))}
        </div>
      )}

      {canTryCancel && statusStr !== 'CANCELLED' ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-sm font-bold text-red-700 border border-red-200 px-3 py-2 rounded-xl hover:bg-red-50"
            onClick={() => setCancelModalOpen(true)}
          >
            Batalkan order
          </button>
        </div>
      ) : null}

      {statusStr === 'PENDING_PURCHASING_INPUT' && isPurchasing && purchasingLineItems.length > 0 ? (
        <OrderPurchasingPanel orderId={id} items={purchasingLineItems} onDone={load} />
      ) : null}

      {(statusStr === 'PENDING_PAYMENT_RECEIPT' ||
        statusStr === 'PENDING_FINANCE' ||
        statusStr === 'PURCHASED' ||
        statusStr === 'PENDING_VERIFICATION' ||
        statusStr === 'FULFILLED') && (
        <>
          {(statusStr !== 'FULFILLED' || order.poNumber) && (
            <OrderPoSection
              order={order as Parameters<typeof OrderPoSection>[0]['order']}
              isPurchasing={isPurchasing}
              onReload={load}
            />
          )}
          {supplierRow?.name ? (
            <section className="bg-white rounded-2xl border border-slate-100 p-5 text-sm">
              <h3 className="font-bold mb-2">Supplier</h3>
              <p>
                <span className="font-mono text-xs">{String(supplierRow.code ?? '')}</span> — {String(supplierRow.name)}
              </p>
              {supplierRow.email ? <p className="text-slate-600">Email: {String(supplierRow.email)}</p> : null}
              {supplierRow.phone ? <p className="text-slate-600">Telp: {String(supplierRow.phone)}</p> : null}
            </section>
          ) : null}
        </>
      )}

      {invoiceRow?.id ? (
        <section className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-bold">
              Tagihan supplier:{' '}
              <span className="font-mono">{String(invoiceRow.invoiceNumber ?? '')}</span>
            </p>
            <p className="text-slate-600">Status: {String(invoiceRow.status ?? '')}</p>
          </div>
          <Link
            href={`/supplier-invoices/${String(invoiceRow.id)}`}
            className="text-sm font-bold text-[#0969DA] underline"
          >
            Buka detail tagihan →
          </Link>
        </section>
      ) : null}

      {(statusStr === 'PENDING_PAYMENT_RECEIPT' || statusStr === 'PENDING_FINANCE') && isFinance ? (
        <section className="bg-white rounded-2xl border border-cyan-200 p-5 space-y-3">
          <h3 className="font-bold">Upload tagihan (Finance)</h3>
          <p className="text-sm text-slate-600">
            Satu tagihan per order. Setelah mengunggah, lanjutkan dari halaman Tagihan Supplier untuk kirim email ke supplier.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold"
            onClick={() => setTagihanModalOpen(true)}
          >
            Form upload tagihan
          </button>
        </section>
      ) : null}

      {(statusStr === 'PURCHASED' || statusStr === 'PENDING_VERIFICATION') && isFinance && invoiceRow?.id ? (
        <section className="bg-white rounded-2xl border border-slate-100 p-5 space-y-2 text-sm">
          <h3 className="font-bold">Kelola tagihan</h3>
          <div className="flex flex-wrap gap-2">
            {String(invoiceRow.status) === 'DRAFT' ? (
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-teal-600 text-white font-bold text-xs"
                onClick={async () => {
                  try {
                    await apiPost(`/supplier-invoices/${String(invoiceRow.id)}/send`, {});
                    toast.success('Tagihan dikirim ke supplier');
                    await load();
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Gagal kirim');
                  }
                }}
              >
                Kirim email ke supplier
              </button>
            ) : null}
            <Link href={`/supplier-invoices/${String(invoiceRow.id)}`} className="px-3 py-2 rounded-xl border text-xs font-bold">
              Detail tagihan
            </Link>
          </div>
        </section>
      ) : null}

      <SimpleModal open={tagihanModalOpen} title="Upload tagihan supplier" onClose={() => setTagihanModalOpen(false)}>
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="font-bold block mb-1">Lampiran (PDF/ZIP) — Opsional</span>
            <input
              type="file"
              accept=".pdf,.zip"
              disabled={tagihanFileUploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadTagihanFile(f);
              }}
            />
            {invoiceFileUrlState ? <p className="text-xs text-emerald-700 mt-1 break-all">{invoiceFileUrlState}</p> : null}
          </label>
          <label className="block">
            <span className="font-bold">Nominal (Rp)</span>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2 mt-1"
              placeholder="Mis. 12500000"
              value={invoiceAmount}
              onChange={(e) => setInvoiceAmount(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="font-bold">Metode bayar</span>
            <select
              value={paymentMethod}
              className="w-full rounded-lg border px-3 py-2 mt-1"
              onChange={(e) => setPaymentMethod(e.target.value as 'CBD' | 'COD' | 'TERMIN')}
            >
              <option value="CBD">CBD</option>
              <option value="COD">COD</option>
              <option value="TERMIN">TERMIN</option>
            </select>
          </label>
          {paymentMethod === 'TERMIN' ? (
            <label className="block">
              <span className="font-bold">Tanggal jatuh tempo</span>
              <input
                type="date"
                className="w-full rounded-lg border px-3 py-2 mt-1"
                value={paymentDueDate}
                onChange={(e) => setPaymentDueDate(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className="w-full py-3 rounded-xl bg-cyan-600 text-white font-bold"
            onClick={() => void submitNewTagihan()}
          >
            Simpan tagihan
          </button>
        </div>
      </SimpleModal>

      <SimpleModal open={cancelModalOpen} title="Batalkan order" onClose={() => !cancelSubmitting && setCancelModalOpen(false)}>
        <p className="text-sm text-slate-600 mb-3">
          Pembatelan mengikuti aturan sistem (refund hanya setelah pemotongan GM jika masih bisa).
        </p>
        <textarea
          rows={4}
          className="w-full rounded-xl border px-3 py-2 text-sm mb-3"
          placeholder="Alasan pembatalan *"
          value={cancelReasonInput}
          onChange={(e) => setCancelReasonInput(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 py-2 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
            disabled={cancelSubmitting}
            onClick={() => void submitCancelOrder()}
          >
            {cancelSubmitting ? 'Memproses…' : 'Konfirmasi batalkan'}
          </button>
          <button type="button" className="px-4 py-2 rounded-xl border text-sm font-bold" onClick={() => setCancelModalOpen(false)}>
            Batal
          </button>
        </div>
      </SimpleModal>

      {requestedItems.length > 0 ? (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <h3 className="font-bold px-4 py-3 border-b bg-slate-50">Item yang diminta (PM)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="px-4 py-2">No</th>
                <th className="px-4 py-2">Nama</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Satuan</th>
                <th className="px-4 py-2">Ket</th>
              </tr>
            </thead>
            <tbody>
              {requestedItems.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="px-4 py-2">{i + 1}</td>
                  <td className="px-4 py-2">{String(item.name ?? '')}</td>
                  <td className="px-4 py-2">{String(item.quantity ?? '')}</td>
                  <td className="px-4 py-2">{String(item.unit ?? '')}</td>
                  <td className="px-4 py-2 text-slate-600">{item.notes != null ? String(item.notes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {(order.opsRejectionReason || order.gmRejectionReason || revisionCount > 0) && (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            📋 Riwayat Revisi
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.opsRejectionReason ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18 }}>⚙️</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#F59E0B' }}>Ditolak Ops Manager</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {String(order.opsRejectionReason)}
                  </div>
                </div>
              </div>
            ) : null}
            {order.gmRejectionReason ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18 }}>👑</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#8B5CF6' }}>Ditolak General Manager</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    {String(order.gmRejectionReason)}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {catalogItems.length > 0 ? (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <h3 className="font-bold px-4 py-3 border-b bg-slate-50">Item katalog / stok</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
                <th className="px-4 py-2">Nama</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Tersedia</th>
              </tr>
            </thead>
            <tbody>
              {catalogItems.map((it: Record<string, unknown>) => (
                <tr key={String(it.id)} className="border-t">
                  <td className="px-4 py-2">{String(it.itemName)}</td>
                  <td className="px-4 py-2">
                    {String(it.requestedQty)} {String(it.unit)}
                  </td>
                  <td className="px-4 py-2">{String(it.availableQty ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {showAdminStockPricing ? (
        <section
          className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
          style={{ borderLeft: '3px solid #3B82F6' }}
        >
          <div
            className="flex flex-wrap justify-between items-start gap-3 px-5 py-3.5 border-b border-slate-100"
            style={{ background: 'var(--color-background-secondary, #f8fafc)' }}
          >
            <div>
              <h3 className="font-bold text-slate-800 text-sm">� Input Item Order</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Isi nama barang, qty, dan satuan. Purchasing akan mengisi harga di tahap berikutnya.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setPurchaseItems((prev) => [
                  ...prev,
                  { name: '', quantity: 1, unit: 'pcs', unitPrice: 0, totalPrice: 0, notes: '' },
                ])
              }
              className="inline-flex items-center gap-1 text-xs font-bold text-primary px-3 py-1.5 rounded-lg"
              style={{ background: '#3B82F615' }}
            >
              <PlusCircle className="w-4 h-4" />
              + Tambah Baris
            </button>
          </div>
          <div className="p-5 space-y-4">
          {order.opsRejectionReason || order.gmRejectionReason ? (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: 10,
                marginBottom: 16,
                background: '#EF444412',
                border: '1.5px solid #EF444440',
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>↺</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#EF4444', marginBottom: 4 }}>
                  Order Dikembalikan untuk Revisi
                  {revisionCount > 0 ? (
                    <span
                      style={{
                        fontSize: 11,
                        marginLeft: 8,
                        background: '#EF444420',
                        padding: '2px 8px',
                        borderRadius: 10,
                      }}
                    >
                      Revisi ke-{revisionCount}
                    </span>
                  ) : null}
                </div>
                {order.opsRejectionReason ? (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    <strong>Alasan Ops:</strong> {String(order.opsRejectionReason)}
                  </div>
                ) : null}
                {order.gmRejectionReason ? (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    <strong>Alasan GM:</strong> {String(order.gmRejectionReason)}
                  </div>
                ) : null}
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6, fontStyle: 'italic' }}>
                  Revisi qty dan harga lalu klik &quot;Submit ke Ops Manager&quot;
                </div>
              </div>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs">
                  {(['No', 'Nama Barang', 'Qty *', 'Satuan', 'Ket', ''] as const).map((h, i) => (
                    <th
                      key={i}
                      className="py-2"
                      style={{
                        color: h.endsWith(' *') ? '#EF4444' : 'var(--color-text-secondary, #64748b)', // FIX: kolom wajib
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchaseItems.map((item, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="py-2">{idx + 1}</td>
                    <td className="py-2 pr-2">
                      <input
                        value={item.name}
                        onChange={(e) => updatePurchaseItem(idx, 'name', e.target.value)}
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="number"
                        min={1}
                        value={item.quantity || ''}
                        onChange={(e) => updatePurchaseItem(idx, 'quantity', Number(e.target.value) || 1)}
                        className="w-16 rounded-lg border px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="py-2">
                      <select
                        value={item.unit}
                        onChange={(e) => updatePurchaseItem(idx, 'unit', e.target.value)}
                        className="rounded-lg border px-2 py-1 text-sm"
                      >
                        {['pcs', 'meter', 'roll', 'box', 'unit', 'set', 'kg', 'liter', 'tabung'].map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* PHASE 2: Price hidden per business requirement */}
                    <td className="py-2">
                      <input
                        value={item.notes}
                        onChange={(e) => updatePurchaseItem(idx, 'notes', e.target.value)}
                        placeholder="Ket"
                        className="w-24 min-w-[5rem] rounded-lg border px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={purchaseItems.length === 1}
                        onClick={() => setPurchaseItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-red-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* PHASE 2: Total hidden per business requirement */}
          <textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Catatan Admin Stok"
            rows={2}
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving || purchaseItems.every((it) => !it.name.trim() || it.quantity <= 0)}
            onClick={() => void handleAdminStockSubmit()}
            className="w-full py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50"
          >
            {isRevisionFlow
              ? `🔄 Submit Revisi ke Ops Manager (Revisi ke-${revisionCount})`
              : '📤 Submit ke Purchasing'}
          </button>
          </div>
        </section>
      ) : null}

      {(purchaseFromOrder.length > 0 || catalogItems.length > 0) && !showAdminStockPricing ? (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3 border-b bg-slate-50">
            <h3 className="font-bold">Rincian pembelian</h3>
            <span className="font-bold text-primary">{formatRp(Number(order.totalAmount ?? 0))}</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Nama</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Harga</th>
                <th className="px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // FIX Issue 4: order.purchaseItems JSON (from Admin Stock) always has unitPrice=0
                // because Admin Stock doesn't enter prices. Purchasing's prices are stored on
                // order.items (catalogItems). Prefer catalogItems when they have real prices.
                const catalogHasPrices = catalogItems.some((it) => Number(it.unitPrice) > 0);
                if (catalogHasPrices) {
                  return catalogItems.map((it, i) => (
                    <tr key={String(it.id)} className="border-t">
                      <td className="px-4 py-2">{i + 1}</td>
                      <td className="px-4 py-2">{String(it.itemName ?? '')}</td>
                      <td className="px-4 py-2">
                        {String(it.requestedQty ?? '')} {String(it.unit ?? '')}
                      </td>
                      <td className="px-4 py-2">{formatRp(Number(it.unitPrice ?? 0))}</td>
                      <td className="px-4 py-2 font-semibold text-primary">
                        {formatRp(Number(it.totalPrice ?? 0))}
                      </td>
                    </tr>
                  ));
                }
                return purchaseFromOrder.map((item, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2">{item.name}</td>
                    <td className="px-4 py-2">
                      {item.quantity} {item.unit}
                    </td>
                    <td className="px-4 py-2">{formatRp(Number(item.unitPrice))}</td>
                    <td className="px-4 py-2 font-semibold text-primary">{formatRp(Number(item.totalPrice))}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </section>
      ) : null}

      {[
        { notes: order.adminStockNotes, by: 'Admin Stok', color: '#3B82F6' },
        { notes: order.opsNotes, by: 'Ops', color: '#F59E0B' },
        { notes: order.gmNotes, by: 'GM', color: '#8B5CF6' },
        { notes: order.financeNotes, by: 'Finance', color: '#06B6D4' },
        { notes: order.verificationNotes, by: 'Verifikasi', color: '#22C55E' },
      ]
        .filter((n) => n.notes != null && String(n.notes).trim() !== '')
        .map((n, i) => (
          <div key={i} className="rounded-xl p-3 text-sm border" style={{ borderColor: `${n.color}44`, background: `${n.color}0d` }}>
            <strong style={{ color: n.color }}>{n.by}:</strong> {String(n.notes)}
          </div>
        ))}

      {isOps && statusStr === 'PENDING_OPS_APPROVAL' ? (
        <>
          {/* FIX: ringkasan untuk Ops — tabel PM & harga di atas (baca saja) */}
          <p className="text-sm text-slate-600 mb-2">
            Tinjau item PM dan rincian harga Admin Stok di atas (baca saja), lalu setujui atau tolak.
          </p>
          <ApprovalSection
            title="Review Ops Manager"
            subtitle={`Total: ${formatRp(Number(order.totalAmount ?? 0))}`}
            notes={approvalNotes}
            onNotesChange={setApprovalNotes}
            showReject={showReject}
            onShowReject={() => setShowReject(true)}
            onHideReject={() => {
              setShowReject(false);
              setApprovalNotes('');
            }}
            onApprove={() => void handleApprove('ops-approve', 'Disetujui — ke GM')}
            onReject={() => void handleReject('ops-reject', 'Ditolak Ops')}
            saving={saving}
            approveLabel="✅ Setujui"
            accentColor="#F59E0B"
          />
        </>
      ) : null}

      {isGM && statusStr === 'PENDING_GM_APPROVAL' ? (
        <>
          {/* FIX: ringkasan untuk GM */}
          <p className="text-sm text-slate-600 mb-2">
            Ringkasan order: total {formatRp(Number(order.totalAmount ?? 0))} — tinjau catatan dan dokumen di atas.
          </p>
          <ApprovalSection
            title="Review General Manager"
            subtitle={`Total: ${formatRp(Number(order.totalAmount ?? 0))}`}
            notes={approvalNotes}
            onNotesChange={setApprovalNotes}
            showReject={showReject}
            onShowReject={() => setShowReject(true)}
            onHideReject={() => {
              setShowReject(false);
              setApprovalNotes('');
            }}
            onApprove={async (extra) => await handleApprove('gm-approve', 'Disetujui — ke Finance', extra)}
            onReject={() => void handleReject('gm-reject', 'Ditolak GM')}
            saving={saving}
            approveLabel="✅ Setujui"
            accentColor="#8B5CF6"
            isGmPoApproval={true}
          />
        </>
      ) : null}

      {isFinance && (statusStr === 'PENDING_PAYMENT_RECEIPT' || statusStr === 'PENDING_FINANCE') ? (
        <section className="bg-white rounded-2xl border-l-4 border-cyan-500 border border-slate-100 p-5 space-y-3">
          <h3 className="font-bold">Proses pembelian (Finance)</h3>
          <p className="text-lg font-bold text-cyan-700">Total: {formatRp(Number(order.totalAmount ?? 0))}</p>
          <p className="text-xs text-slate-500">
            Setelah tagihan dikirim/ACK supplier (jika ada), unggah URL bukti transfer lalu konfirmasi. Biaya sudah dipotong
            budget saat GM menyetujui.
          </p>
          <label className="block text-sm font-medium text-slate-700">
            URL bukti pembayaran (opsional)
            <input
              type="url"
              value={financeReceiptUrl}
              onChange={(e) => setFinanceReceiptUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            />
          </label>
          <textarea
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            rows={2}
            placeholder="Catatan (opsional)"
            className="w-full rounded-xl border px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void submitFinanceProcess()}
            className="w-full py-3 rounded-xl bg-cyan-600 text-white font-bold disabled:opacity-50"
          >
            💳 Konfirmasi pembayaran ke Admin Stok
          </button>
        </section>
      ) : null}

      {isAdminStock && (statusStr === 'PURCHASED' || statusStr === 'PENDING_VERIFICATION') ? (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="font-bold">Verifikasi barang</h3>
          {statusStr === 'PENDING_VERIFICATION' ? (
            <div
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 font-medium"
              role="alert"
            >
              {/* FIX: banner peringatan verifikasi ulang */}
              Barang sebelumnya ditandai tidak sesuai. Periksa ulang, isi keterangan jika perlu, lalu tandai sesuai atau
              tidak sesuai lagi.
            </div>
          ) : null}
          <div className="flex gap-2">
            {(['SESUAI', 'TIDAK_SESUAI'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVerifyStatus(v)}
                className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 ${
                  verifyStatus === v ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'
                }`}
              >
                {v === 'SESUAI' ? '✅ Sesuai' : '❌ Tidak Sesuai'}
              </button>
            ))}
          </div>
          {(verifyStatus === 'TIDAK_SESUAI' || statusStr === 'PENDING_VERIFICATION') && (
            <textarea
              value={verifyNotes}
              onChange={(e) => setVerifyNotes(e.target.value)}
              rows={3}
              placeholder="Keterangan"
              style={inputStyle}
            />
          )}
          <button
            type="button"
            disabled={saving || !verifyStatus || (verifyStatus === 'TIDAK_SESUAI' && !verifyNotes.trim())}
            onClick={() => void handleVerify()}
            className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-50"
          >
            Simpan verifikasi
          </button>
        </section>
      ) : null}

      {/* FIX: Surat Jalan — hanya PM / Admin; unduh via blob terautentikasi */}
      {(isPM || isAdminSJ) && (order.suratJalan || order.suratJalanId) ? (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="font-bold text-slate-800 mb-2">Surat Jalan</h3>
          <p className="text-sm text-slate-600 mb-3">
            {(order.suratJalan as { documentNumber?: string } | undefined)?.documentNumber ?? '—'}
          </p>
          <button
            type="button"
            disabled={downloading || !(order.suratJalan as { documentNumber?: string } | undefined)?.documentNumber}
            onClick={() => void handleDownloadSj()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F1B2D] text-white text-sm font-bold disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Mengunduh…' : 'Unduh PDF'}
          </button>
        </section>
      ) : null}

      {order.purchaseRequest ? (
        <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="font-bold text-slate-800 mb-2">Permintaan Pembelian</h3>
          <p className="text-sm">
            {(order.purchaseRequest as { requestNumber?: string }).requestNumber} —{' '}
            <strong>{(order.purchaseRequest as { status?: string }).status}</strong>
          </p>
        </section>
      ) : null}

      {statusStr === 'FULFILLED' && requestedItems.length > 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 text-sm font-medium">
          {/* FIX: selesai alur approval */}
          Order approval selesai — barang siap diambil PM.
        </div>
      ) : null}
    </div>
  );
}

function ApprovalSection({
  title,
  subtitle,
  notes,
  onNotesChange,
  showReject,
  onShowReject,
  onHideReject,
  onApprove,
  onReject,
  saving,
  approveLabel,
  accentColor,
  isGmPoApproval,
}: {
  title: string;
  subtitle: string;
  notes: string;
  onNotesChange: (v: string) => void;
  showReject: boolean;
  onShowReject: () => void;
  onHideReject: () => void;
  onApprove: (extra?: any) => void;
  onReject: () => void;
  saving: boolean;
  approveLabel: string;
  accentColor: string;
  isGmPoApproval?: boolean;
}) {
  const rejectTrigger = '❌ Tolak'; // FIX: label penolakan eksplisit
  const [sigUrl, setSigUrl] = useState('');
  const [uploadingSig, setUploadingSig] = useState(false);

  const handleSigUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingSig(true);
    try {
      const url = await uploadFile(file, 'signatures');
      setSigUrl(url);
      toast.success('Signature uploaded for this PO');
    } catch (err: any) {
      toast.error('Gagal upload signature: ' + err.message);
    } finally {
      setUploadingSig(false);
    }
  };
  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3" style={{ borderLeftWidth: 4, borderLeftColor: accentColor }}>
      <h3 className="font-bold">{title}</h3>
      <p className="text-sm" style={{ color: accentColor }}>
        {subtitle}
      </p>
      {showReject ? (
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          placeholder="Alasan penolakan *"
          className="w-full rounded-xl border px-3 py-2 text-sm border-red-200"
        />
      ) : (
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
          placeholder="Catatan (opsional)"
          className="w-full rounded-xl border px-3 py-2 text-sm"
        />
      )}
      {!showReject && isGmPoApproval && (
        <div className="bg-slate-50 border p-3 rounded-xl text-sm">
          <p className="font-bold text-slate-700 mb-1">E-Signature untuk PDF PO (Opsional)</p>
          <p className="text-xs text-slate-500 mb-2">Jika Anda memiliki Tanda Tangan di profil, akan otomatis dipakai. Anda bisa unggah manual khusus untuk PO ini.</p>
          <input type="file" accept="image/png, image/jpeg" disabled={uploadingSig} onChange={handleSigUpload} className="text-xs" />
          {uploadingSig && <span className="text-xs text-primary ml-2">Mengunggah...</span>}
          {sigUrl && <span className="text-xs text-emerald-600 ml-2">Terunggah ✓</span>}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {!showReject ? (
          <>
            <button
              type="button"
              disabled={saving || uploadingSig}
              onClick={() => onApprove({ signatureUrl: sigUrl || undefined })}
              className="flex-1 py-2.5 rounded-xl text-white font-bold min-w-[140px]"
              style={{ background: accentColor }}
            >
              {approveLabel}
            </button>
            <button type="button" onClick={onShowReject} className="px-4 py-2.5 rounded-xl border border-red-200 text-red-600 font-bold">
              {rejectTrigger}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={saving || !notes.trim()}
              onClick={onReject}
              className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
            >
              Konfirmasi tolak
            </button>
            <button type="button" onClick={onHideReject} className="px-4 py-2.5 rounded-xl border">
              Batal
            </button>
          </>
        )}
      </div>
    </section>
  );
}
