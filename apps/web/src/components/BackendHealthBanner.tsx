'use client';

import { useEffect, useState } from 'react';

/**
 * Optional UX: if same-origin /api/health fails, Nest may be down or Next rewrites misconfigured.
 * Set NEXT_PUBLIC_DISABLE_API_HEALTH_BANNER=true to hide (e.g. Storybook).
 */
export function BackendHealthBanner() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    if (process.env.NEXT_PUBLIC_DISABLE_API_HEALTH_BANNER === 'true') return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/health', {
          method: 'GET',
          signal: ac.signal,
          headers: { 'ngrok-skip-browser-warning': 'true' },
        });
        if (!ac.signal.aborted && !res.ok) setVisible(true);
      } catch {
        if (!ac.signal.aborted) setVisible(true);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [dismissed]);

  if (!visible || dismissed) return null;

  return (
    <div
      role="alert"
      style={{
        background: '#7f1d1d',
        color: '#fff',
        padding: '10px 16px',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span>
        Backend tidak terjangkau lewat <strong>/api/health</strong>. Pastikan API jalan di port
        3001, Next.js rewrite <code style={{ opacity: 0.9 }}>/api</code> aktif, dan setelah
        mengubah <code style={{ opacity: 0.9 }}>next.config.js</code> restart <code style={{ opacity: 0.9 }}>next dev</code>.
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          background: 'rgba(255,255,255,0.15)',
          border: '1px solid rgba(255,255,255,0.35)',
          color: '#fff',
          borderRadius: 8,
          padding: '6px 10px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Tutup
      </button>
    </div>
  );
}
