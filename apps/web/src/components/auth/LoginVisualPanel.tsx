import React from 'react';
import { Activity, MapPin, ShieldCheck } from 'lucide-react';
import { PermatraxLogo } from '../brand/PermatraxLogo';
import { TelecomTowerIllustration } from './TelecomTowerIllustration';

const STATS: { value: string; label: string }[] = [
  { value: '128', label: 'Active Projects' },
  { value: '97.8%', label: 'Permit Completion' },
  { value: 'GIS', label: 'Network Connected' },
];

/**
 * Left brand panel for the login screen — "Connected Infrastructure".
 * Server component: static, deterministic, no browser APIs.
 * The statistic cards are decorative placeholders (labelled "Platform overview"),
 * not real-time data — no API calls are made here.
 */
export function LoginVisualPanel() {
  return (
    <section
      aria-label="PermaTrax platform overview"
      className="relative hidden h-full w-full overflow-hidden lg:flex lg:flex-col"
      style={{
        background:
          'radial-gradient(circle at 20% 20%, rgba(240,106,106,0.22), transparent 32%),' +
          'radial-gradient(circle at 78% 65%, rgba(124,92,252,0.30), transparent 38%),' +
          'linear-gradient(135deg, #17123A 0%, #211A4D 42%, #5A3DCC 72%, #F06A6A 130%)',
      }}
    >
      {/* faint coordinate grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(circle at 50% 40%, black, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 40%, black, transparent 78%)',
        }}
      />
      {/* drifting glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full blur-3xl motion-safe:animate-glow-drift"
        style={{ background: 'radial-gradient(circle, rgba(124,92,252,0.45), transparent 70%)' }}
      />
      {/* soft vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: 'inset 0 0 200px 40px rgba(10,8,30,0.45)' }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between p-10 xl:p-14">
        {/* logo */}
        <PermatraxLogo variant="light" />

        {/* headline + illustration */}
        <div className="flex flex-col gap-8">
          <TelecomTowerIllustration className="h-auto w-full max-w-[460px] self-center xl:max-w-[520px]" />

          <div className="max-w-xl">
            <h2 className="text-[clamp(2rem,3.4vw,3.25rem)] font-extrabold leading-[1.1] tracking-tight text-white">
              Manage every permit.
              <br />
              Track every connection.
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              One integrated platform for permits, projects, GIS infrastructure, finance,
              procurement, and field operations.
            </p>
          </div>

          {/* decorative statistic cards */}
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Platform overview
            </p>
            <div className="grid grid-cols-3 gap-3">
              {STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-sm"
                >
                  <div className="text-2xl font-bold text-white">{stat.value}</div>
                  <div className="mt-1 text-[11px] font-medium leading-tight text-white/60">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* trust row */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/55">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-peach" aria-hidden="true" />
            Trusted by infrastructure teams across Indonesia
          </span>
          <span className="inline-flex items-center gap-4 text-white/40">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> GIS mapping
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Live monitoring
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export default LoginVisualPanel;
