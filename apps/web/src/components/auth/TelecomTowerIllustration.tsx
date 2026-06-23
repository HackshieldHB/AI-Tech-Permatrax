import React from 'react';

/**
 * Original PermaTrax "Connected Infrastructure" illustration: a telecom tower with
 * signal rings, fiber/network paths, GIS nodes and location pins.
 *
 * Pure inline SVG — no external resources, no random values, deterministic markup
 * (safe for SSR/hydration). Signal/float animations are gated behind `motion-safe`
 * so they are disabled automatically when the user prefers reduced motion.
 */
export function TelecomTowerIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 420"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby="tower-title tower-desc"
      preserveAspectRatio="xMidYMid meet"
    >
      <title id="tower-title">PermaTrax connected infrastructure</title>
      <desc id="tower-desc">
        A telecommunications tower broadcasting signal rings, connected by fiber network
        paths to GIS nodes and location markers.
      </desc>

      <defs>
        <linearGradient id="tower-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C9BEFF" />
          <stop offset="1" stopColor="#8A63FF" />
        </linearGradient>
        <linearGradient id="tower-beacon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFD4CC" />
          <stop offset="1" stopColor="#FF6B6B" />
        </linearGradient>
        <radialGradient id="tower-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FF8A8A" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF6B6B" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* faint GIS contour lines */}
      <g stroke="#A78BFA" strokeOpacity="0.18" fill="none" strokeWidth="1.5">
        <path d="M20 330 C 120 300, 200 360, 300 330 S 470 300, 500 340" />
        <path d="M20 360 C 130 335, 220 390, 320 358 S 470 335, 500 372" />
        <path d="M40 300 C 140 275, 210 320, 300 298" />
      </g>

      {/* network paths to nodes */}
      <g stroke="#FFB4A8" strokeOpacity="0.45" strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M260 250 L 120 320" />
        <path d="M260 250 L 410 300" />
        <path d="M260 250 L 360 360" />
        <path d="M260 250 L 95 250" />
      </g>

      {/* glowing GIS nodes (gentle float) */}
      <g className="motion-safe:animate-float-y">
        <circle cx="120" cy="320" r="6" fill="#FF6B6B" />
        <circle cx="120" cy="320" r="11" fill="none" stroke="#FF6B6B" strokeOpacity="0.4" />
      </g>
      <g className="motion-safe:animate-float-y" style={{ animationDelay: '1.4s' }}>
        <circle cx="410" cy="300" r="6" fill="#A78BFA" />
        <circle cx="410" cy="300" r="11" fill="none" stroke="#A78BFA" strokeOpacity="0.45" />
      </g>
      <g className="motion-safe:animate-float-y" style={{ animationDelay: '0.7s' }}>
        <circle cx="95" cy="250" r="5" fill="#FFD4CC" />
      </g>

      {/* location pins */}
      <g className="motion-safe:animate-float-y" style={{ animationDelay: '2s' }}>
        <path d="M360 360 c0 -9 -7 -15 -15 -15 s-15 6 -15 15 c0 11 15 26 15 26 s15 -15 15 -26 Z" fill="#FF6B6B" />
        <circle cx="345" cy="357" r="5" fill="#FFFFFF" />
      </g>

      {/* signal rings emitting from the antenna */}
      <g>
        <circle cx="260" cy="92" r="26" fill="none" stroke="#FFD4CC" strokeWidth="2.5" className="motion-safe:animate-signal-pulse" style={{ transformOrigin: '260px 92px' }} />
        <circle cx="260" cy="92" r="26" fill="none" stroke="#FF8A8A" strokeWidth="2.5" className="motion-safe:animate-signal-pulse-slow" style={{ transformOrigin: '260px 92px', animationDelay: '1.6s' }} />
        <circle cx="260" cy="92" r="60" fill="url(#tower-glow)" />
      </g>

      {/* tower structure */}
      <g stroke="url(#tower-steel)" strokeWidth="5" strokeLinecap="round" fill="none">
        {/* legs */}
        <path d="M236 250 L 260 110" />
        <path d="M284 250 L 260 110" />
        {/* cross braces */}
        <path d="M243 210 L 277 210" />
        <path d="M247 178 L 273 178" />
        <path d="M251 146 L 269 146" />
        <path d="M239 232 L 281 232" />
        {/* zig-zag bracing */}
        <path d="M243 210 L 251 178 L 269 178 L 277 210" strokeOpacity="0.6" strokeWidth="3" />
        <path d="M239 232 L 247 210 L 273 210 L 281 232" strokeOpacity="0.5" strokeWidth="3" />
      </g>

      {/* antenna panels */}
      <g fill="#C9BEFF">
        <rect x="244" y="100" width="7" height="22" rx="3" />
        <rect x="269" y="100" width="7" height="22" rx="3" />
        <rect x="256" y="94" width="8" height="26" rx="3" fill="#8A63FF" />
      </g>

      {/* radio beacon */}
      <circle cx="260" cy="92" r="7" fill="url(#tower-beacon)" />
      <circle cx="260" cy="92" r="3" fill="#FFFFFF" />

      {/* base platform */}
      <g fill="#6D4AFF" fillOpacity="0.85">
        <rect x="222" y="250" width="76" height="9" rx="4.5" />
        <rect x="234" y="259" width="52" height="7" rx="3.5" fillOpacity="0.6" />
      </g>

      {/* subtle ground city blocks */}
      <g fill="#8A63FF" fillOpacity="0.22">
        <rect x="430" y="318" width="22" height="40" rx="3" />
        <rect x="458" y="332" width="16" height="26" rx="3" />
        <rect x="64" y="330" width="18" height="28" rx="3" />
      </g>
    </svg>
  );
}

export default TelecomTowerIllustration;
