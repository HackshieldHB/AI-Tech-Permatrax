'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { API_URL } from '../../lib/auth';
import { PasswordInput } from './PasswordInput';

const MSG = {
  requirements: 'Password must be at least 8 characters and include an uppercase letter and a number.',
  mismatch: 'Passwords do not match.',
  invalidToken: 'This reset link is invalid or has expired. Please request a new one.',
  network: 'Unable to connect to the server. Check your connection and try again.',
  server: 'Something went wrong. Please try again.',
  rateLimited: 'Too many attempts. Please try again later.',
} as const;

const isStrong = (pw: string) => pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);

/**
 * Complete a password reset. Reads the single-use token from the URL, validates
 * the new password client-side, then calls the reset endpoint.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setFormError('');

    const errors: { password?: string; confirm?: string } = {};
    if (!isStrong(password)) errors.password = MSG.requirements;
    if (confirm !== password) errors.confirm = MSG.mismatch;
    if (errors.password || errors.confirm) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (res.ok) {
        setDone(true);
        toast.success('Password updated. Please sign in.');
        setTimeout(() => router.replace('/login'), 2000);
        return;
      }

      if (res.status === 400) {
        // Invalid/expired token, or new password equals the old one.
        let serverMsg = '';
        try {
          const data = await res.json();
          serverMsg = typeof data?.message === 'string' ? data.message : '';
        } catch {
          /* ignore */
        }
        const message = /sama dengan password lama/i.test(serverMsg)
          ? 'New password cannot be the same as your old password.'
          : MSG.invalidToken;
        setFormError(message);
        toast.error(message);
      } else if (res.status === 429) {
        setFormError(MSG.rateLimited);
        toast.error(MSG.rateLimited);
      } else {
        setFormError(MSG.server);
        toast.error(MSG.server);
      }
    } catch (err) {
      const isNetwork = err instanceof TypeError && /fetch|network|Failed to fetch/i.test(err.message);
      const message = isNetwork ? MSG.network : MSG.server;
      setFormError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // No token in the URL → dead-end with a path back to request a new link.
  if (!token) {
    return (
      <div className="w-full">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDECEC]">
          <AlertCircle className="h-6 w-6 text-[#D92D20]" aria-hidden="true" />
        </div>
        <h1 className="text-[clamp(1.6rem,3.6vw,2rem)] font-extrabold tracking-tight text-[#211A4D]">
          Invalid reset link
        </h1>
        <p className="mt-2 text-[15px] text-[#6E6A78]">
          This password reset link is missing or invalid. Please request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-flex h-[52px] items-center justify-center gap-2 rounded-2xl px-6 text-[15px] font-semibold text-white"
          style={{ background: 'linear-gradient(90deg, #FF6B6B 0%, #D85BCB 48%, #7C5CFC 100%)' }}
        >
          Request new link <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E9F7F0]">
          <CheckCircle2 className="h-6 w-6 text-[#168A67]" aria-hidden="true" />
        </div>
        <h1 className="text-[clamp(1.6rem,3.6vw,2rem)] font-extrabold tracking-tight text-[#211A4D]">
          Password updated
        </h1>
        <p className="mt-2 text-[15px] text-[#6E6A78]">
          Your password has been changed. Redirecting you to sign in…
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded text-sm font-medium text-[#7C5CFC] hover:text-[#6D4AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]/40"
        >
          Go to sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-[clamp(1.75rem,4vw,2.25rem)] font-extrabold tracking-tight text-[#211A4D]">
          Set a new password
        </h1>
        <p className="mt-2 text-[15px] text-[#6E6A78]">
          Choose a strong password you don&apos;t use elsewhere.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div>
          <PasswordInput
            id="reset-password"
            label="New password"
            placeholder="Enter a new password"
            autoComplete="new-password"
            value={password}
            disabled={isLoading}
            invalid={!!fieldErrors.password}
            describedBy={fieldErrors.password ? 'reset-password-error' : 'reset-password-hint'}
            onChange={(v) => {
              setPassword(v);
              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
              setFormError('');
            }}
          />
          {fieldErrors.password ? (
            <p id="reset-password-error" className="mt-1.5 text-xs font-medium text-[#D92D20]">
              {fieldErrors.password}
            </p>
          ) : (
            <p id="reset-password-hint" className="mt-1.5 text-xs text-[#9A94A6]">
              At least 8 characters, with an uppercase letter and a number.
            </p>
          )}
        </div>

        <div>
          <PasswordInput
            id="reset-confirm"
            label="Confirm new password"
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            value={confirm}
            disabled={isLoading}
            invalid={!!fieldErrors.confirm}
            describedBy={fieldErrors.confirm ? 'reset-confirm-error' : undefined}
            onChange={(v) => {
              setConfirm(v);
              if (fieldErrors.confirm) setFieldErrors((p) => ({ ...p, confirm: undefined }));
              setFormError('');
            }}
          />
          {fieldErrors.confirm && (
            <p id="reset-confirm-error" className="mt-1.5 text-xs font-medium text-[#D92D20]">
              {fieldErrors.confirm}
            </p>
          )}
        </div>

        <div role="alert" aria-live="assertive" className="min-h-[20px]">
          {formError && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-[#D92D20]">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {formError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={[
            'group flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-white',
            'shadow-lg shadow-[#7C5CFC]/25 transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-[#7C5CFC]/40',
            'motion-safe:hover:-translate-y-px hover:shadow-xl hover:shadow-[#7C5CFC]/30 active:translate-y-0',
            'disabled:cursor-not-allowed disabled:opacity-75 disabled:hover:translate-y-0',
          ].join(' ')}
          style={{ background: 'linear-gradient(90deg, #FF6B6B 0%, #D85BCB 48%, #7C5CFC 100%)' }}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Updating...
            </>
          ) : (
            <>
              Reset password
              <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <Link
        href="/login"
        className="mt-8 inline-flex items-center gap-2 rounded text-sm font-medium text-[#211A4D] hover:text-[#7C5CFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]/40"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
      </Link>
    </div>
  );
}

export default ResetPasswordForm;
