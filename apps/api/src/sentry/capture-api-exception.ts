import { HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * Kirim ke Sentry: error non-HTTP atau HTTP ≥500. Tanpa SENTRY_DSN, no-op.
 * Dipanggil dari GlobalExceptionFilter agar tidak bentrok dengan filter lain.
 */
export function captureApiExceptionForSentry(exception: unknown, statusCode: number): void {
  if (!process.env.SENTRY_DSN?.trim()) return;

  const fromHttp = exception instanceof HttpException;
  const shouldCapture = !fromHttp || statusCode >= 500;
  if (!shouldCapture) return;

  Sentry.captureException(exception);
}
