'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../store/authStore';
import { apiGet, apiPost } from '../../../../lib/api';
import { toast } from 'sonner';

type LegacyVr = {
  id: string;
  existingNetworkFound: boolean;
  existingOperator: string | null;
  adminApprovedAt: string | null;
  adminApprovedBy: string | null;
  cleanList: { id: string; rwCode: string; kelurahan: string; hasExistingFiber: boolean } | null;
  requester: { id: string; name: string; email: string } | null;
};

export default function LegacyBaOpenPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [list, setList] = useState<LegacyVr[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const allowed = user?.role === 'ADMIN' || user?.role === 'GENERAL_MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<LegacyVr[]>('/visit-requests/legacy-existing-fiber');
      setList(data);
    } catch {
      toast.error('Gagal memuat daftar VR legacy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!allowed) {
      toast.error('Akses ditolak');
      router.replace('/home');
      return;
    }
    void load();
  }, [user, allowed, router, load]);

  const handleRegenerate = async (vrId: string) => {
    if (!confirm(`Buat BA Open untuk VR ${vrId.slice(0, 8)}…?`)) return;
    setRegenerating(vrId);
    try {
      await apiPost<{ baOpenId: string; visitRequestId: string; documentNumber: string }>(
        `/visit-requests/${vrId}/regenerate-ba-open`,
        {},
      );
      toast.success('BA Open berhasil dibuat');
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal membuat BA Open';
      toast.error(msg);
    } finally {
      setRegenerating(null);
    }
  };

  if (!user || !allowed) {
    return <div style={{ padding: 24 }}>Memuat…</div>;
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Memuat…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Admin: Regenerate BA Open (Legacy)</h1>
      <p style={{ color: '#57606a', marginBottom: 20, lineHeight: 1.5 }}>
        Visit Request berstatus EXISTING_FIBER tanpa BA Open (data sebelum perbaikan). Tombol di bawah membuat BA Open
        dan pipeline cluster mengikuti aturan baru.
      </p>

      {list.length === 0 ? (
        <div
          style={{
            padding: 16,
            background: '#dafbe1',
            borderRadius: 8,
            border: '1px solid #2da44e40',
            color: '#1a7f37',
          }}
        >
          Tidak ada VR legacy. Semua data sudah sinkron.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #d0d7de' }}>
                <th style={{ padding: '8px 6px' }}>VR</th>
                <th style={{ padding: '8px 6px' }}>RW / Kelurahan</th>
                <th style={{ padding: '8px 6px' }}>Surveyor</th>
                <th style={{ padding: '8px 6px' }}>Admin approve</th>
                <th style={{ padding: '8px 6px' }}>Operator existing</th>
                <th style={{ padding: '8px 6px' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {list.map((vr) => (
                <tr key={vr.id} style={{ borderBottom: '1px solid #eaeef2' }}>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{vr.id.slice(0, 8)}…</td>
                  <td style={{ padding: '8px 6px' }}>
                    {vr.cleanList ? `${vr.cleanList.rwCode} — ${vr.cleanList.kelurahan}` : '—'}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{vr.requester?.name ?? '—'}</td>
                  <td style={{ padding: '8px 6px' }}>
                    {vr.adminApprovedAt
                      ? new Date(vr.adminApprovedAt).toLocaleString('id-ID')
                      : '—'}
                  </td>
                  <td style={{ padding: '8px 6px' }}>{vr.existingOperator ?? '—'}</td>
                  <td style={{ padding: '8px 6px' }}>
                    <button
                      type="button"
                      onClick={() => void handleRegenerate(vr.id)}
                      disabled={regenerating === vr.id}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #d0d7de',
                        background: regenerating === vr.id ? '#f6f8fa' : '#fff',
                        cursor: regenerating === vr.id ? 'wait' : 'pointer',
                      }}
                    >
                      {regenerating === vr.id ? 'Memproses…' : 'Buat BA Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
