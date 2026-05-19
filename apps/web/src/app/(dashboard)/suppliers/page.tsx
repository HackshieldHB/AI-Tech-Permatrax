'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { apiGetPaginated } from '../../../lib/api';
import { toast } from 'sonner';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';
import type { PaginatedResponse } from '../../../types/api.types';
import type { Supplier } from '../../../types/api.types';

export default function SuppliersListPage() {
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [result, setResult] = useState<PaginatedResponse<Supplier> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const debouncePageMount = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!debouncePageMount.current) {
      debouncePageMount.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, activeFilter, setPage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit, isActive: activeFilter };
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const res = await apiGetPaginated<Supplier>('/suppliers', params);
      setResult(res);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat supplier');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, activeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Master Supplier</h1>
        <Link
          href="/suppliers/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 8,
            background: '#00D4B4',
            color: '#0D1117',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          <Plus size={18} /> Supplier baru
        </Link>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <input
          placeholder="Cari nama / kode…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px', padding: '10px 12px', borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14 }}
        />
        {(['all', 'true', 'false'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setActiveFilter(k);
              setPage(1);
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: '1px solid #D0D7DE',
              background: activeFilter === k ? '#0F1B2D' : '#F6F8FA',
              color: activeFilter === k ? '#fff' : '#24292f',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {k === 'all' ? 'Semua' : k === 'true' ? 'Aktif' : 'Nonaktif'}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #D0D7DE',
            background: '#fff',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Muat ulang
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #D0D7DE', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #D0D7DE', background: '#F6F8FA', textAlign: 'left' }}>
              <th style={{ padding: 12 }}>Kode</th>
              <th style={{ padding: 12 }}>Nama</th>
              <th style={{ padding: 12 }}>Telepon</th>
              <th style={{ padding: 12 }}>Email</th>
              <th style={{ padding: 12 }}>Aktif</th>
              <th style={{ padding: 12 }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, color: '#57606a' }}>
                  Memuat…
                </td>
              </tr>
            ) : (result?.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24 }}>
                  Belum ada supplier.
                </td>
              </tr>
            ) : (
              (result?.data ?? []).map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #EAEEF2' }}>
                  <td style={{ padding: 12 }}>{s.code}</td>
                  <td style={{ padding: 12, fontWeight: 500 }}>{s.name}</td>
                  <td style={{ padding: 12 }}>{s.phone ?? '—'}</td>
                  <td style={{ padding: 12 }}>{s.email ?? '—'}</td>
                  <td style={{ padding: 12 }}>{s.isActive ? 'Ya' : 'Tidak'}</td>
                  <td style={{ padding: 12 }}>
                    <Link href={`/suppliers/${s.id}`} style={{ color: '#0969DA' }}>
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
        <Pagination
          total={result.meta.total}
          page={page}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      ) : null}
    </div>
  );
}
