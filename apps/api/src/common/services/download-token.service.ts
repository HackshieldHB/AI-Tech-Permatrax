import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * FIX: short-lived HMAC-signed tokens for @Public() download URLs.
 *
 * Rationale: BA Open / BAKP / SIP / Surat Jalan download endpoints must be
 * usable from <a href>/window.open (no Authorization header possible), so
 * requiring JWT breaks UX. Instead we mint a signed, time-limited token
 * server-side (authenticated API) and verify it on the public download route.
 */
@Injectable()
export class DownloadTokenService {
  private readonly logger = new Logger('DownloadTokenService');

  constructor(private readonly config: ConfigService) {}

  private get secret(): string {
    // FIX: reuse JWT secret as HMAC key — rotated centrally, already 64-byte random
    const s = this.config.get<string>('JWT_SECRET');
    if (!s) {
      this.logger.warn('[DownloadToken] JWT_SECRET missing — using insecure fallback.');
      return 'fallback-insecure-secret-do-not-use';
    }
    return s;
  }

  /** FIX: generate a signed token valid for `ttlSeconds` (default 1h). */
  generate(resourceId: string, ttlSeconds = 3600): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = randomBytes(8).toString('hex');
    const payload = `${resourceId}:${expires}:${nonce}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  /** FIX: verify token belongs to resourceId, is not expired, and signature matches. */
  verify(token: string, resourceId: string): boolean {
    try {
      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split(':');
      if (parts.length !== 4) return false;

      const [id, expiresStr, nonce, sig] = parts;
      if (id !== resourceId) return false;

      const expires = parseInt(expiresStr, 10);
      if (!Number.isFinite(expires) || Date.now() / 1000 > expires) return false;

      const payload = `${id}:${expiresStr}:${nonce}`;
      const expectedSig = createHmac('sha256', this.secret).update(payload).digest('hex');
      // FIX: timing-safe comparison — blocks signature-leak side channels
      const a = Buffer.from(sig, 'hex');
      const b = Buffer.from(expectedSig, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
