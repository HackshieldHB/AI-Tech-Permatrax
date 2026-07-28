'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiGetPaginated, apiPost } from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';
import { usePagination } from '../../../hooks/usePagination';
import { Pagination } from '../../../components/Pagination';

type InboxFilter = 'all' | 'unread' | 'pending' | 'accepted' | 'disbursed' | 'declined';

type InboxRow = {
  id: string;
  title: string;
  description: string;
  inboxStatus: 'pending' | 'accepted' | 'disbursed' | 'declined';
  isRead: boolean;
  createdAt: string;
  link: string;
  projectId: string;
  meta: { phase: string; site: string; pmName: string; parentName: string | null };
};

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'unread', label: 'Belum Dibaca' },
  { key: 'pending', label: 'Menunggu Approval' },
  { key: 'accepted', label: 'Disetujui' },
  { key: 'disbursed', label: 'Dana sudah dikeluarkan' },
  { key: 'declined', label: 'Ditolak' },
];

const STATUS_STYLE: Record<InboxRow['inboxStatus'], { bg: string; text: string; label: string }> = {
  pending: { bg: '#FFF8C5', text: '#9a6700', label: 'Menunggu Approval' },
  accepted: { bg: '#DAFBE1', text: '#1a7f37', label: 'Disetujui' },
  disbursed: { bg: '#DDF4FF', text: '#0969DA', label: 'Dana Keluar' },
  declined: { bg: '#FFEBE9', text: '#cf222e', label: 'Ditolak' },
};

export default function ApprovalDanaPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { page, limit, setPage, setLimit } = usePagination(20);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [result, setResult] = useState<{ data: InboxRow[]; meta: { total: number } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetPaginated<InboxRow>('/fttt-projects/financial-requests', {
        page,
        limit,
        filter,
        ...(searchDebounced ? { search: searchDebounced } : {}),
      });
      setResult(res);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat Approval Dana');
    } finally {
      setLoading(false);
    }
  }, [page, limit, filter, searchDebounced]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const role = user?.role;
    if (role && !['FINANCE', 'GENERAL_MANAGER', 'ADMIN'].includes(role)) {
      toast.error('Halaman ini hanya untuk Finance');
      router.replace('/fttt-projects');
    }
  }, [user?.role, router]);

  const openItem = async (row: InboxRow) => {
    try {
      await apiPost(`/fttt-projects/financial-requests/${row.id}/mark-read`, {});
    } catch { /* non-blocking */ }
    router.push(row.link);
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Approval Dana</h1>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#57606a' }}>
        Pusat notifikasi dan monitoring seluruh pengajuan dana dari Project Manager.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => { setFilter(f.key); setPage(1); }}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              border: filter === f.key ? '1px solid #0969DA' : '1px solid #D0D7DE',
              background: filter === f.key ? '#DDF4FF' : '#fff',
              color: filter === f.key ? '#0969DA' : '#57606a',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="Cari project, site, PM, jenis pengajuan, nominal…"
        style={{
          width: '100%',
          maxWidth: 480,
          marginBottom: 16,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #D0D7DE',
          fontSize: 13,
          boxSizing: 'border-box',
        }}
      />

      {loading ? (
        <p style={{ color: '#8c959f', fontSize: 13 }}>Memuat…</p>
      ) : !result || result.data.length === 0 ? (
        <div style={{ border: '1px solid #EAEEF2', borderRadius: 12, padding: 24, textAlign: 'center', color: '#8c959f', fontSize: 13 }}>
          Tidak ada pengajuan dana untuk filter ini.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {result.data.map((row) => {
            const st = STATUS_STYLE[row.inboxStatus];
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => void openItem(row)}
                style={{
                  textAlign: 'left',
                  border: '1px solid #D0D7DE',
                  borderRadius: 12,
                  padding: '12px 14px',
                  background: row.isRead ? '#fff' : '#F0F7FF',
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', minWidth: 0 }}>
                    {!row.isRead && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0969DA', marginTop: 6, flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: row.isRead ? 600 : 700, color: '#24292f' }}>{row.title}</div>
                      <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>{row.description}</div>
                      <div style={{ fontSize: 11, color: '#8c959f', marginTop: 4 }}>
                        {row.meta.phase} · {row.meta.site} · PM {row.meta.pmName}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.text }}>
                      {st.label}
                    </span>
                    <div style={{ fontSize: 10, color: '#8c959f', marginTop: 6 }}>
                      {new Date(row.createdAt).toLocaleDateString('id-ID')}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {result && result.meta.total > limit && (
        <div style={{ marginTop: 16 }}>
          <Pagination
            page={page}
            limit={limit}
            total={result.meta.total}
            onPageChange={setPage}
            onLimitChange={setLimit}
          />
        </div>
      )}
    </div>
  );
}
