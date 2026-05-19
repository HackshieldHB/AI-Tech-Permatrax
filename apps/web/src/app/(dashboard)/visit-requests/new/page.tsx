'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { useAuthStore } from '../../../../store/authStore';
import { apiFetch } from '../../../../lib/auth';
import { apiGetPaginated, apiPost } from '../../../../lib/api';
import { toast } from 'sonner';

function NewVisitRequestPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const preselectedId = searchParams.get('cleanListId');

  const [submitting, setSubmitting] = useState(false);
  const [cleanLists, setCleanLists] = useState<Array<{
    id: string;
    rwCode: string;
    kelurahan: string;
    kecamatan?: string;
    ispCustomer: string;
    homepasCount?: number;
    fiberType?: string;
  }>>([]);
  const [clSearch, setClSearch] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<typeof cleanLists[0] | null>(null);
  const [visitDate, setVisitDate] = useState('');
  const [surveyNotes, setSurveyNotes] = useState('');
  const fiberType = user?.fiberType ?? 'FTTH';

  useEffect(() => {
    const fetchClusters = async () => {
      try {
        const json = await apiGetPaginated('/clean-list', {
          status: 'AVAILABLE',
          page: 1,
          limit: 50,
        });
        const rows = json.data as typeof cleanLists;
        setCleanLists(rows);
        if (preselectedId) {
          const pre = rows.find((c) => c.id === preselectedId);
          if (pre) setSelectedCluster(pre);
        }
      } catch {
        /* ignore */
      }
    };
    void fetchClusters();
  }, [user?.id, preselectedId]);

  const filteredClusters = cleanLists.filter(
    (c) =>
      c.rwCode.toLowerCase().includes(clSearch.toLowerCase()) ||
      c.kelurahan.toLowerCase().includes(clSearch.toLowerCase()),
  );

  const parseAndShowApiError = (err: { response?: unknown; message?: string }) => {
    let errorMsg = 'Gagal menyimpan. Coba lagi.';
    const rawResponse = err?.response ?? err?.message;
    if (rawResponse) {
      try {
        const body = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
        if (Array.isArray(body?.message)) {
          const fieldErrors = body.message as Array<{ path: string[]; message: string }>;
          fieldErrors.forEach((e) => toast.error(`${e.path[0]}: ${e.message}`));
          return;
        }
        if (typeof body?.message === 'string') errorMsg = body.message;
      } catch {
        if (typeof err?.message === 'string') errorMsg = err.message;
      }
    } else if (err?.message) errorMsg = err.message;
    toast.error(errorMsg);
  };

  const handleCreateAndSubmit = async () => {
    if (!selectedCluster) {
      toast.error('Pilih cluster terlebih dahulu');
      return;
    }
    if (!visitDate) {
      toast.error('Tanggal kunjungan wajib diisi');
      return;
    }
    setSubmitting(true);
    try {
      const cleanListId = selectedCluster.id;
      const ft = (selectedCluster.fiberType ?? fiberType) as 'FTTH' | 'FTTB' | 'FTTT';
      const created = await apiPost<{ id: string }>('/visit-requests', {
        cleanListId,
        fiberType: ft,
        visitDate: new Date(visitDate).toISOString(),
        surveyNotes: surveyNotes.trim() || undefined,
      });
      const res = await apiFetch(`/visit-requests/${created.id}/submit`, { method: 'POST' }, user?.id);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw { response: e, message: e?.message ?? 'Gagal submit' };
      }
      toast.success('Draft request visit berhasil dibuat. Silakan klik Submit untuk mengajukan ke PM.');
      router.push('/visit-requests');
    } catch (err: unknown) {
      parseAndShowApiError(err as { response?: unknown; message?: string });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Buat Visit Request</h1>
        <p className="text-sm text-slate-500">
          Pilih cluster dan jadwal kunjungan. Data lapangan diisi setelah PM menyetujui jadwal.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-5">
        <h2 className="font-black text-slate-800">Pilih cluster</h2>
        {preselectedId && selectedCluster?.id === preselectedId && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✓ Cluster dipilih: {selectedCluster.rwCode} — {selectedCluster.kelurahan}
          </div>
        )}
        <input
          placeholder="Cari kode RW atau kelurahan..."
          value={clSearch}
          onChange={(e) => setClSearch(e.target.value)}
          className="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:border-[#00D4B4]"
        />
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filteredClusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCluster(c)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                selectedCluster?.id === c.id
                  ? 'border-[#00D4B4] bg-[#00D4B4]/5'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800 text-sm">
                    {c.rwCode} — {c.kelurahan}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.ispCustomer} · {c.homepasCount ?? '—'} HP
                  </p>
                </div>
                {selectedCluster?.id === c.id ? <Check className="w-4 h-4 text-[#00D4B4]" /> : null}
              </div>
            </button>
          ))}
          {filteredClusters.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">Tidak ada cluster tersedia</p>
          ) : null}
        </div>

        <div>
          <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">
            Tanggal & jam kunjungan
          </label>
          <input
            type="datetime-local"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:border-[#00D4B4]"
          />
        </div>

        <div>
          <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">
            Catatan (opsional)
          </label>
          <textarea
            value={surveyNotes}
            onChange={(e) => setSurveyNotes(e.target.value)}
            rows={3}
            placeholder="Catatan singkat untuk PM terkait kunjungan…"
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-[#00D4B4] resize-none"
          />
        </div>

        <button
          type="button"
          onClick={() => void handleCreateAndSubmit()}
          disabled={submitting}
          className="w-full h-11 bg-[#0F1B2D] text-white rounded-xl font-black text-sm hover:bg-[#1a2d45] transition-colors disabled:opacity-60"
        >
          {submitting ? 'Memproses…' : 'Buat & ajukan jadwal ke PM'}
        </button>
      </div>
    </div>
  );
}

export default function NewVisitRequestPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Memuat…</div>}>
      <NewVisitRequestPageInner />
    </Suspense>
  );
}
