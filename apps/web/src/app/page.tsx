'use client'; // MODIFIED: root redirect runs client-side

import { useEffect } from 'react'; // NEW: side-effect redirect
import { useRouter } from 'next/navigation'; // NEW: router replace
import { useAuthStore } from '../store/authStore'; // FIX: rely on the in-memory store, not localStorage

export default function RootPage() { // MODIFIED: lightweight root redirect
  const router = useRouter();
  const hydrate = useAuthStore((s) => s.hydrate); // FIX: stable hydrate ref for the effect

  useEffect(() => {
    // FIX: access token is no longer kept in localStorage (XSS hardening). We must
    // wait for hydrate() to silently refresh the token from the HttpOnly cookie
    // before deciding where to redirect — otherwise persisted sessions would
    // always bounce to /login.
    let cancelled = false;
    (async () => {
      await hydrate();
      if (cancelled) return;
      const tok = useAuthStore.getState().accessToken;
      router.replace(tok ? '/home' : '/login');
    })();
    return () => { cancelled = true; };
  }, [router, hydrate]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#F9FAFB',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
      }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path d="M8 24 Q24 8 40 24" stroke="#F06A6A" strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M12 30 Q24 18 36 30" stroke="#F06A6A" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
          <path d="M16 36 Q24 28 32 36" stroke="#F06A6A" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.4" />
        </svg>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          border: '3px solid #F06A6A', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: '#6B7280', fontSize: '14px', fontWeight: 500 }}>Redirecting...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
