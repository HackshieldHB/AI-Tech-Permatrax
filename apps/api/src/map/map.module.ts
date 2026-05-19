import { Module } from '@nestjs/common'; // FIX: GIS module
import { MapService } from './map.service';
import { MapController } from './map.controller';
import { PrismaModule } from '../prisma/prisma.module';

// FIX: MapService uses REDIS_CLIENT from @Global() RedisModule — no Nest CacheModule needed

@Module({
  imports: [PrismaModule],
  controllers: [MapController],
  providers: [MapService],
})
export class MapModule {}
