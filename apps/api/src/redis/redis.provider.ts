import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on('connect', () => console.log('[Redis] Connected'));
    client.on('error', (err) => console.error('[Redis] Error:', err.message));

    return client;
  },
};
