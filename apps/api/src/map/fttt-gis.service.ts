import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GisTowerStatus } from '@permatrack/db';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.provider';
import type { CalculateFtttDto, CreateGisTowerDto, UpsertGisTowerDto } from './fttt-gis.dto';
import {
  classifyRoadKind,
  haversineMeters,
  midpoint,
  presentFtttRoutes,
  routeCrossesWater,
  selectFtttRoutes,
  towerInsideArea,
  validateFtttArea,
  validatePlanningRates,
  type LngLat,
  type RouteCandidate,
} from './fttt-gis.calc';
import { fetchFtttRouteCandidates, fetchWaterwaySegments } from './fttt-gis.routing';

const TOWER_STATUSES = new Set<string>(['EXISTING', 'ON_PROGRESS', 'PLANNING']);

function parsePolygon(raw: number[][] | undefined): LngLat[] {
  if (!raw) return [];
  const ring: LngLat[] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) {
      throw new BadRequestException('Setiap titik polygon harus [longitude, latitude].');
    }
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
      throw new BadRequestException('Koordinat polygon tidak valid.');
    }
    ring.push([lng, lat]);
  }
  return ring;
}

@Injectable()
export class FtttGisService {
  private readonly logger = new Logger(FtttGisService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  listTowers() {
    return this.prisma.gisTower.findMany({
      orderBy: [{ name: 'asc' }],
      take: 500,
      select: {
        id: true,
        name: true,
        code: true,
        latitude: true,
        longitude: true,
        status: true,
        notes: true,
        updatedAt: true,
      },
    });
  }

  createTower(dto: CreateGisTowerDto, userId: string) {
    return this.prisma.gisTower.create({
      data: {
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        status: dto.status as GisTowerStatus,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
      select: {
        id: true,
        name: true,
        code: true,
        latitude: true,
        longitude: true,
        status: true,
        notes: true,
        updatedAt: true,
      },
    });
  }

  async updateTower(id: string, dto: UpsertGisTowerDto) {
    const existing = await this.prisma.gisTower.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tower tidak ditemukan.');
    if (dto.status && !TOWER_STATUSES.has(dto.status)) {
      throw new BadRequestException('Status tower tidak dikenal.');
    }
    return this.prisma.gisTower.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        code: dto.code === undefined ? undefined : dto.code.trim() || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        status: dto.status as GisTowerStatus | undefined,
        notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        latitude: true,
        longitude: true,
        status: true,
        notes: true,
        updatedAt: true,
      },
    });
  }

  async deleteTower(id: string) {
    const existing = await this.prisma.gisTower.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tower tidak ditemukan.');
    await this.prisma.gisTower.delete({ where: { id } });
    return { id };
  }

  async calculate(dto: CalculateFtttDto) {
    if (dto.startTowerId === dto.destTowerId) {
      throw new BadRequestException('Starting tower dan destination tower harus berbeda.');
    }
    const ratesError = validatePlanningRates(dto.rates);
    if (ratesError) throw new BadRequestException(ratesError);

    const [start, dest, towers] = await Promise.all([
      this.prisma.gisTower.findUnique({ where: { id: dto.startTowerId } }),
      this.prisma.gisTower.findUnique({ where: { id: dto.destTowerId } }),
      this.prisma.gisTower.findMany({ take: 500 }),
    ]);
    if (!start) throw new NotFoundException('Starting tower tidak ditemukan.');
    if (!dest) throw new NotFoundException('Destination tower tidak ditemukan.');

    const polygon = dto.areaMethod === 'POLYGON' ? parsePolygon(dto.polygon) : [];
    const center: LngLat | undefined =
      dto.centerLon != null && dto.centerLat != null ? [dto.centerLon, dto.centerLat] : undefined;
    const startLl: LngLat = [start.longitude, start.latitude];
    const destLl: LngLat = [dest.longitude, dest.latitude];
    const areaError = validateFtttArea({
      areaMethod: dto.areaMethod,
      radiusMeters: dto.radiusMeters,
      center,
      polygon,
      start: startLl,
      dest: destLl,
    });
    if (areaError) throw new BadRequestException(areaError);

    const area = {
      areaMethod: dto.areaMethod,
      radiusMeters: dto.radiusMeters,
      center,
      polygon,
    };
    const existingReferences = towers
      .filter((tower) => tower.status === 'EXISTING' && tower.id !== start.id && tower.id !== dest.id)
      .filter((tower) => towerInsideArea([tower.longitude, tower.latitude], area))
      .map((tower) => ({
        id: tower.id,
        name: tower.name,
        code: tower.code,
        latitude: tower.latitude,
        longitude: tower.longitude,
        status: tower.status,
        distanceToStartM: Math.round(haversineMeters(startLl, [tower.longitude, tower.latitude])),
        distanceToDestinationM: Math.round(haversineMeters(destLl, [tower.longitude, tower.latitude])),
      }));

    const rawRoutes = await this.loadRoutes(startLl, destLl);
    if (rawRoutes.length === 0) {
      throw new BadRequestException(
        'Routing jalan tidak tersedia untuk pasangan tower ini. Kalkulasi tidak memakai garis lurus sebagai jalur.',
      );
    }

    const west = Math.min(startLl[0], destLl[0]) - 0.02;
    const east = Math.max(startLl[0], destLl[0]) + 0.02;
    const south = Math.min(startLl[1], destLl[1]) - 0.02;
    const north = Math.max(startLl[1], destLl[1]) + 0.02;
    const water = await fetchWaterwaySegments(fetch, west, south, east, north);
    const setback = dto.rates.waterSetbackMeters;

    const candidates: RouteCandidate[] = rawRoutes.map((route) => ({
      coordinates: route.coordinates,
      steps: route.steps,
      profile: route.profile,
      kind: classifyRoadKind(route.steps, route.profile),
      crossesWater: water.available
        ? routeCrossesWater(route.coordinates, water.segments, setback)
        : false,
    }));

    const picked = selectFtttRoutes(candidates);
    if (picked.length === 0) {
      throw new BadRequestException('Tidak ada jalur jalan yang cukup berbeda untuk pasangan tower ini.');
    }
    const routes = presentFtttRoutes(picked, dto.rates).map((route) => ({
      routeId: route.routeId,
      routeName: route.routeName,
      routeType: route.routeType,
      color: route.color,
      profile: route.profile,
      crossesWater: route.crossesWater,
      roadClass: route.kind,
      coordinates: route.coordinates,
      labelAt: midpoint(route.coordinates),
      distanceM: route.estimate.distanceM,
      foCableM: route.estimate.foCableM,
      manholeCount: route.estimate.manholes.length,
      manholes: route.estimate.manholes,
      handholeCount: route.estimate.handholes.length,
      handholes: route.estimate.handholes,
      poleCount: route.estimate.poles.length,
      poles: route.estimate.poles,
      spliceCount: route.estimate.spliceCount,
      supportingWork: route.estimate.supportingWork,
      estimatedCostIdr: route.estimate.costIdr,
      costBreakdown: route.estimate.costBreakdown,
      advantages: route.estimate.advantages,
      considerations: route.estimate.considerations,
    }));

    this.logger.log(
      `FTTT calc ${start.name} -> ${dest.name}: ${routes.length} route(s), waterData=${water.available}`,
    );

    return {
      startTower: {
        id: start.id,
        name: start.name,
        status: start.status,
        latitude: start.latitude,
        longitude: start.longitude,
      },
      destinationTower: {
        id: dest.id,
        name: dest.name,
        status: dest.status,
        latitude: dest.latitude,
        longitude: dest.longitude,
      },
      areaMethod: dto.areaMethod,
      radiusMeters: dto.areaMethod === 'RADIUS' ? dto.radiusMeters : null,
      existingReferences,
      routes,
      decisionSupport:
        'Perbandingan ini tidak menentukan jalur final. Tim Project memilih berdasarkan kondisi lapangan, teknis, dan biaya.',
      classificationNote:
        'Label Main Road, Local Road, dan Alternative memakai data routing OSM. Standar klasifikasi jalan JIP belum di-hardcode.',
      waterAssessment: {
        dataAvailable: water.available,
        automaticCrossingEnabled: false,
        setbackMeters: setback ?? null,
        note: water.available
          ? 'Water crossing hanya ditandai bila geometri jalur berpotongan dengan badan air OSM. Sistem tidak membuat jalur air hanya karena jaraknya lebih pendek, dan tidak menerapkan buffer kecuali nilai setback diisi.'
          : 'Data badan air tidak tersedia pada permintaan ini. Tidak ada jalur yang ditandai sebagai water crossing.',
      },
      parameterNote:
        'Panjang kabel, manhole, handhole, splicing, tiang, dan biaya dihitung dari parameter yang diinput pada permintaan ini, bukan dari tarif tetap di sistem.',
    };
  }

  private async loadRoutes(start: LngLat, end: LngLat) {
    const cacheKey = `fttt-route:v1:${start[0].toFixed(5)},${start[1].toFixed(5)};${end[0].toFixed(5)},${end[1].toFixed(5)}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof fetchFtttRouteCandidates>>;
    } catch {
      /* cache miss on redis error */
    }
    const routes = await fetchFtttRouteCandidates(fetch, start, end);
    if (routes.length > 0) {
      try {
        await this.redis.setex(cacheKey, 86_400, JSON.stringify(routes));
      } catch {
        /* ignore cache write failure */
      }
    }
    return routes;
  }
}
