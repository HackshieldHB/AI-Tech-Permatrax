import React from 'react';
import { PermatraxLogo } from '../brand/PermatraxLogo';
import { TelecomTowerIllustration } from './TelecomTowerIllustration';

/**
 * Compact branded header shown above the form on tablet/mobile, where the full
 * left visual panel is hidden. Server component — static and deterministic.
 */
export function LoginMobileHeader() {
  return (
    <div
      className="relative mb-8 overflow-hidden rounded-3xl p-6 lg:hidden"
      style={{
        background:
          'radial-gradient(circle at 18% 20%, rgba(240,106,106,0.28), transparent 42%),' +
          'linear-gradient(135deg, #17123A 0%, #211A4D 45%, #5A3DCC 110%)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-8 h-40 w-40 opacity-80"
      >
        <TelecomTowerIllustration className="h-full w-full" />
      </div>
      <div className="relative">
        <PermatraxLogo variant="light" />
        <p className="mt-3 max-w-[16rem] text-sm leading-snug text-white/75">
          Manage every permit. Track every connection.
        </p>
      </div>
    </div>
  );
}

export default LoginMobileHeader;
