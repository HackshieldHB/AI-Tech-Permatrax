import { Global, Module } from '@nestjs/common';
import { RedisProvider, REDIS_CLIENT } from './redis.provider';

@Global()  // Global so every module can inject without re-importing
@Module({
  providers: [RedisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
