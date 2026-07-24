'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileText, ImageIcon, RefreshCw } from 'lucide-react';
import { apiGet, fixFileUrl } from '../../../../lib/api';
import { formatDateID, formatDateTimeID, formatFileSize } from '../../../../lib/format';
import { STATUS_LABELS, StatusBadge, type DailyActivityWorkStatus } from '../_lib/shared';

type PersonRef = { id: string; name: string; email: string };

type DailyActivityEvidence = {
  id: string;
  fileUrl: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
  uploadedBy: PersonRef;
};

type DailyActivityHistory = {
  id: string;
  workStatus: DailyActivityWorkStatus;
  remarks: string | null;
  targetDoneAt: string | null;
  createdAt: string;
  changedBy: PersonRef;
};

type DailyActivityDetail = {
  id: string;
  timestamp: string;
  siteName: string | null;
  scopeOfWork: string;
  workStatus: DailyActivityWorkStatus;
  evidenceUrl: string | null;
  targetDoneAt: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  actor: PersonRef;
  updatedBy: PersonRef | null;
  financeProject: { id: string; code: string; name: string } | null;
  ftttProject: { id: string; projectName: string | null; ftttCompany: string } | null;
  evidences: DailyActivityEvidence[];
  history: DailyActivityHistory[];
};

function isImageFile(ev: DailyActivityEvidence): boolean {
  if (ev.mimeType?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(ev.originalFileName ?? ev.fileUrl);
}

function isPdfFile(ev: DailyActivityEvidence): boolean {
  if (ev.mimeType === 'application/pdf') return true;
  return /\.pdf$/i.test(ev.originalFileName ?? ev.fileUrl);
}

function fileNameOf(ev: DailyActivityEvidence): string {
  return ev.originalFileName || ev.fileUrl.split('/').pop() || 'berkas';
}

function EvidenceCard({ evidence }: { evidence: DailyActivityEvidence }) {
  const url = fixFileUrl(evidence.fileUrl);
  const isImage = isImageFile(evidence);
  const isPdf = isPdfFile(evidence);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden flex flex-col">
      <a href={url} target="_blank" rel="noopener noreferrer" className="block bg-slate-50 h-40 flex items-center justify-center overflow-hidden">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={fileNameOf(evidence)} className="w-full h-full object-cover" />
        ) : isPdf ? (
          <iframe src={url} title={fileNameOf(evidence)} className="w-full h-full pointer-events-none" />
        ) : (
          <FileText className="w-10 h-10 text-slate-400" />
        )}
      </a>
      <div className="p-3 space-y-1.5 flex-1 flex flex-col">
        <div className="text-xs font-bold text-slate-800 truncate" title={fileNameOf(evidence)}>
          {fileNameOf(evidence)}
        </div>
        <div className="text-[11px] text-slate-500">{formatFileSize(evidence.fileSize)}</div>
        <div className="text-[11px] text-slate-500">Diunggah {formatDateTimeID(evidence.createdAt)}</div>
        <div className="text-[11px] text-slate-500">Oleh {evidence.uploadedBy?.name ?? '-'}</div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={fileNameOf(evidence)}
          className="mt-auto inline-flex items-center gap-1 text-[11px] font-bold text-[#0969DA] pt-1"
        >
          <Download className="w-3 h-3" />
          Unduh
        </a>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

export default function DailyActivityDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [detail, setDetail] = useState<DailyActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiGet<DailyActivityDetail>(`/daily-activities/${id}`);
      setDetail(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat detail aktivitas');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pb-12 space-y-6">
      <Link
        href="/daily-activity"
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-[#00D4B4]"
      >
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : !detail ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
          Daily activity tidak ditemukan.
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-black text-slate-900">{detail.scopeOfWork}</h1>
                <StatusBadge status={detail.workStatus} />
              </div>
              <p className="text-sm text-slate-500 mt-1">
                {detail.siteName || detail.financeProject?.name || detail.ftttProject?.projectName || 'Tanpa site/proyek'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 self-start"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </header>

          {/* 1. General info */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 mb-4">Informasi Umum</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <InfoRow label="Waktu" value={formatDateTimeID(detail.timestamp)} />
              <InfoRow
                label="Actor"
                value={`${(detail.updatedBy ?? detail.actor)?.name ?? '-'} (${(detail.updatedBy ?? detail.actor)?.email ?? '-'})`}
              />
              <InfoRow
                label="Proyek"
                value={detail.financeProject?.name || detail.ftttProject?.projectName || '—'}
              />
              <InfoRow label="Site" value={detail.siteName || '—'} />
              <InfoRow label="Scope of Work" value={detail.scopeOfWork} />
              <InfoRow label="Status" value={STATUS_LABELS[detail.workStatus].label} />
              <InfoRow label="Target Selesai" value={formatDateID(detail.targetDoneAt)} />
              <InfoRow
                label="Update Terakhir Oleh"
                value={detail.updatedBy ? `${detail.updatedBy.name} · ${formatDateTimeID(detail.updatedAt)}` : '—'}
              />
              <InfoRow label="Keterangan" value={detail.remarks || '—'} />
            </div>
          </section>

          {/* 2. Bukti Pekerjaan */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 mb-4">Bukti Pekerjaan</h2>
            {detail.evidences.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-500">Belum ada berkas bukti pekerjaan yang diunggah.</p>
                {detail.evidenceUrl && (
                  <a
                    href={fixFileUrl(detail.evidenceUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0969DA]"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Lihat evidence (legacy URL)
                  </a>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {detail.evidences.map((ev) => (
                  <EvidenceCard key={ev.id} evidence={ev} />
                ))}
              </div>
            )}
          </section>

          {/* 3. Riwayat Update */}
          <section className="rounded-2xl border border-slate-100 bg-white p-5">
            <h2 className="text-sm font-black text-slate-900 mb-4">Riwayat Update</h2>
            {detail.history.length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada riwayat perubahan status.</p>
            ) : (
              <ol className="relative border-l border-slate-200 pl-5 space-y-5">
                {detail.history.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-[#00D4B4] border-2 border-white" />
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={h.workStatus} />
                      <span className="text-xs text-slate-500">{formatDateTimeID(h.createdAt)}</span>
                    </div>
                    <div className="text-sm text-slate-700 mt-1">
                      Diubah oleh <span className="font-bold">{h.changedBy?.name ?? '-'}</span>
                      {h.targetDoneAt ? ` · Target selesai ${formatDateID(h.targetDoneAt)}` : ''}
                    </div>
                    {h.remarks && <div className="text-xs text-slate-500 mt-1">{h.remarks}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
