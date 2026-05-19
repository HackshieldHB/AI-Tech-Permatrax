import { BadRequestException } from '@nestjs/common';
import { MapService } from './map.service';

describe('MapService getHomepassTile', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
  } as unknown as import('ioredis').default;

  function createService(prisma: { $queryRaw: jest.Mock }) {
    return new MapService(prisma as never, redis);
  }

  it('runs parameterized $queryRaw for valid tile', async () => {
    const tileBuf = Buffer.from([0x1a, 0x2b]);
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ tile: tileBuf }]),
    };
    const service = createService(prisma);
    const out = await service.getHomepassTile(10, 512, 300);
    expect(out.equals(tileBuf)).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns empty buffer when tile is null', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ tile: null }]),
    };
    const service = createService(prisma);
    const out = await service.getHomepassTile(0, 0, 0);
    expect(out.length).toBe(0);
  });

  it('does not call prisma when coordinates are invalid (defense in depth)', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const service = createService(prisma);
    await expect(service.getHomepassTile(2, 4, 0)).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
