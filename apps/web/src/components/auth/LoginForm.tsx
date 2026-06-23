'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, ArrowRight, ShieldCheck, Loader2, AlertCircle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../store/authStore';
import { API_URL, NEXT_ROUTE_BASE } from '../../lib/auth';
import { PasswordInput } from './PasswordInput';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION?.trim() || '1.0.0';

// Generic, non-enumerating user-facing messages.
const MSG = {
  empty: 'Please enter your email and password.',
  invalid: 'Invalid email, username, or password.',
  rateLimited: 'Too many login attempts. Please try again later.',
  network: 'Unable to connect to the server. Check your connection and try again.',
  server: 'Something went wrong. Please try again.',
  sessionExpired: 'Your session has expired. Please sign in again.',
} as const;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrate = useAuthStore((s) => s.hydrate);

  const [checkingSession, setCheckingSession] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const emailRef = useRef<HTMLInputElement>(null);

  // Optional notice driven by ?reason= (e.g. session expiry redirect).
  useEffect(() => {
    if (searchParams.get('reason') === 'session-expired') {
      setNotice(MSG.sessionExpired);
    }
  }, [searchParams]);

  // Restore an existing session silently from the HttpOnly refresh cookie, then
  // either redirect (already signed in) or reveal the form. Mirrors the prior page logic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrate();
      if (cancelled) return;
      const tok = useAuthStore.getState().accessToken;
      if (tok) {
        router.replace('/home');
      } else {
        setCheckingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return; // prevent duplicate submissions
    setFormError('');
    setNotice('');

    const trimmedEmail = email.trim();
    const errors: { email?: string; password?: string } = {};
    if (!trimmedEmail) errors.email = 'Email is required.';
    if (!password) errors.password = 'Password is required.';
    if (errors.email || errors.password) {
      setFieldErrors(errors);
      setFormError(MSG.empty);
      // focus first invalid field
      if (errors.email) {
        emailRef.current?.focus();
      } else {
        document.getElementById('login-password')?.focus();
      }
      return;
    }
    setFieldErrors({});
    setIsLoading(true);

    try {
      // Browser: API_URL is same-origin `/api` (dev) or the configured public URL (prod).
      const loginUrl = `${API_URL}/auth/login`;

      const res = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        credentials: 'include',
        body: JSON.stringify({ email: trimmedEmail, password }),
      });

      let data: { accessToken?: string; refreshToken?: string; user?: { name?: string } } | null = null;
      const contentType = res.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await res.json();
      } else {
        setFormError(MSG.server);
        toast.error(MSG.server);
        return;
      }

      if (!res.ok) {
        const message =
          res.status === 401 ? MSG.invalid
          : res.status === 429 ? MSG.rateLimited
          : res.status === 400 ? MSG.invalid
          : MSG.server;
        setFormError(message);
        toast.error(message);
        return;
      }

      if (!data?.accessToken || !data?.user) {
        setFormError(MSG.server);
        toast.error(MSG.server);
        return;
      }

      // Access token lives in-memory only (Zustand); wipe any stale persisted tokens.
      if (typeof window !== 'undefined') {
        localStorage.removeItem('accessToken');
        sessionStorage.removeItem('accessToken');
      }

      try {
        await fetch(`${NEXT_ROUTE_BASE}/api/auth/set-cookie`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: data.refreshToken, rememberMe }),
        });
      } catch {
        // non-fatal: refresh cookie best-effort
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem('permatrack-auth-storage');
      }
      const { setUser, setToken, resetFeatureAccess } = useAuthStore.getState();
      resetFeatureAccess();
      setUser(data.user as Parameters<typeof setUser>[0]);
      setToken(data.accessToken);

      router.push('/home'); // role-based landing handled downstream
      toast.success(`Welcome back, ${data.user.name ?? ''}!`.trim());
    } catch (err) {
      const isNetworkError =
        err instanceof TypeError &&
        /fetch|network|Failed to fetch/i.test(err.message);
      const message = isNetworkError ? MSG.network : MSG.server;
      setFormError(message);
      toast.error(message);
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console -- dev-only diagnostics (no credentials logged)
        console.error('[Login] error:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex min-h-[320px] items-center justify-center" aria-live="polite" aria-busy="true">
        <Loader2 className="h-7 w-7 animate-spin text-[#7C5CFC]" aria-hidden="true" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-[clamp(1.75rem,4vw,2.25rem)] font-extrabold tracking-tight text-[#211A4D]">
          Welcome back
        </h1>
        <p className="mt-2 text-[15px] text-[#6E6A78]">
          Sign in to continue managing your projects and infrastructure.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2 rounded-xl border border-[#FDE3B5] bg-[#FFF8EC] px-4 py-3 text-sm text-[#8A5A00]"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {/* Email */}
        <div>
          <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-[#211A4D]">
            Email
          </label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9A94A6]"
              aria-hidden="true"
            />
            <input
              id="login-email"
              ref={emailRef}
              name="username"
              type="email"
              inputMode="email"
              value={email}
              disabled={isLoading}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                setFormError('');
              }}
              placeholder="Enter your email"
              autoComplete="username"
              spellCheck={false}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              className={[
                'h-[54px] w-full rounded-xl border bg-white pl-12 pr-4 text-[15px] text-[#202124]',
                'placeholder:text-[#9A94A6] transition-shadow outline-none',
                'focus:ring-4 focus:ring-[#7C5CFC]/[0.18] disabled:cursor-not-allowed disabled:opacity-60',
                fieldErrors.email
                  ? 'border-[#D92D20] focus:border-[#D92D20]'
                  : 'border-[#E4E0EA] focus:border-[#7C5CFC]',
              ].join(' ')}
            />
          </div>
          {fieldErrors.email && (
            <p id="login-email-error" className="mt-1.5 text-xs font-medium text-[#D92D20]">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <PasswordInput
            id="login-password"
            value={password}
            disabled={isLoading}
            invalid={!!fieldErrors.password}
            describedBy={fieldErrors.password ? 'login-password-error' : undefined}
            onChange={(v) => {
              setPassword(v);
              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
              setFormError('');
            }}
          />
          {fieldErrors.password && (
            <p id="login-password-error" className="mt-1.5 text-xs font-medium text-[#D92D20]">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/* Remember + forgot */}
        <div className="flex items-center justify-between">
          <label className="inline-flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              disabled={isLoading}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-[#D7D2E0] text-[#7C5CFC] accent-[#7C5CFC] focus:ring-2 focus:ring-[#7C5CFC]/40"
            />
            <span className="text-sm text-[#6E6A78]">Remember me</span>
          </label>
          <Link
            href="/forgot-password"
            className="rounded text-sm font-medium text-[#7C5CFC] transition-colors hover:text-[#6D4AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]/40"
          >
            Forgot password?
          </Link>
        </div>

        {/* Form-level error */}
        <div role="alert" aria-live="assertive" className="min-h-[20px]">
          {formError && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-[#D92D20]">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className={[
            'group relative flex h-[54px] w-full items-center justify-center gap-2 overflow-hidden rounded-2xl',
            'text-[15px] font-semibold text-white shadow-lg shadow-[#7C5CFC]/25 transition-all',
            'focus:outline-none focus-visible:ring-4 focus-visible:ring-[#7C5CFC]/40',
            'motion-safe:hover:-translate-y-px hover:shadow-xl hover:shadow-[#7C5CFC]/30',
            'active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-75 disabled:hover:translate-y-0',
          ].join(' ')}
          style={{
            background: 'linear-gradient(90deg, #FF6B6B 0%, #D85BCB 48%, #7C5CFC 100%)',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Signing in...
            </>
          ) : (
            <>
              Sign in
              <ArrowRight
                className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </>
          )}
        </button>
      </form>

      {/* Security label */}
      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[#9A94A6]">
        <ShieldCheck className="h-4 w-4 text-[#168A67]" aria-hidden="true" />
        Protected by enterprise-grade security
      </div>

      {/* Footer */}
      <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[#9A94A6]">
        <span>Privacy Policy</span>
        <span aria-hidden="true">·</span>
        <span>Help Center</span>
        <span aria-hidden="true">·</span>
        <span>v{APP_VERSION}</span>
      </footer>
    </div>
  );
}

export default LoginForm;
