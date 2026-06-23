import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { ResetPasswordForm } from '../../components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Reset password',
  description: 'Choose a new password for your PermaTrax account.',
};

const FormFallback = (
  <div className="flex min-h-[320px] items-center justify-center">
    <Loader2 className="h-7 w-7 animate-spin text-[#7C5CFC]" aria-hidden="true" />
    <span className="sr-only">Loading…</span>
  </div>
);

/**
 * Reset-password screen. The form reads the token from search params, so it is an
 * isolated client island wrapped in Suspense for App Router prerendering.
 */
export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={FormFallback}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
