export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (!process.env.SENTRY_DSN?.trim() && !process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) return;
  await import('../sentry.server.config');
}
