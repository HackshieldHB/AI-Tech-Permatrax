/**
 * Browser-safe structured debug logging. No output in production unless NEXT_PUBLIC_DEBUG=true.
 */
export function clientDebugLog(context: string, payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const enabled =
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG === 'true';
  if (!enabled) return;
  // eslint-disable-next-line no-console -- intentional gated debug
  console.debug(`[${context}]`, payload);
}
