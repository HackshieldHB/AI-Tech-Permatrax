import { Global, Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module'; // FIX: provides JwtService for WebSocket token verification

@Global()
@Module({
  imports: [RedisModule, PrismaModule, AuthModule], // FIX: AuthModule exports JwtModule → JwtService available
  controllers: [NotificationsController],
  providers: [NotificationsGateway, NotificationsService],
  exports: [NotificationsGateway, NotificationsService],
})
export class NotificationsModule {}
