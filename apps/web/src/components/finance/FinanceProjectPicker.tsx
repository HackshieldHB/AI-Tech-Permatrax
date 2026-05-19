'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiGetPaginated } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import type { FinanceProjectListItem } from '../../types/api.types';

type Props = {
  value: string;
  onChange: (id: string, project?: FinanceProjectListItem) => void;
  excludeId?: string;
  disabled?: boolean;
};

/** Searchable finance project dropdown with GENERAL pinned on top. */
export function FinanceProjectPicker({ value, onChange, excludeId, disabled }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<FinanceProjectListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let c = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGetPaginated<FinanceProjectListItem>('/finance-projects', {
          limit: 100,
          status: 'ACTIVE',
        });
        if (!c) setProjects(res.data);
      } catch {
        if (!c) setError('Gagal memuat daftar proyek budget');
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const sorted = useMemo(() => {
    const list = projects.filter((p) => p.id !== excludeId);
    const gen = list.filter((p) => p.isDefaultUncategorized);
    const rest = list.filter((p) => !p.isDefaultUncategorized);
    return [...gen, ...rest];
  }, [projects, excludeId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return sorted;
    return sorted.filter(
      (p) =>
        p.code.toLowerCase().includes(s) ||
        p.name.toLowerCase().includes(s),
    );
  }, [sorted, q]);

  const selected = sorted.find((p) => p.id === value);

  const labelFor = (p: FinanceProjectListItem) => {
    const rem = (p.materialRemaining ?? 0) + (p.jasaRemaining ?? 0);
    if (p.isDefaultUncategorized) {
      return `${p.code} · ${p.name} — Belum dialokasi`;
    }
    return `${p.code} · ${p.name} (Sisa: ${formatRupiah(rem)})`;
  };

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm bg-white disabled:opacity-50"
      >
        {loading
          ? 'Memuat…'
          : selected
            ? labelFor(selected)
            : 'Pilih proyek…'}
      </button>
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-64 overflow-hidden flex flex-col">
          <input
            className="px-3 py-2 text-sm border-b border-slate-100"
            placeholder="Cari kode / nama…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="overflow-y-auto max-h-52">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">Tidak ada hasil</div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                  onClick={() => {
                    onChange(p.id, p);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  {labelFor(p)}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
