'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 32 }}>
      <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #FFCDD2', padding: 32, maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a1a1a' }}>
          Terjadi Kesalahan
        </h2>
        <p style={{ margin: '0 0 20px', color: '#57606a', fontSize: 14 }}>
          Halaman tidak dapat dimuat. Silakan coba lagi atau kembali ke halaman sebelumnya.
        </p>
        {error.message && (
          <div style={{ background: '#FFF5F5', border: '1px solid #FFCDD2', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 12, color: '#CF222E', textAlign: 'left', fontFamily: 'monospace', wordBreak: 'break-word' }}>
            {error.message}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => window.history.back()}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #D0D7DE', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            ← Kembali
          </button>
          <button
            onClick={() => reset()}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#0969DA', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
          >
            Coba Lagi
          </button>
        </div>
      </div>
    </div>
  );
}
