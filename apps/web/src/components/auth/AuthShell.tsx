import React from 'react';
import { LoginVisualPanel } from './LoginVisualPanel';
import { LoginMobileHeader } from './LoginMobileHeader';

/**
 * Shared split-screen shell for the auth routes (login, forgot/reset password).
 * Server component: renders the static brand panel + mobile header and slots the
 * route-specific form (a client island) into the right column.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid h-[100dvh] w-full grid-cols-1 overflow-y-auto bg-[#FFFDFB] lg:grid-cols-[57%_43%] lg:overflow-hidden xl:grid-cols-[58%_42%]">
      <LoginVisualPanel />
      <div className="flex min-h-[100dvh] w-full items-center justify-center px-5 py-10 sm:px-8 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="w-full max-w-[420px]">
          <LoginMobileHeader />
          {children}
        </div>
      </div>
    </main>
  );
}

export default AuthShell;
