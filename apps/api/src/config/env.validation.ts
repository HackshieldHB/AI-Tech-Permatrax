import { z } from 'zod';

// NEW: Extended env validation — fail fast on boot; optional cloud/SMTP for production
export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith('postgresql://') || s.startsWith('postgres://'), 'DATABASE_URL must be a PostgreSQL connection string'),
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  /** Production CORS allowlist (comma-separated). Falls back to FRONTEND_URL when unset. Dev ignores this. */
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Local disk storage (default: apps/api/uploads when cwd is apps/api) */
  UPLOAD_DIR: z.string().optional().default('./uploads'),
  /** Public URL prefix returned on upload — must match Nginx /api/files proxy */
  FILE_BASE_URL: z.string().url().optional(),
  /** Max upload size in bytes (multer /storage/upload); default 50MB */
  MAX_FILE_SIZE: z.coerce.number().int().positive().optional().default(52_428_800),
  /** Legacy — not used by StorageService (local filesystem only) */
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_BUCKET_NAME: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Pengirim email procurement (PO); fallback ke SMTP_FROM lalu SMTP_USER */
  PROCUREMENT_FROM_EMAIL: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    console.error('Environment validation failed:');
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  return result.data;
}
