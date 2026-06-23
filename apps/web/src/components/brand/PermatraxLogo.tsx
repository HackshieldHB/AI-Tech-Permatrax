import React from 'react';

type LogoVariant = 'dark' | 'light';

interface PermatraxLogoProps {
  /** `dark` = for light backgrounds (default), `light` = for dark backgrounds. */
  variant?: LogoVariant;
  /** Render only the "P" mark without the wordmark. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Official PermaTrax lockup: a gradient "P" monogram plus the wordmark.
 * Pure presentational SVG/markup — server-compatible, deterministic, no client APIs.
 */
export function PermatraxLogo({
  variant = 'dark',
  iconOnly = false,
  className,
}: PermatraxLogoProps) {
  const wordmarkColor = variant === 'light' ? '#FFFFFF' : '#211A4D';

  return (
    <span
      className={['inline-flex items-center gap-2.5', className].filter(Boolean).join(' ')}
      aria-label="PermaTrax"
      role="img"
    >
      <PermatraxIcon className="h-9 w-9 shrink-0" />
      {!iconOnly && (
        <span
          className="text-[22px] font-extrabold tracking-tight leading-none"
          style={{ color: wordmarkColor }}
        >
          Perma<span style={{ color: '#F06A6A' }}>Trax</span>
        </span>
      )}
    </span>
  );
}

/** Standalone gradient "P" mark. Each instance scopes its gradient id to avoid collisions. */
export function PermatraxIcon({ className }: { className?: string }) {
  const gradientId = React.useId();
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="PermaTrax"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF6B6B" />
          <stop offset="0.5" stopColor="#D85BCB" />
          <stop offset="1" stopColor="#6D4AFF" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${gradientId})`} />
      <path
        d="M22 16h13.5c7.2 0 12.5 4.7 12.5 11.6 0 6.9-5.3 11.6-12.5 11.6H30V48h-8V16Zm8 16.4h5c2.9 0 4.8-1.9 4.8-4.8 0-2.9-1.9-4.8-4.8-4.8h-5v9.6Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export default PermatraxLogo;
