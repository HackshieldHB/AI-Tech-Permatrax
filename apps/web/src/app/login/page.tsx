'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/authStore';
import { API_URL, NEXT_ROUTE_BASE } from '../../lib/auth'; // FIX: single source of truth — smart fallback handles ngrok + localhost
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function EnterpriseLoginPage() {
  const router = useRouter();
  const { hydrate } = useAuthStore();

  const [isLoading, setIsLoading] = useState(false);
  const [initialCheck, setInitialCheck] = useState(true);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showAccounts, setShowAccounts] = useState(false); // NEW: demo accounts accordion

  useEffect(() => {
    // FIX: access token is no longer in localStorage (XSS hardening). Await hydrate()
    // so we can read the in-memory access token populated by the silent refresh from
    // the HttpOnly cookie, then decide whether to auto-redirect or show the form.
    let cancelled = false;
    (async () => {
      await hydrate();
      if (cancelled) return;
      const tok = useAuthStore.getState().accessToken;
      if (tok) {
        router.replace('/home'); // FIX: smart role-based redirect landing
      } else {
        setInitialCheck(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrate, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!formData.email || !formData.password) {
      const message = 'Kolom tidak boleh kosong';
      toast.error(message);
      setErrorMessage(message);
      return;
    }

    setIsLoading(true);

    try {
      // Browser: API_URL is always same-origin `/api` (Next.js rewrites -> Nest on :3001).
      // Server-only code uses INTERNAL / localhost URL — never bake :3001 into the client bundle for public hosts.
      const loginUrl = `${API_URL}/auth/login`;
      if (process.env.NODE_ENV === 'development') {
        console.log('[Login] Attempting:', loginUrl);
      }

      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true', // FIX: bypass ngrok-free interstitial on raw fetch
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('[Login] Response status:', res.status);
      }

      let data: any;
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error('[Login] Non-JSON response:', text);
        toast.error('Server error. Pastikan backend berjalan.');
        setErrorMessage('Server error. Pastikan backend berjalan.');
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          toast.error('Email atau password salah');
          setErrorMessage('Email atau password salah');
        } else if (res.status === 429) {
          toast.error('Terlalu banyak percobaan. Coba lagi dalam 60 detik.');
          setErrorMessage('Terlalu banyak percobaan. Coba lagi dalam 60 detik.');
        } else if (res.status === 400) {
          const message = 'Data tidak valid: ' + (data?.message || 'Periksa email dan password');
          toast.error(message);
          setErrorMessage(message);
        } else {
          const msg = process.env.NODE_ENV === 'development'
            ? `Error ${res.status}: ${JSON.stringify(data)}`
            : 'Terjadi kesalahan. Coba lagi.';
          toast.error(msg);
          setErrorMessage(msg);
        }
        return;
      }

      if (!data?.accessToken || !data?.user) {
        console.error('[Login] Unexpected response shape:', data);
        toast.error('Response tidak valid dari server.');
        setErrorMessage('Response tidak valid dari server.');
        return;
      }

      // FIX: access token lives in-memory (Zustand) only — never in localStorage (XSS).
      // Stale tokens from previous app versions are wiped here so they cannot leak.
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        sessionStorage.removeItem('accessToken');
      }

      try {
        await fetch(`${NEXT_ROUTE_BASE}/api/auth/set-cookie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // FIX: forward rememberMe so the cookie maxAge matches the user's intent
          body: JSON.stringify({ refreshToken: data.refreshToken, rememberMe }),
        });
      } catch (cookieErr) {
        console.warn('[Login] Could not set refresh cookie:', cookieErr);
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('permatrack-auth-storage');
      }
      const { setUser, setToken, resetFeatureAccess } = useAuthStore.getState();
      resetFeatureAccess();
      setUser(data.user);
      setToken(data.accessToken);

      router.push('/home'); // FIX: smart role-based redirect
      toast.success(`Selamat datang, ${data.user.name}!`);
    } catch (err: any) {
      console.error('[Login] Caught error:', err);
      const isNetworkError = err instanceof TypeError &&
        (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed to fetch'));
      if (isNetworkError) {
        const isExternal = typeof window !== 'undefined' &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';

        if (isExternal) {
          const message = 'Backend tidak terjangkau via ngrok. Periksa tunnel & Next.js rewrites.';
          toast.error(message, { duration: 8000 });
          setErrorMessage(message);
          console.error(
            '[Login] External access detected but backend unreachable.\n' +
            'Current API URL: ' + API_URL + '\n' +
            'Diagnosis:\n' +
            '  - Same-origin /api/* is proxied by Next.js (next.config.js rewrites) to localhost:3001.\n' +
            '  - If this fails, the most likely causes are:\n' +
            '    1. `next dev` was not restarted after env changes.\n' +
            '    2. The ngrok tunnel is down (check http://localhost:4040).\n' +
            '    3. NestJS API is not running on :3001.'
          );
        } else {
          const message = 'Tidak dapat terhubung ke server. Pastikan backend berjalan (npm run start:dev di apps/api)';
          toast.error(message, { duration: 6000 });
          setErrorMessage(message);
        }
      } else {
        const message = 'Terjadi kesalahan: ' + (err instanceof Error ? err.message : String(err));
        toast.error(message);
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (initialCheck) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#F9FAFB]">
        <div className="w-8 h-8 rounded-full border-2 border-[#F06A6A]/30 border-t-[#F06A6A] animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative font-sans overflow-hidden bg-[#F9FAFB]">

      <div className="absolute bottom-0 left-0 w-full h-[50vh] bg-[radial-gradient(circle_at_0%_100%,rgba(240,106,106,0.08)_0%,transparent_50%)] pointer-events-none" />

      <div className="w-full max-w-[420px] px-4 sm:px-0 z-10 relative">
        <div className="w-full bg-white border border-[#E5E7EB] rounded-[24px] p-8 sm:p-10 shadow-2xl">

          <div className="flex flex-col items-center mb-10 w-full text-center">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-[#F06A6A] mb-4">
              <path d="M2.5 12C2.5 12 6.5 4.5 12 4.5C17.5 4.5 21.5 12 21.5 12C21.5 12 17.5 19.5 12 19.5C6.5 19.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4.5 12H19.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" className="opacity-50" />
            </svg>
            <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">PermaTrax</h1>
            <p className="text-[13px] text-[#6B7280] mb-5">Fiber Construction Management</p>
            <div className="flex bg-[#FDE8E8] px-3 py-1 rounded-full items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F06A6A] animate-pulse"></span>
              <span className="text-[10px] font-bold text-[#F06A6A] tracking-widest uppercase">FTTH · FTTB · FTTT</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 w-full">

            <div className="relative group">
              <input
                id="emailField"
                disabled={isLoading}
                type="email"
                value={formData.email} onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setErrorMessage(''); }}
                className={`w-full h-[52px] bg-white border ${errorMessage ? 'border-[#F06A6A]' : 'border-[#E5E7EB] focus:border-[#F06A6A]'} rounded-xl px-4 pt-4 pb-1 text-sm text-[#111827] peer focus:outline-none focus:ring-0 transition-colors shadow-sm focus:shadow-[0_0_0_2px_rgba(240,106,106,0.25)]`}
                required
              />
              <label
                htmlFor="emailField"
                className={`absolute left-4 transition-all duration-200 pointer-events-none 
                    ${formData.email ? 'text-[10px] top-1.5 text-[#6B7280]' : 'text-sm top-3.5 text-[#9CA3AF]'}
                    peer-focus:text-[10px] peer-focus:top-1.5 peer-focus:text-[#F06A6A] uppercase tracking-wider font-semibold`}
              >
                Alamat Email
              </label>
            </div>

            <div className="relative group">
              <input
                id="passField"
                disabled={isLoading}
                type={showPassword ? 'text' : 'password'}
                value={formData.password} onChange={(e) => { setFormData({ ...formData, password: e.target.value }); setErrorMessage(''); }}
                className={`w-full h-[52px] bg-white border ${errorMessage ? 'border-[#F06A6A]' : 'border-[#E5E7EB] focus:border-[#F06A6A]'} rounded-xl pl-4 pr-12 pt-4 pb-1 text-sm text-[#111827] peer focus:outline-none focus:ring-0 transition-colors shadow-sm focus:shadow-[0_0_0_2px_rgba(240,106,106,0.25)]`}
                required
              />
              <label
                htmlFor="passField"
                className={`absolute left-4 transition-all duration-200 pointer-events-none 
                    ${formData.password ? 'text-[10px] top-1.5 text-[#6B7280]' : 'text-sm top-3.5 text-[#9CA3AF]'}
                    peer-focus:text-[10px] peer-focus:top-1.5 peer-focus:text-[#F06A6A] uppercase tracking-wider font-semibold`}
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#6B7280] transition-colors p-1"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {errorMessage && (
              <div className="text-[#FF6B6B] text-xs font-medium px-1 flex items-center gap-1.5 -mt-2">
                <div className="w-1 h-1 bg-[#FF6B6B] rounded-full"></div>
                {errorMessage}
              </div>
            )}

            <div className="flex items-center justify-between w-full mt-1">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center justify-center w-4 h-4 rounded border border-[#E5E7EB] bg-white group-hover:border-[#F06A6A] transition-colors">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="peer opacity-0 absolute inset-0 cursor-pointer" />
                  <svg className={`w-2.5 h-2.5 text-[#F06A6A] pointer-events-none transition-opacity ${rememberMe ? 'opacity-100' : 'opacity-0'}`} viewBox="0 0 14 14" fill="none">
                    <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <span className="text-xs text-[#6B7280] font-medium select-none group-hover:text-[#111827] transition-colors">Ingat saya</span>
              </label>
              <span className="text-xs text-[#9CA3AF]">Lupa password? Hubungi Admin</span>
            </div>

            <button
              disabled={isLoading}
              type="submit"
              className="mt-6 w-full h-[48px] bg-[#F06A6A] hover:bg-[#E05555] text-white rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-[#F06A6A]/20 hover:-translate-y-[1px] hover:shadow-[#F06A6A]/30 active:scale-95 transition-all flex items-center justify-center disabled:opacity-70 disabled:hover:bg-[#F06A6A] disabled:hover:-translate-y-0 disabled:active:scale-100 group relative overflow-hidden"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span>Masuk...</span>
                </div>
              ) : (
                <span className="relative z-10 flex items-center justify-center w-full">
                  Verify Identity
                  <svg className="w-4 h-4 ml-1.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                </span>
              )}
            </button>

          </form>

        </div>

        {process.env.NODE_ENV !== 'production' && ( // NEW: development helper accounts
          <div style={{
            marginTop: '16px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '12px',
            padding: '16px',
            width: '100%',
            maxWidth: '420px',
          }}>
            <button
              onClick={() => setShowAccounts(!showAccounts)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.6)',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Demo Akun (Development)</span>
              <span>{showAccounts ? '▲' : '▼'}</span>
            </button>

            {showAccounts && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  { role: 'General Manager', email: 'gm@permatrax.com', pass: 'GMPassword123!', color: '#7C3AED' },
                  { role: 'PM Senior', email: 'pm.senior@permatrax.com', pass: 'PMSPassword123!', color: '#1D4ED8' },
                  { role: 'PM FTTH', email: 'pm.ftth@permatrax.com', pass: 'PMPassword123!', color: '#0F766E' },
                  { role: 'Admin', email: 'admin@permatrax.com', pass: 'AdminPassword123!', color: '#B45309' },
                  { role: 'Finance', email: 'finance@permatrax.com', pass: 'FinancePassword123!', color: '#166534' },
                  { role: 'Marketing', email: 'marketing@permatrax.com', pass: 'Marketing123!', color: '#0EA5E9' }, // NEW: demo cash-op role
                  { role: 'Ops Manager', email: 'ops.manager@permatrax.com', pass: 'OpsManager123!', color: '#7C3AED' }, // NEW: demo cash-op role
                  { role: 'Admin Stok', email: 'admin.stock@permatrax.com', pass: 'AdminPassword123!', color: '#C2410C' },
                  { role: 'Surveyor FTTH', email: 'surveyor.ftth@permatrax.com', pass: 'SurveyPassword123!', color: '#374151' },
                ].map((account) => (
                  <button
                    key={account.email}
                    onClick={() => {
                      setFormData({ email: account.email, password: account.pass });
                      setErrorMessage('');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'rgba(255,255,255,0.05)',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'background 150ms',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: account.color, flexShrink: 0 }} />
                    <span style={{ color: 'white', fontSize: '12px', fontWeight: '500' }}>{account.role}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', marginLeft: 'auto' }}>{account.email}</span>
                  </button>
                ))}
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', margin: '4px 0 0', textAlign: 'center' }}>
                  Klik akun untuk auto-isi form
                </p>
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-6">
          <span className="text-[12px] font-medium text-white/30 tracking-wide">© 2026 PermaTrax · Confidential</span>
        </div>
      </div>

    </div>
  );
}
