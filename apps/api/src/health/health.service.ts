import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type Redis from 'ioredis';

// NEW: Liveness/degraded checks for ops
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async checkLiveness() {
    const timestamp = new Date().toISOString();
    let database: 'ok' | 'error' = 'ok';
    let redis: 'ok' | 'error' = 'ok';
    let storage: 'ok' | 'skipped' = 'skipped';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') redis = 'error';
    } catch {
      redis = 'error';
    }

    const degraded = database === 'error' || redis === 'error';
    return {
      status: degraded ? ('degraded' as const) : ('ok' as const),
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      services: { database, redis, storage },
    };
  }

  async checkReadiness() {
    const live = await this.checkLiveness();
    const ok = live.services.database === 'ok' && live.services.redis === 'ok';
    return { ok, live };
  }
}
