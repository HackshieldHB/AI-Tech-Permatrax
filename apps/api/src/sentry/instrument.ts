import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/** Panggil sekali sebelum NestFactory.create. Tanpa SENTRY_DSN, tidak melakukan apa-apa. */
export function initApiSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const isProd = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: isProd ? 0.1 : 1.0,
    profilesSampleRate: isProd ? 0.1 : 1.0,
  });
}
