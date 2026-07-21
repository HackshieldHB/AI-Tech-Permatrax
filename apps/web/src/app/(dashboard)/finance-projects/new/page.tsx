'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { apiPost } from '../../../../lib/api';
import { formatRupiah } from '../../../../lib/format';

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export default function NewFinanceProjectPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [totalBudgetStr, setTotalBudgetStr] = useState('');
  const [matStr, setMatStr] = useState('');
  const [jasStr, setJasStr] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // JLM: project type + FTTT budget categories
  // Integra V1: FTTT creates a Segment (Lain-Lain/Overhead only) — Sites are added later from the Segment detail page
  const [projectType, setProjectType] = useState<'FTTH' | 'FTTT'>('FTTH');
  const [lainLainStr, setLainLainStr] = useState('');

  const isFttt = projectType === 'FTTT';
  const lainLainN = lainLainStr.trim() ? Number(digitsOnly(lainLainStr)) : undefined;
  const matN = matStr.trim() ? Number(digitsOnly(matStr)) : undefined;
  const jasN = jasStr.trim() ? Number(digitsOnly(jasStr)) : undefined;
  // FTTT Segment total = Budget Lain-Lain only; FTTH uses the manual total field
  const totalN = isFttt
    ? (lainLainN ?? 0)
    : (Number(digitsOnly(totalBudgetStr)) || 0);

  const validate = (): string | null => {
    if (!name.trim() || name.length > 100) return 'Nama wajib diisi (maks 100 karakter)';
    if (name.trim().length < 3) return 'Nama minimal 3 karakter';
    if (totalN <= 0) return isFttt ? 'Budget Lain-Lain harus lebih dari 0' : 'Total budget harus lebih dari 0';
    const c = code.trim();
    if (c && (!/^[A-Za-z0-9-]+$/.test(c) || c.length < 3 || c.length > 20)) {
      return 'Kode harus 3–20 karakter, huruf/angka/tanda hubung';
    }
    if (!isFttt && matN != null && jasN != null && matN + jasN > totalN) {
      return 'Material + Jasa tidak boleh melebihi Total Budget';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        projectType,
        totalBudget: totalN,
        ...(isFttt ? { hierarchyLevel: 'SEGMENT' } : {}),
        ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(!isFttt && matN != null ? { materialBudget: matN } : {}),
        ...(!isFttt && jasN != null ? { jasaBudget: jasN } : {}),
        ...(isFttt ? { budgetLainLain: lainLainN ?? 0 } : {}),
        ...(endDate
          ? { endDate: new Date(endDate + 'T12:00:00').toISOString() }
          : {}),
      };
      const created = await apiPost<{ id: string }>('/finance-projects', body);
      toast.success(isFttt ? 'Segment dibuat' : 'Proyek dibuat');
      router.push(`/finance-projects/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat proyek');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-3 py-8 space-y-6">
      <Link href="/finance-projects" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-[#00D4B4]">
        <ArrowLeft className="w-4 h-4" />
        Kembali
      </Link>
      <h1 className="text-2xl font-black text-slate-900">{isFttt ? 'Segment Baru' : 'Proyek Baru'}</h1>
      <section className="space-y-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Kode (opsional)</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="FIN-2026-XXX (auto-generate jika kosong)"
          />
          <p className="text-[11px] text-slate-500 mt-1">Kosongkan untuk generate otomatis</p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Tipe Project *</label>
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value as 'FTTH' | 'FTTT')}
          >
            <option value="FTTH">FTTH</option>
            <option value="FTTT">FTTT</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {isFttt
              ? 'FTTT: dibuat sebagai Segment dengan Budget Lain-Lain (Overhead). Site (Perizinan/Material/Jasa) ditambahkan kemudian dari halaman Detail Segment.'
              : 'FTTH: alur existing (Material / Jasa).'}
          </p>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Nama *</label>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Deskripsi</label>
          <textarea
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {isFttt ? (
          <>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Budget Lain-Lain (Overhead) *</label>
              <input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={lainLainStr} onChange={(e) => setLainLainStr(digitsOnly(e.target.value))} placeholder="0" />
              {lainLainStr ? <p className="text-xs mt-1">{formatRupiah(lainLainN ?? 0)}</p> : null}
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
              <span className="text-xs font-bold text-slate-500 uppercase">Total Budget Segment (otomatis)</span>
              <p className="text-lg font-black text-slate-900">{formatRupiah(totalN)}</p>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase">Total Budget *</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={totalBudgetStr}
                onChange={(e) => setTotalBudgetStr(digitsOnly(e.target.value))}
                placeholder="0"
              />
              <p className="text-xs text-slate-600 mt-1">{formatRupiah(totalN)}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Material</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={matStr}
                  onChange={(e) => setMatStr(digitsOnly(e.target.value))}
                />
                {matStr ? <p className="text-xs mt-1">{formatRupiah(matN ?? 0)}</p> : null}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Jasa</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={jasStr}
                  onChange={(e) => setJasStr(digitsOnly(e.target.value))}
                />
                {jasStr ? <p className="text-xs mt-1">{formatRupiah(jasN ?? 0)}</p> : null}
              </div>
            </div>
          </>
        )}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase">Tanggal Berakhir</label>
          <input
            type="date"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <p className="text-[11px] text-slate-500 mt-1">Untuk forecasting lebih akurat</p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-[#0F1B2D] text-white py-3 text-sm font-bold disabled:opacity-50"
        >
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </button>
      </section>
    </div>
  );
}
