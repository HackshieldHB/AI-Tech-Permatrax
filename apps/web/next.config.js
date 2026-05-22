const sentryEnabled =
  Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) || Boolean(process.env.SENTRY_DSN?.trim());

// DEV VPS: set BASE_PATH=/Permatrax in .env to serve under aitech-ilt.co.id/Permatrax
// PROD:    leave BASE_PATH unset — runs at root (permatrax.tech/)
const basePath = process.env.BASE_PATH || '';

// DEV VPS: API runs on port 3003 to avoid conflict with website (3000)
// PROD:    API runs on port 3001 (default)
const apiUrl = process.env.API_URL || 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // basePath: '' on PROD, '/Permatrax' on DEV VPS
  ...(basePath && { basePath }),

  // NEW: standalone output only for Docker build on Linux
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  // FIX: reduce build memory pressure on Windows CI/dev boxes
  experimental: {
    workerThreads: false,
    cpus: 1,
    ...(sentryEnabled ? { instrumentationHook: true } : {}),
  },
  // FIX Issue 3: loosen chunk splitting — aggressive maxSize was producing unstable chunk names
  // that ngrok/browser-cache could resolve to "/_next/undefined" after rebuilds. Keep `chunks: 'all'`
  // so common code is still shared, but let Next's defaults name and emit chunks.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        // FIX Issue 3: removed `maxSize: 200000` — too aggressive splitting caused chunk name churn
        // on rebuild, which produced `Loading chunk ... failed (error: <host>/_next/undefined)` in
        // clients that still held a stale reference (common through ngrok tunnels).
      };
    }
    return config;
  },
  // FIX Issue 3: never serve stale chunk bundles through ngrok — force browsers to revalidate _next assets
  async headers() {
    return [
      {
        source: '/_next/:path*', // FIX Issue 3: cover every emitted Next asset path
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate', // FIX Issue 3: prevent ngrok/browser from reusing deleted chunk files
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/setting/profile',
        destination: '/settings/profile',
        permanent: false,
      },
    ];
  },
};

module.exports = sentryEnabled
  ? (() => {
      const { withSentryConfig } = require('@sentry/nextjs');
      return withSentryConfig(nextConfig, {
        silent: true,
        hideSourceMaps: true,
      });
    })()
  : nextConfig;
