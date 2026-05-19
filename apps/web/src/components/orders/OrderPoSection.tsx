'use client';

import React, { useState } from 'react';
import { Download, Mail, RefreshCw } from 'lucide-react';
import { apiPost, downloadAuthenticatedBlob } from '../../lib/api';
import { toast } from 'sonner';
import { storageUrlToApiPath } from '../../lib/storage-url';

type OrderPo = Record<string, unknown> & {
  id: string;
  orderNumber?: string;
  poNumber?: string | null;
  poFileUrl?: string | null;
  poGeneratedAt?: string | null;
  poEmailSentAt?: string | null;
  poEmailMessageId?: string | null;
};

export function OrderPoSection({
  order,
  isPurchasing,
  onReload,
}: {
  order: OrderPo;
  isPurchasing: boolean;
  onReload: () => Promise<void>;
}) {
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);

  const poNumber = order.poNumber ? String(order.poNumber) : null;
  const poFileUrl = order.poFileUrl ? String(order.poFileUrl) : null;
  const generatedAt = order.poGeneratedAt ? String(order.poGeneratedAt) : null;
  const sentAt = order.poEmailSentAt ? String(order.poEmailSentAt) : null;
  const msgId = order.poEmailMessageId ? String(order.poEmailMessageId) : null;

  const canShow = !!poNumber || !!poFileUrl;

  const handleDownload = async () => {
    if (!poFileUrl) {
      toast.error('File PO belum tersedia');
      return;
    }
    setDownloading(true);
    try {
      const path = storageUrlToApiPath(poFileUrl);
      const blob = await downloadAuthenticatedBlob(path);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${poNumber ?? 'PO'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success('PO berhasil diunduh');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal unduh PO');
    } finally {
      setDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    setSending(true);
    try {
      await apiPost(`/orders/${order.id}/po/send-email`, {});
      toast.success('Email PO dikirim ke supplier');
      await onReload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal kirim email');
    } finally {
      setSending(false);
    }
  };

  if (!canShow) {
    return (
      <section className="bg-white rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
        <h3 className="font-bold text-slate-800 mb-1">Purchase Order (PO)</h3>
        PO akan dibuat otomatis setelah GM menyetujui order.
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
      <h3 className="font-bold text-slate-800">Purchase Order (PO)</h3>
      <div className="text-sm space-y-1">
        <p>
          <span className="text-slate-500">Nomor PO:</span>{' '}
          <span className="font-mono font-semibold">{poNumber ?? '—'}</span>
        </p>
        {generatedAt ? (
          <p className="text-slate-600">
            Dibuat: {new Date(generatedAt).toLocaleString('id-ID')}
          </p>
        ) : null}
        {sentAt ? (
          <p className="text-emerald-700 font-medium">
            Email terkirim: {new Date(sentAt).toLocaleString('id-ID')}
            {msgId ? <span className="block text-xs text-slate-500 font-mono mt-0.5">Message ID: {msgId}</span> : null}
          </p>
        ) : (
          <p className="text-amber-700">Email PO belum dikirim ke supplier.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={downloading || !poFileUrl}
          onClick={() => void handleDownload()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Mengunduh…' : 'Unduh PDF'}
        </button>
        {isPurchasing ? (
          <button
            type="button"
            disabled={sending || !poFileUrl}
            onClick={() => void handleSendEmail()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0D9488] text-white text-sm font-bold disabled:opacity-50"
          >
            <Mail className="w-4 h-4" />
            {sending ? 'Mengirim…' : sentAt ? 'Kirim ulang email PO' : 'Kirim email PO'}
          </button>
        ) : null}
        {isPurchasing && sentAt ? (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Resend boleh tanpa pembatasan idempotensi (produksi kirim manual).
          </span>
        ) : null}
      </div>
    </section>
  );
}
