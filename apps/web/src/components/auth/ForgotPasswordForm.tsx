'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, ArrowRight, Loader2, AlertCircle, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { API_URL } from '../../lib/auth';

const MSG = {
  invalidEmail: 'Please enter a valid email address.',
  network: 'Unable to connect to the server. Check your connection and try again.',
  server: 'Something went wrong. Please try again.',
  rateLimited: 'Too many requests. Please try again later.',
} as const;

/**
 * Request a password-reset link. The API always responds generically, so this
 * screen shows the same confirmation regardless of whether the email exists
 * (no account enumeration).
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(MSG.invalidEmail);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.ok) {
        setSent(true);
      } else if (res.status === 429) {
        setError(MSG.rateLimited);
        toast.error(MSG.rateLimited);
      } else {
        setError(MSG.server);
        toast.error(MSG.server);
      }
    } catch (err) {
      const isNetwork = err instanceof TypeError && /fetch|network|Failed to fetch/i.test(err.message);
      const message = isNetwork ? MSG.network : MSG.server;
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="w-full">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E9F7F0]">
          <MailCheck className="h-6 w-6 text-[#168A67]" aria-hidden="true" />
        </div>
        <h1 className="text-[clamp(1.6rem,3.6vw,2rem)] font-extrabold tracking-tight text-[#211A4D]">
          Check your email
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#6E6A78]">
          If an account exists for <span className="font-medium text-[#211A4D]">{email.trim()}</span>,
          we&apos;ve sent a link to reset your password. The link expires in 30 minutes.
        </p>
        <p className="mt-4 text-sm text-[#9A94A6]">
          Didn&apos;t get it? Check your spam folder, or{' '}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="rounded font-medium text-[#7C5CFC] hover:text-[#6D4AFF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]/40"
          >
            try a different email
          </button>
          .
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex items-center gap-2 rounded text-sm font-medium text-[#211A4D] hover:text-[#7C5CFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC]/40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-8">
        <h1 className="text-[clamp(1.75rem,4vw,2.25rem)] font-extrabold tracking-tight text-[#211A4D]">
          Forgot password?
        </h1>
        <p className="mt-2 text-[15px] text-[#6E6A78]">
          Enter the email linked to your account and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div>
          <label htmlFor="forgot-email" className="mb-2 block text-sm font-medium text-[#211A4D]">
            Email
          </label>
          <div className="relative">
            <Mail
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#9A94A6]"
              aria-hidden="true"
            />
            <input
              id="forgot-email"
              name="email"
              type="email"
              inputMode="email"
              value={email}
              disabled={isLoading}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="Enter your email"
              autoComplete="email"
              spellCheck={false}
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'forgot-email-error' : undefined}
              className={[
                'h-[54px] w-full rounded-xl border bg-white pl-12 pr-4 text-[15px] text-[#202124]',
                'placeholder:text-[#9A94A6] outline-none transition-shadow',
                'focus:ring-4 focus:ring-[#7C5CFC]/[0.18] disabled:cursor-not-allowed disabled:opacity-60',
                error ? 'border-[#D92D20] focus:border-[#D92D20]' : 'border-[#E4E0EA] focus:border-[#7C5CFC]',
              ].join(' ')}
            />
          </div>
          <div role="alert" aria-live="assertive" className="min-h-[20px]">
            {error && (
              <p id="forgot-email-error" className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-[#D92D20]">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
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
              Sending...
            </>
          ) : (
            <>
              Send reset link
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

export default ForgotPasswordForm;
