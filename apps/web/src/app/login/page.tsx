import React, { Suspense } from 'react';
import type { Metadata } from 'next';
import { Loader2 } from 'lucide-react';
import { LoginVisualPanel } from '../../components/auth/LoginVisualPanel';
import { LoginMobileHeader } from '../../components/auth/LoginMobileHeader';
import { LoginForm } from '../../components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to PermaTrax — connected infrastructure management.',
};

/**
 * "Connected Infrastructure" login screen.
 * Server component shell: the static brand panel renders on the server; the
 * interactive form is an isolated client island wrapped in Suspense because it
 * reads search params (required for production prerendering in the App Router).
 */
export default function LoginPage() {
  return (
    <main className="grid h-[100dvh] w-full grid-cols-1 overflow-y-auto bg-[#FFFDFB] lg:grid-cols-[57%_43%] lg:overflow-hidden xl:grid-cols-[58%_42%]">
      {/* Left brand panel (desktop only) */}
      <LoginVisualPanel />

      {/* Right login panel */}
      <div className="flex min-h-[100dvh] w-full items-center justify-center px-5 py-10 sm:px-8 lg:min-h-0 lg:h-full lg:overflow-y-auto">
        <div className="w-full max-w-[420px]">
          <LoginMobileHeader />
          <Suspense
            fallback={
              <div className="flex min-h-[320px] items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-[#7C5CFC]" aria-hidden="true" />
                <span className="sr-only">Loading…</span>
              </div>
            }
          >
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
