/**
 * Parse REDIS_URL for @nestjs/bull (Bull v4 expects host/port object, not URL string).
 */
export function bullRedisOptionsFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
} {
  try {
    const normalized = redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://')
      ? redisUrl
      : `redis://${redisUrl}`;
    const u = new URL(normalized.replace(/^rediss:\/\//, 'redis://'));
    const pathDb = u.pathname?.replace(/^\//, '') ?? '';
    const db = pathDb ? parseInt(pathDb, 10) : 0;
    return {
      host: u.hostname || 'localhost',
      port: u.port ? parseInt(u.port, 10) : 6379,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      db: Number.isFinite(db) ? db : 0,
    };
  } catch {
    return { host: 'localhost', port: 6379, db: 0 };
  }
}
