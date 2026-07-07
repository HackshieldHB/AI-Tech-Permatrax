import { BadRequestException, Injectable, Logger, Inject } from '@nestjs/common'; // FIX: Logger + Redis inject
import { Prisma } from '@prisma/client';
import { MapDrawing } from '@permatrack/db';
import Redis from 'ioredis'; // FIX: Redis cache (ioredis — project standard)
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.provider'; // FIX: global Redis client
import { assertMvtTileCoordinates } from './map-tile-params';

/** minLon, minLat, maxLon, maxLat from query string */
function parseMapBbox(bbox: string): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  const parts = bbox.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new BadRequestException('Parameter bbox tidak valid. Gunakan: minLon,minLat,maxLon,maxLat');
  }
  let [minLon, minLat, maxLon, maxLat] = parts;
  if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  return { minLon, minLat, maxLon, maxLat };
}

function clampMapListLimit(limit?: number): number {
  const n = limit == null || Number.isNaN(limit) ? 100 : Math.floor(limit);
  return Math.min(500, Math.max(1, n));
}

// FIX: Valhalla uses polyline6 encoding (precision 6)
function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = []; // FIX
  let index = 0; // FIX
  let lat = 0; // FIX
  let lng = 0; // FIX
  while (index < encoded.length) {
    let b: number; // FIX
    let shift = 0; // FIX
    let result = 0; // FIX
    do {
      b = encoded.charCodeAt(index++) - 63; // FIX
      result |= (b & 0x1f) << shift; // FIX
      shift += 5; // FIX
    } while (b >= 0x20); // FIX
    lat += result & 1 ? ~(result >> 1) : result >> 1; // FIX
    shift = 0; // FIX
    result = 0; // FIX
    do {
      b = encoded.charCodeAt(index++) - 63; // FIX
      result |= (b & 0x1f) << shift; // FIX
      shift += 5; // FIX
    } while (b >= 0x20); // FIX
    lng += result & 1 ? ~(result >> 1) : result >> 1; // FIX
    coords.push([lng / 1e6, lat / 1e6]); // FIX: polyline6 = /1e6
  }
  return coords; // FIX
}

// FIX: concurrency limiter — max 3 concurrent OSRM requests
class ConcurrencyLimiter {
  private queue: Array<() => void> = []; // FIX
  private running = 0; // FIX
  constructor(private max: number) {} // FIX
  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.running++; // FIX
        try {
          resolve(await fn()); // FIX
        } catch (e) {
          reject(e); // FIX
        } finally {
          this.running--; // FIX
          if (this.queue.length) this.queue.shift()!(); // FIX
        }
      }; // FIX
      if (this.running < this.max) void execute(); // FIX
      else this.queue.push(execute); // FIX
    }); // FIX
  } // FIX
} // FIX

// FIX: module-level limiter instance
const osrmLimiter = new ConcurrencyLimiter(3); // FIX

@Injectable()
export class MapService {
  private readonly logger = new Logger(MapService.name); // FIX

  constructor(
    private readonly prisma: PrismaService, // FIX
    @Inject(REDIS_CLIENT) private readonly redis: Redis, // FIX: Redis cache (TTL via SETEX)
  ) {}

  /**
   * Generates a Mapbox Vector Tile (MVT) for the Homepass layer utilizing PostGIS.
   * This projects the 4326 geometry into the web mercator 3857 coordinate space
   * required by standard web mapping libraries (Mapbox GL JS/MapLibre).
   */
  async getHomepassTile(z: number, x: number, y: number): Promise<Buffer> {
    assertMvtTileCoordinates(z, x, y);

    const result = await this.prisma.$queryRaw<{ tile: Buffer | null }[]>`
      WITH
      bounds AS (
        SELECT ST_TileEnvelope(${z}::integer, ${x}::integer, ${y}::integer) AS geom
      ),
      mvtgeom AS (
        SELECT 
          h.id::text,
          h."projectId",
          h."clusterId",
          h.status,
          ST_AsMVTGeom(ST_Transform(h.geom, 3857), bounds.geom) AS geom
        FROM "Homepass" h, bounds
        WHERE ST_Intersects(h.geom, ST_Transform(bounds.geom, 4326))
      )
      SELECT ST_AsMVT(mvtgeom.*, 'homepasses') AS tile
      FROM mvtgeom;
    `;

    const tile = result[0]?.tile;
    if (tile == null) {
      return Buffer.alloc(0);
    }
    return Buffer.isBuffer(tile) ? tile : Buffer.from(tile);
  }

  async analyzeCluster(geoJsonPolygon: unknown): Promise<{ count: number; estimatedCost: number }> {
    const geoJson = JSON.stringify(geoJsonPolygon);

    const result = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int as total
      FROM "Homepass"
      WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}), 4326))
    `;

    const count = result[0]?.total || 0;
    const estimatedCost = count * 500;

    return { count, estimatedCost };
  }

  async getDrawings(limit?: number): Promise<MapDrawing[]> {
    const take = clampMapListLimit(limit);
    return this.prisma.mapDrawing.findMany({
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async saveDrawing(data: { geojson: any; color: string }): Promise<MapDrawing> {
    return this.prisma.mapDrawing.create({
      data: {
        geojson: data.geojson,
        color: data.color,
      },
    });
  }

  async deleteDrawing(id: string): Promise<MapDrawing> {
    return this.prisma.mapDrawing.delete({ where: { id } });
  }

  // FIX: Get permit clusters for map — bounded by limit; optional bbox (viewport)
  async getPermitClusters(bbox?: string | null, limit?: number) {
    const take = clampMapListLimit(limit);
    const bboxWhere: Prisma.PermitClusterWhereInput = bbox?.trim()
      ? (() => {
          const { minLon, minLat, maxLon, maxLat } = parseMapBbox(bbox.trim());
          return {
            AND: [
              { latitude: { not: null } },
              { longitude: { not: null } },
              { latitude: { gte: minLat, lte: maxLat } },
              { longitude: { gte: minLon, lte: maxLon } },
            ],
          };
        })()
      : {
          AND: [{ latitude: { not: null } }, { longitude: { not: null } }],
        };

    const clusters = await this.prisma.permitCluster.findMany({
      where: bboxWhere,
      take,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        clusterCode: true,
        ispCustomer: true,
        fiberType: true,
        currentPhase: true,
        status: true,
        readyForConstructionAt: true,
        latitude: true,
        longitude: true,
        rwName: true,
        areaCategory: true,
        visitRequest: {
          select: {
            cleanList: {
              select: {
                siteName: true,
                kotaKabupaten: true,
                kecamatan: true,
                kelurahan: true,
                rwCode: true,
                homepasCount: true,
              },
            },
          },
        },
        bakp: {
          select: {
            ispDecisionAt: true,
            status: true,
          },
        },
      },
    });

    return clusters.map((c) => ({
      id: c.id,
      clusterCode: c.clusterCode,
      ispCustomer: c.ispCustomer,
      fiberType: c.fiberType,
      phase: c.currentPhase,
      status: c.status,
      latitude: c.latitude,
      longitude: c.longitude,
      rwName: c.rwName || c.visitRequest?.cleanList?.rwCode || null,
      areaCategory: c.areaCategory,
      siteName: c.visitRequest?.cleanList?.siteName ?? null,
      city: c.visitRequest?.cleanList?.kotaKabupaten ?? null,
      kecamatan: c.visitRequest?.cleanList?.kecamatan ?? null,
      kelurahan: c.visitRequest?.cleanList?.kelurahan ?? null,
      homepasCount: c.visitRequest?.cleanList?.homepasCount ?? 0,
      isDone: c.currentPhase === 'PERMIT_DONE' || c.status === 'COMPLETED',
      doneAt: c.bakp?.ispDecisionAt ?? c.readyForConstructionAt ?? null,
      bakpStatus: c.bakp?.status ?? null,
    }));
  }

  // FIX: Update cluster coordinates (from map click)
  async updateClusterCoordinates(
    id: string,
    data: { latitude: number; longitude: number; rwName?: string },
  ) {
    return this.prisma.permitCluster.update({
      where: { id },
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        rwName: data.rwName ?? undefined,
      },
    });
  }

  // FIX: GIS layers (KMZ uploads) — bounded list
  async getGisLayers(limit?: number) {
    const take = clampMapListLimit(limit);
    return this.prisma.gisLayer.findMany({
      include: {
        uploader: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // FIX: Save KMZ layer (after parsing on frontend)
  async saveGisLayer(
    data: {
      name: string;
      fileUrl: string;
      geoJson: unknown;
      color?: string;
    },
    userId: string,
  ) {
    return this.prisma.gisLayer.create({
      data: {
        name: data.name,
        fileUrl: data.fileUrl,
        geoJson: data.geoJson as Prisma.InputJsonValue,
        color: data.color || '#FF6B00',
        uploadedBy: userId,
      },
    });
  }

  // FIX: Toggle GIS layer visibility
  async toggleGisLayer(id: string, isVisible: boolean) {
    return this.prisma.gisLayer.update({
      where: { id },
      data: { isVisible },
    });
  }

  // FIX: Delete GIS layer
  async deleteGisLayer(id: string) {
    return this.prisma.gisLayer.delete({ where: { id } });
  }

  // FIX: Overpass API proxy (CORS-free from browser)
  async getFiberBackbone(lat: number, lon: number, radiusMeters = 5000) {
    const query = `
      [out:json][timeout:25];
      (
        way["telecom"="communication"](around:${radiusMeters},${lat},${lon});
        way["cables"](around:${radiusMeters},${lat},${lon});
        way["highway"]["cables"](around:${radiusMeters},${lat},${lon});
        node["telecom"="cabinet"](around:${radiusMeters},${lat},${lon});
        node["telecom"="exchange"](around:${radiusMeters},${lat},${lon});
        node["telecom"="data_center"](around:${radiusMeters},${lat},${lon});
      );
      out geom;
    `;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      const data = (await response.json()) as { elements?: unknown[] };
      return data.elements || [];
    } catch {
      return [];
    }
  }

  // FIX: JSON cache read (Redis GET)
  private async redisJsonGet<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key); // FIX
    if (!raw) return null; // FIX
    try {
      return JSON.parse(raw) as T; // FIX
    } catch {
      return null; // FIX
    }
  }

  // FIX: JSON cache write (Redis SETEX, ttl seconds)
  private async redisJsonSet(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.redis.setex(key, ttlSec, JSON.stringify(value)); // FIX
  }

  // FIX: proxy routing — OSRM + Valhalla with straight-line last resort.
  // GIS Issue 9: profile 'foot' routes via Valhalla `pedestrian` costing FIRST —
  // pedestrian ignores one-way traffic rules, matching how cables are pulled.
  // (The public OSRM demo only serves the car profile, so it is the fallback.)
  // GIS Issue 4: result carries `source` so the UI can flag straight-line
  // fallbacks, and cache TTL is 24h to stay clear of public-server rate limits.
  async getRoute(
    fromLng: number, // FIX
    fromLat: number, // FIX
    toLng: number, // FIX
    toLat: number, // FIX
    profile: 'driving' | 'walking' | 'foot' = 'driving',
  ): Promise<{ coordinates: [number, number][]; distanceM: number; source: 'osrm' | 'valhalla' | 'straight' }> {
    const cacheKey =
      `route:v2:${fromLng.toFixed(4)},${fromLat.toFixed(4)}` +
      `:${toLng.toFixed(4)},${toLat.toFixed(4)}:${profile}`; // FIX

    const cached = await this.redisJsonGet<{
      coordinates: [number, number][];
      distanceM: number;
      source: 'osrm' | 'valhalla' | 'straight';
    }>(cacheKey); // FIX
    if (cached) return cached; // FIX

    const CACHE_TTL_SEC = 86400; // GIS Issue 4: routes rarely change — cache 24h

    const straightLine = (): { coordinates: [number, number][]; distanceM: number; source: 'straight' } => {
      const R = 6371000; // FIX
      const dLat = ((toLat - fromLat) * Math.PI) / 180; // FIX
      const dLon = ((toLng - fromLng) * Math.PI) / 180; // FIX
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((fromLat * Math.PI) / 180) *
          Math.cos((toLat * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2; // FIX
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // FIX
      return {
        coordinates: [
          [fromLng, fromLat],
          [toLng, toLat],
        ], // FIX
        distanceM: Math.round(dist * 1.4), // FIX
        source: 'straight',
      }; // FIX
    }; // FIX

    const tryOsrm = async (): Promise<{ coordinates: [number, number][]; distanceM: number; source: 'osrm' } | null> => {
      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${fromLng},${fromLat};${toLng},${toLat}` +
          `?overview=full&geometries=geojson`; // FIX

        const res = await fetch(url, {
          signal: AbortSignal.timeout(4000), // FIX
          headers: { 'User-Agent': 'PermaTrax-GIS/1.0' }, // FIX
        }); // FIX

        if (res.ok) {
          const data = await res.json(); // FIX
          if (data.code === 'Ok' && data.routes?.length) {
            return {
              coordinates: data.routes[0].geometry.coordinates as [number, number][],
              distanceM: Math.round(data.routes[0].distance), // FIX
              source: 'osrm',
            }; // FIX
          }
        }
      } catch {
        /* FIX: silent — no log spam per request */
      }
      return null;
    };

    const tryValhalla = async (
      costing: 'auto' | 'pedestrian',
    ): Promise<{ coordinates: [number, number][]; distanceM: number; source: 'valhalla' } | null> => {
      try {
        const vRes = await fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST', // FIX
          headers: {
            'Content-Type': 'application/json', // FIX
            'User-Agent': 'PermaTrax-GIS/1.0', // FIX
          }, // FIX
          body: JSON.stringify({
            locations: [
              { lon: fromLng, lat: fromLat, type: 'break' }, // FIX
              { lon: toLng, lat: toLat, type: 'break' }, // FIX
            ], // FIX
            costing, // GIS Issue 9: pedestrian for cable routing (ignores one-way)
            directions_type: 'none', // FIX
          }), // FIX
          signal: AbortSignal.timeout(5000), // FIX
        }); // FIX

        if (vRes.ok) {
          const vData = await vRes.json(); // FIX
          if (vData.trip?.legs?.length) {
            const leg = vData.trip.legs[0]; // FIX
            let coords: [number, number][] = []; // FIX

            if (typeof leg.shape === 'string') {
              coords = decodePolyline6(leg.shape); // FIX
            } else if (Array.isArray(leg.shape)) {
              coords = (leg.shape as { lon: number; lat: number }[]).map((p) => [p.lon, p.lat]); // FIX
            } // FIX

            if (coords.length >= 2) {
              return {
                coordinates: coords, // FIX
                distanceM: Math.round((vData.trip.summary?.length ?? 0) * 1000), // FIX
                source: 'valhalla',
              }; // FIX
            }
          }
        }
      } catch {
        /* FIX: silent fallback */
      }
      return null;
    };

    return osrmLimiter.run(async () => {
      // GIS Issue 9: cable routing (foot) ignores one-way — pedestrian first
      const attempts =
        profile === 'foot' || profile === 'walking'
          ? [() => tryValhalla('pedestrian'), tryOsrm]
          : [tryOsrm, () => tryValhalla('auto')];

      for (const attempt of attempts) {
        const result = await attempt();
        if (result) {
          await this.redisJsonSet(cacheKey, result, CACHE_TTL_SEC); // FIX
          return result; // FIX
        }
      }
      return straightLine(); // FIX
    }); // FIX
  }

  // FIX: snap to road — limiter, 3s timeout, silent fail
  async snapPointToRoad(lng: number, lat: number): Promise<[number, number]> {
    const cacheKey = `snap:${lng.toFixed(5)},${lat.toFixed(5)}`; // FIX
    const cached = await this.redisJsonGet<[number, number]>(cacheKey); // FIX
    if (cached) return cached; // FIX

    return osrmLimiter.run(async () => {
      try {
        const url =
          `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`; // FIX
        const res = await fetch(url, {
          signal: AbortSignal.timeout(3000), // FIX
          headers: { 'User-Agent': 'PermaTrax-GIS/1.0' }, // FIX
        }); // FIX
        if (res.ok) {
          const data = await res.json(); // FIX
          if (data.code === 'Ok' && data.waypoints?.length) {
            const snapped = data.waypoints[0].location as [number, number]; // FIX
            await this.redisJsonSet(cacheKey, snapped, 3600); // FIX
            return snapped; // FIX
          }
        }
      } catch {
        /* FIX: silent */
      }
      return [lng, lat]; // FIX
    }); // FIX
  }

  // FIX: multi-waypoint — 1 call for ODC → ODP₁ → … (legs as segments)
  // GIS Issue 9: profile 'foot' → Valhalla pedestrian first (ignores one-way)
  async getMultiRoute(
    waypoints: Array<[number, number]>, // FIX
    profile: 'driving' | 'walking' | 'foot' = 'driving',
  ): Promise<{
    segments: Array<{ coordinates: [number, number][]; distanceM: number; source?: string }>;
    totalDistanceM: number;
  }> {
    if (waypoints.length < 2) {
      return { segments: [], totalDistanceM: 0 }; // FIX
    }

    const coordStr = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';'); // FIX
    const cacheKey = `multiroute:v2:${coordStr.slice(0, 120)}:${profile}`; // FIX
    const cached = await this.redisJsonGet<{
      segments: Array<{ coordinates: [number, number][]; distanceM: number; source?: string }>;
      totalDistanceM: number;
    }>(cacheKey); // FIX
    if (cached) return cached; // FIX
    const CACHE_TTL_SEC = 86400; // GIS Issue 4: cache 24h

    const straightFallback = () => {
      const segments: Array<{ coordinates: [number, number][]; distanceM: number; source?: string }> = []; // FIX
      let total = 0; // FIX
      for (let i = 1; i < waypoints.length; i++) {
        const [lng1, lat1] = waypoints[i - 1]; // FIX
        const [lng2, lat2] = waypoints[i]; // FIX
        const R = 6371000; // FIX
        const dLat = (lat2 - lat1) * (Math.PI / 180); // FIX
        const dLon = (lng2 - lng1) * (Math.PI / 180); // FIX
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2; // FIX
        const d = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3); // FIX
        total += d; // FIX
        segments.push({
          coordinates: [
            [lng1, lat1],
            [lng2, lat2],
          ], // FIX
          distanceM: d, // FIX
          source: 'straight', // GIS Issue 4
        }); // FIX
      }
      return { segments, totalDistanceM: total }; // FIX
    }; // FIX

    // GIS Issue 9: Valhalla multi-leg trip — pedestrian costing ignores one-way
    const tryValhallaMulti = async (): Promise<{
      segments: Array<{ coordinates: [number, number][]; distanceM: number; source?: string }>;
      totalDistanceM: number;
    } | null> => {
      try {
        const vRes = await fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'PermaTrax-GIS/1.0',
          },
          body: JSON.stringify({
            locations: waypoints.map(([lng, lat]) => ({ lon: lng, lat, type: 'break' })),
            costing: 'pedestrian',
            directions_type: 'none',
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!vRes.ok) return null;
        const vData = await vRes.json();
        const legs = vData.trip?.legs as Array<{ shape?: unknown; summary?: { length?: number } }> | undefined;
        if (!legs?.length || legs.length !== waypoints.length - 1) return null;

        let total = 0;
        const segments = legs.map((leg, i) => {
          let coords: [number, number][] = [];
          if (typeof leg.shape === 'string') {
            coords = decodePolyline6(leg.shape);
          } else if (Array.isArray(leg.shape)) {
            coords = (leg.shape as { lon: number; lat: number }[]).map((p) => [p.lon, p.lat] as [number, number]);
          }
          const dM = Math.round((leg.summary?.length ?? 0) * 1000);
          total += dM;
          if (coords.length < 2) {
            return { coordinates: [waypoints[i], waypoints[i + 1]], distanceM: dM, source: 'straight' };
          }
          return { coordinates: coords, distanceM: dM, source: 'valhalla' };
        });
        return { segments, totalDistanceM: total };
      } catch {
        return null;
      }
    };

    const tryOsrmMulti = async (): Promise<{
      segments: Array<{ coordinates: [number, number][]; distanceM: number; source?: string }>;
      totalDistanceM: number;
    } | null> => {
      try {
        const url =
          `https://router.project-osrm.org/route/v1/driving/${coordStr}` +
          `?overview=full&geometries=geojson&steps=true`; // FIX

        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000), // FIX
          headers: { 'User-Agent': 'PermaTrax-GIS/1.0' }, // FIX
        }); // FIX

        if (!res.ok) return null; // FIX
        const data = await res.json(); // FIX
        if (data.code !== 'Ok' || !data.routes?.length) return null; // FIX

        const route = data.routes[0]; // FIX
        const legs = route.legs as Array<{
          distance: number; // FIX
          steps?: Array<{ geometry?: { coordinates?: [number, number][] } }>; // FIX
        }>; // FIX

        const segments = legs.map((leg, i: number) => {
          let coords: [number, number][] = []; // FIX
          if (Array.isArray(leg.steps)) {
            for (const s of leg.steps) {
              const c = s.geometry?.coordinates as [number, number][] | undefined; // FIX
              if (c?.length) coords.push(...c); // FIX
            }
          }
          if (coords.length < 2) {
            return { coordinates: [waypoints[i], waypoints[i + 1]], distanceM: Math.round(leg.distance ?? 0), source: 'straight' };
          }
          return {
            coordinates: coords, // FIX
            distanceM: Math.round(leg.distance ?? 0), // FIX
            source: 'osrm',
          }; // FIX
        }); // FIX

        return {
          segments, // FIX
          totalDistanceM: Math.round(route.distance ?? 0), // FIX
        }; // FIX
      } catch {
        return null; // FIX
      }
    };

    return osrmLimiter.run(async () => {
      const attempts =
        profile === 'foot' || profile === 'walking'
          ? [tryValhallaMulti, tryOsrmMulti]
          : [tryOsrmMulti, tryValhallaMulti];

      for (const attempt of attempts) {
        const result = await attempt();
        if (result) {
          await this.redisJsonSet(cacheKey, result, CACHE_TTL_SEC); // FIX
          this.logger.debug(
            `MultiRoute: ${waypoints.length} waypoints, ${result.totalDistanceM}m total (${profile})`, // FIX
          ); // FIX
          return result; // FIX
        }
      }
      this.logger.warn(
        `MultiRoute failed for ${waypoints.length} waypoints, using straight lines`, // FIX
      ); // FIX
      return straightFallback(); // FIX
    }); // FIX
  }

  // FIX: get OSM buildings in radius via Overpass API
  async getBuildings(
    lat: number,
    lon: number,
    radiusM: number,
  ): Promise<{
    buildings: Array<{ lng: number; lat: number; osmId: number; type: string }>;
    total: number;
    source: string;
  }> {
    // FIX: cache key
    const r = Math.min(radiusM, 2000); // FIX: cap at 2km
    const cacheKey = `map:buildings:${lat.toFixed(4)},${lon.toFixed(4)},${r}`; // FIX
    const cached = await this.redisJsonGet<{
      buildings: Array<{ lng: number; lat: number; osmId: number; type: string }>;
      total: number;
      source: string;
    }>(cacheKey); // FIX
    if (cached) {
      this.logger.debug(`Buildings cache HIT: ${cacheKey} (${cached.total} bldg)`); // FIX
      return cached; // FIX
    }

    // FIX: Overpass query for buildings + residential areas
    const query = `
      [out:json][timeout:20];
      (
        way["building"](around:${r},${lat},${lon});
        node["building"](around:${r},${lat},${lon});
        way["building:use"="residential"](around:${r},${lat},${lon});
        way["landuse"="residential"](around:${r},${lat},${lon});
      );
      out center;
    `; // FIX

    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PermaTrax-GIS/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(22000),
      }); // FIX

      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`); // FIX
      const data = await res.json(); // FIX

      const buildings = (data.elements || [])
        .filter((el: { type?: string; lat?: number; lon?: number; center?: { lat: number; lon: number } }) => {
          // FIX: get center coordinates
          if (el.type === 'node') return el.lat != null && el.lon != null; // FIX
          return el.center != null && el.center.lat != null && el.center.lon != null; // FIX
        })
        .map(
          (el: {
            id: number;
            type?: string;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags?: { building?: string; landuse?: string };
          }) => {
            const latOut = el.lat ?? el.center!.lat; // FIX
            const lonOut = el.lon ?? el.center!.lon; // FIX
            return {
              lng: lonOut,
              lat: latOut,
              osmId: el.id,
              type: el.tags?.building || el.tags?.landuse || 'yes',
            }; // FIX
          },
        ); // FIX

      const result = {
        buildings,
        total: buildings.length,
        source: 'OSM Overpass',
      }; // FIX

      // FIX: cache 30 minutes
      await this.redisJsonSet(cacheKey, result, 1800); // FIX
      this.logger.debug(`Overpass buildings: ${buildings.length} in ${r}m`); // FIX
      return result; // FIX
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err); // FIX
      this.logger.warn(`Overpass failed: ${msg}`); // FIX
      // FIX: return empty — frontend will use synthetic fallback
      return { buildings: [], total: 0, source: 'error' }; // FIX
    }
  }

  // FIX: FTTH network calculation — corrected area/density, IDR, power budget (link margin)
  calculateFtthNetwork(params: {
    targetLat: number; // FIX
    targetLon: number; // FIX
    backboneLat: number; // FIX
    backboneLon: number; // FIX
    areaType: 'URBAN' | 'SUBURBAN' | 'RURAL'; // FIX
    areaRadiusMeters: number; // FIX
    backboneOwner?: string; // FIX
    polygonAreaSqM?: number; // FIX: polygon mode — if provided, use polygon area instead of circle
    polygonCentroidLat?: number; // FIX: optional centroid from drawn polygon (client)
    polygonCentroidLon?: number; // FIX: optional centroid from drawn polygon (client)
    odpPortCapacity?: 8 | 16; // JLM Issue 3A: user-selected ODP port capacity
    poleSpacingMeters?: number; // JLM Issue B: user-configurable pole spacing
  }) {
    const { targetLat, targetLon, backboneLat, backboneLon, areaType, areaRadiusMeters, polygonAreaSqM, odpPortCapacity, poleSpacingMeters } = params; // FIX

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000; // FIX
      const dLat = ((lat2 - lat1) * Math.PI) / 180; // FIX
      const dLon = ((lon2 - lon1) * Math.PI) / 180; // FIX
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2; // FIX
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // FIX
    }; // FIX

    const backboneDistanceM = haversine(targetLat, targetLon, backboneLat, backboneLon); // FIX

    // FIX: use polygon area if provided, otherwise circle
    const areaRadiusKm = areaRadiusMeters / 1000; // FIX
    const areaSqKm = polygonAreaSqM // FIX
      ? polygonAreaSqM / 1_000_000 // FIX: convert m² → km²
      : Math.PI * areaRadiusKm ** 2; // FIX: circle area
    const areaHa = areaSqKm * 100; // FIX

    // FIX: equivalent radius for topology / spoke layout (circle with same area)
    const coverageRadiusMeters = polygonAreaSqM // FIX
      ? Math.round(Math.sqrt(polygonAreaSqM / Math.PI)) // FIX
      : areaRadiusMeters; // FIX

    const areaLabel = polygonAreaSqM // FIX
      ? `area polygon ~${(polygonAreaSqM / 1_000_000).toFixed(3)} km²` // FIX
      : `radius ${areaRadiusMeters}m`; // FIX

    // FIX: realistic density (was too high)
    const densityConfig = {
      URBAN: { hpPerHa: 45, avgDropM: 25, streetFactor: 1.3 }, // FIX
      SUBURBAN: { hpPerHa: 25, avgDropM: 40, streetFactor: 1.5 }, // FIX
      RURAL: { hpPerHa: 8, avgDropM: 60, streetFactor: 1.8 }, // FIX
    }; // FIX
    const dc = densityConfig[areaType]; // FIX
    const estimatedHomepass = Math.round(areaHa * dc.hpPerHa); // FIX
    const activeHomepass = Math.round(estimatedHomepass * 0.7); // FIX

    let areaCategory: 'A' | 'B' | 'C'; // FIX
    let categoryReason: string; // FIX
    if (estimatedHomepass >= 200 && backboneDistanceM <= 500) {
      areaCategory = 'A'; // FIX
      categoryReason =
        'Homepass tinggi (≥200) + backbone dekat (≤500m) — ROI sangat baik'; // FIX
    } else if (estimatedHomepass >= 200 && backboneDistanceM <= 1500) {
      areaCategory = 'A'; // FIX
      categoryReason = 'Homepass tinggi (≥200) — masih layak meski backbone agak jauh'; // FIX
    } else if (estimatedHomepass >= 80) {
      areaCategory = 'B'; // FIX
      categoryReason = 'Homepass sedang (80-199) — ROI moderate, layak dikerjakan'; // FIX
    } else {
      areaCategory = 'C'; // FIX
      categoryReason = 'Homepass rendah (<80) — pertimbangkan fase berikutnya'; // FIX
    }

    const odcCapacity = 144; // FIX: 144-core ODC standard (referensi desain)
    const odcCount = Math.max(1, Math.ceil(estimatedHomepass / 192)); // FIX

    // JLM Issue 3A: honor user-selected port capacity (1:8 / 1:16); else auto-derive
    const odpCapacity =
      odpPortCapacity === 8 || odpPortCapacity === 16
        ? odpPortCapacity
        : backboneDistanceM < 300 ? 8 : 16; // FIX
    const odpCount = Math.max(1, Math.ceil(estimatedHomepass / odpCapacity)); // FIX

    const oltPortsNeeded = Math.ceil(activeHomepass / 64); // FIX
    const oltRecommended = `OLT ${oltPortsNeeded <= 8 ? '8-port' : '16-port'} GPON`; // FIX

    const odpSpacingM = 65; // FIX

    // FIX: realistic feeder with street factor (not crow-fly)
    const feederActualM = backboneDistanceM * dc.streetFactor; // FIX
    const feederCableM = Math.round(feederActualM * 1.15); // FIX

    // FIX: distribution — ODPs placed in ring, follow street
    const distributionCableM = Math.round(odpCount * odpSpacingM * dc.streetFactor * 1.15); // FIX

    // FIX: drop cable
    const avgDropM = dc.avgDropM; // FIX
    const dropCableM = Math.round(estimatedHomepass * dc.avgDropM * 1.15); // FIX

    const totalCableM = feederCableM + distributionCableM + dropCableM; // FIX
    const routeTotalM = Math.round(feederCableM + distributionCableM); // FIX

    let feederCableType: string; // FIX
    let distCableType: string; // FIX
    let dropCableType: string; // FIX
    let installMethod: string; // FIX
    let installReason: string; // FIX

    if (backboneDistanceM < 500) {
      feederCableType = 'G.652D 24-core Aerial Figure-8'; // FIX
      installMethod = 'Aerial (tiang existing)'; // FIX
      installReason = 'Jarak pendek, aerial lebih hemat biaya & cepat'; // FIX
    } else if (backboneDistanceM < 1500) {
      feederCableType = 'G.652D 24-core Armored Underground (HDPE conduit)'; // FIX
      installMethod = 'Underground + Aerial hybrid'; // FIX
      installReason = 'Jarak menengah, underground lebih terlindungi dari gangguan'; // FIX
    } else {
      feederCableType = 'G.652D 48-core OPGW / Underground'; // FIX
      installMethod = 'Underground full (HDPE conduit)'; // FIX
      installReason = 'Jarak jauh (>1.5km), underground wajib untuk keandalan'; // FIX
    }

    distCableType = `G.652D ${odpCapacity === 8 ? '12' : '24'}-core Aerial Figure-8`; // FIX
    dropCableType = 'G.657A2 2-core Drop Cable (bend-insensitive)'; // FIX

    const splitterCount = odpCount; // FIX
    const splitterRatio = `1:${odpCapacity}`; // FIX

    const inlineClosure = Math.ceil(routeTotalM / 500); // FIX
    const odcClosure = odcCount; // FIX
    const totalClosure = inlineClosure + odcClosure; // FIX

    const splicePerClosure = 4; // FIX
    const spliceAtOdc = odcCount * 6; // FIX
    const spliceAtOdp = odpCount * 2; // FIX
    const totalSplice = inlineClosure * splicePerClosure + spliceAtOdc + spliceAtOdp; // FIX

    // JLM Issue B: pole spacing is user-configurable (clamped to a sane range); default 45m
    const poleSpacingM = Math.min(200, Math.max(20, Math.round(poleSpacingMeters ?? 45))); // FIX
    // FIX: realistic pole calculation — 75% existing PLN/Telkom poles
    const EXISTING_POLE_RATIO = 0.75; // FIX
    // JLM Issue B: poles are planned along the whole network (feeder + distribution),
    // not only aerial spans, so the user always gets a pole plan at the chosen interval.
    const aerialRouteM = feederCableM + distributionCableM; // FIX
    const totalPolesNeeded =
      aerialRouteM > 0 ? Math.ceil(aerialRouteM / poleSpacingM) : 0; // FIX
    const existingPolesUsed = Math.round(totalPolesNeeded * EXISTING_POLE_RATIO); // FIX
    const newPolesNeeded = totalPolesNeeded - existingPolesUsed; // FIX

    const connectorCount = estimatedHomepass * 2 + odpCount * odpCapacity; // FIX

    const patchCordCount = estimatedHomepass; // FIX

    const ontCount = activeHomepass; // FIX

    const hdpeConduitM = installMethod.includes('Underground')
      ? Math.round(feederCableM * 1.05)
      : 0; // FIX

    const jointBoxCount = odpCount; // FIX

    const topology = {
      description: `Star-Bus Hybrid FTTH (ITU-T G.984 GPON)`, // FIX
      segments: [
        {
          name: '1. Backbone → OLT', // FIX
          from: `Backbone ${params.backboneOwner || 'Existing'}`, // FIX
          to: 'OLT (Optical Line Terminal)', // FIX
          distance: `${Math.round(feederActualM)}m (est. jalan)`, // FIX
          cable: feederCableType, // FIX
          notes: `Gunakan dark fiber atau bangun sendiri. ${installReason}`, // FIX
        },
        {
          name: '2. OLT → ODC (Feeder)', // FIX
          from: 'OLT', // FIX
          to: `${odcCount}× ODC ${odcCapacity}-core`, // FIX
          distance: `${feederCableM}m (inc. buffer 15%)`, // FIX
          cable: feederCableType, // FIX
          notes: `ODC ditempatkan di titik tengah coverage area`, // FIX
        },
        {
          name: '3. ODC → ODP (Distribution)', // FIX
          from: `${odcCount}× ODC`, // FIX
          to: `${odpCount}× ODP ${odpCapacity}-port`, // FIX
          distance: `${distributionCableM}m total (${odpSpacingM}m/ODP)`, // FIX
          cable: distCableType, // FIX
          notes: `Splitter 1:${odpCapacity} di setiap ODP. Jarak antar ODP ~${odpSpacingM}m`, // FIX
        },
        {
          name: '4. ODP → ONT (Drop)', // FIX
          from: `${odpCount}× ODP`, // FIX
          to: `${estimatedHomepass}× ONT (rumah)`, // FIX
          distance: `${dropCableM}m total (avg ${avgDropM}m/rumah)`, // FIX
          cable: dropCableType, // FIX
          notes: `Kabel drop bend-insensitive untuk instalasi dalam gedung`, // FIX
        },
      ],
      standards: [
        'ITU-T G.984 (GPON) — 2.5 Gbps downstream', // FIX
        'ITU-T G.652D — Single Mode fiber', // FIX
        'SNI 7971:2021 — Instalasi FTTH Indonesia', // FIX
        'Pelcord standard untuk drop cable', // FIX
      ],
    }; // FIX

    const splicingPlan = [
      {
        location: 'Di ODC (tiap ODC)', // FIX
        count: odcCount > 0 ? Math.round(spliceAtOdc / odcCount) : 0, // FIX
        total: spliceAtOdc, // FIX
        notes: 'Fusion splice, proteksi heat-shrink', // FIX
      },
      {
        location: 'Di Closure inline (per 500m)', // FIX
        count: splicePerClosure, // FIX
        total: inlineClosure * splicePerClosure, // FIX
        notes: 'Mechanical atau fusion splice', // FIX
      },
      {
        location: 'Di ODP (tiap ODP)', // FIX
        count: 2, // FIX
        total: spliceAtOdp, // FIX
        notes: 'Entry point kabel distribusi', // FIX
      },
    ]; // FIX

    const installationSequence = [
      {
        step: 1, // FIX
        title: 'Survey & Perencanaan', // FIX
        tasks: [
          'Survey jalur kabel (aerial/underground)', // FIX
          'Mapping tiang existing (PLN/Telkom)', // FIX
          'Pengurusan perizinan ROW (Right of Way)', // FIX
          'Desain As-Built drawing', // FIX
        ],
        duration: '1-2 minggu', // FIX
      },
      {
        step: 2, // FIX
        title: 'Persiapan Infrastruktur', // FIX
        tasks: [
          hdpeConduitM > 0
            ? `Pemasangan HDPE conduit ${hdpeConduitM}m`
            : `Pengecekan ${existingPolesUsed} tiang existing + ${newPolesNeeded} tiang baru (total ${totalPolesNeeded})`, // FIX
          'Persiapan lokasi ODC', // FIX
          'Penandaan jalur distribusi', // FIX
        ],
        duration: '1-2 minggu', // FIX
      },
      {
        step: 3, // FIX
        title: 'Penarikan Kabel Feeder', // FIX
        tasks: [
          `Tarik kabel ${feederCableType}`, // FIX
          `Jarak: ${feederCableM}m`, // FIX
          `Instalasi ${odcCount} ODC`, // FIX
          'Splicing di ODC', // FIX
        ],
        duration: '3-5 hari', // FIX
      },
      {
        step: 4, // FIX
        title: 'Penarikan Kabel Distribusi', // FIX
        tasks: [
          `Instalasi ${odpCount} ODP`, // FIX
          `Tarik kabel distribusi ${distributionCableM}m`, // FIX
          'Splicing + pasang splitter di ODP', // FIX
          `Pasang ${splitterCount} splitter ${splitterRatio}`, // FIX
        ],
        duration: '1-2 minggu', // FIX
      },
      {
        step: 5, // FIX
        title: 'Drop Cable & Aktivasi', // FIX
        tasks: [
          `Tarik drop cable ke ${estimatedHomepass} calon pelanggan`, // FIX
          `Instalasi ${ontCount} ONT`, // FIX
          'OTDR test per jalur', // FIX
          'Aktivasi layanan bertahap', // FIX
        ],
        duration: '2-4 minggu', // FIX
      },
      {
        step: 6, // FIX
        title: 'Testing & Commissioning', // FIX
        tasks: [
          'OTDR measurement (loss < 0.4dB/km)', // FIX
          'Power level test per ONT (≥ -27dBm)', // FIX
          'Speed test per pelanggan', // FIX
          'As-Built documentation', // FIX
        ],
        duration: '3-5 hari', // FIX
      },
    ]; // FIX

    const fiberLossPerKm = 0.35; // FIX
    const connectorLoss = 0.3; // FIX
    const splitterLoss = odpCapacity === 8 ? 10.5 : 13.5; // FIX
    const splicelossPer = 0.1; // FIX

    const feederLoss = (feederActualM / 1000) * fiberLossPerKm; // FIX
    const distLoss = (distributionCableM / 1000 / Math.max(1, odpCount)) * fiberLossPerKm; // FIX
    const dropLoss = (avgDropM / 1000) * fiberLossPerKm; // FIX
    const connLoss = connectorLoss * 4; // FIX
    const spliceLoss = splicelossPer * 6; // FIX
    const totalLoss = feederLoss + distLoss + dropLoss + splitterLoss + connLoss + spliceLoss; // FIX
    const gponBudget = 28; // FIX: referensi budget kelas B+ (model sederhana)
    const powerMargin = gponBudget - totalLoss; // FIX

    // FIX: IDR material cost (harga pasar Indonesia 2024)
    const IDR = {
      feederPerM: areaType === 'URBAN' ? 10000 : 9000, // FIX
      distPerM: 8500, // FIX
      dropPerM: 4000, // FIX
      odpPer: odpCapacity === 8 ? 2000000 : 3000000, // FIX
      odcPer: 20000000, // FIX
      splitterPer: odpCapacity === 8 ? 450000 : 650000, // FIX
      closurePer: 650000, // FIX
      polePer: 2000000, // FIX
      ontPer: 450000, // FIX
      hdpePerM: 20000, // FIX
      installPerM: 35000, // FIX
    }; // FIX

    const costFeederCable = feederCableM * IDR.feederPerM; // FIX
    const costDistCable = distributionCableM * IDR.distPerM; // FIX
    const costDropCable = dropCableM * IDR.dropPerM; // FIX
    const costOdp = odpCount * IDR.odpPer; // FIX
    const costOdc = odcCount * IDR.odcPer; // FIX
    const costSplitter = splitterCount * IDR.splitterPer; // FIX
    const costClosure = totalClosure * IDR.closurePer; // FIX
    const costPole = newPolesNeeded * IDR.polePer; // FIX: hanya tiang baru
    const costOnt = activeHomepass * IDR.ontPer; // FIX
    const costHdpe = hdpeConduitM * IDR.hdpePerM; // FIX
    const costInstall = routeTotalM * IDR.installPerM; // FIX
    const totalMaterialCost =
      costFeederCable +
      costDistCable +
      costDropCable +
      costOdp +
      costOdc +
      costSplitter +
      costClosure +
      costPole +
      costOnt +
      costHdpe; // FIX
    const totalProjectCost = totalMaterialCost + costInstall; // FIX
    const costPerHomepass =
      estimatedHomepass > 0 ? Math.round(totalProjectCost / estimatedHomepass) : 0; // FIX

    // FIX: 3-tier ROI auto-estimate by area type
    const TIER_CONFIG: Record<
      string,
      {
        tiers: Array<{
          name: string; // FIX
          arpu: number; // FIX
          takeRatePct: number; // FIX
          color: string; // FIX
        }>; // FIX
      } // FIX
    > = {
      URBAN: {
        tiers: [
          { name: 'Basic', arpu: 100000, takeRatePct: 20, color: '#3B82F6' }, // FIX
          { name: 'Standard', arpu: 150000, takeRatePct: 50, color: '#00D4B4' }, // FIX
          { name: 'Premium', arpu: 300000, takeRatePct: 15, color: '#8B5CF6' }, // FIX
        ], // FIX
      }, // FIX
      SUBURBAN: {
        tiers: [
          { name: 'Basic', arpu: 100000, takeRatePct: 30, color: '#3B82F6' }, // FIX
          { name: 'Standard', arpu: 150000, takeRatePct: 40, color: '#00D4B4' }, // FIX
          { name: 'Premium', arpu: 300000, takeRatePct: 10, color: '#8B5CF6' }, // FIX
        ], // FIX
      }, // FIX
      RURAL: {
        tiers: [
          { name: 'Basic', arpu: 100000, takeRatePct: 40, color: '#3B82F6' }, // FIX
          { name: 'Standard', arpu: 150000, takeRatePct: 25, color: '#00D4B4' }, // FIX
          { name: 'Premium', arpu: 300000, takeRatePct: 5, color: '#8B5CF6' }, // FIX
        ], // FIX
      }, // FIX
    }; // FIX

    const tierCfg = TIER_CONFIG[areaType] || TIER_CONFIG.URBAN; // FIX
    const tierRoi = tierCfg.tiers.map((tier) => {
      const activeHp = Math.round((estimatedHomepass * tier.takeRatePct) / 100); // FIX
      const monthlyRevenue = activeHp * tier.arpu; // FIX
      const breakEvenMonths = monthlyRevenue > 0 ? Math.ceil(totalProjectCost / monthlyRevenue) : 999; // FIX
      return {
        name: tier.name, // FIX
        arpu: tier.arpu, // FIX
        takeRatePct: tier.takeRatePct, // FIX
        activeHomepass: activeHp, // FIX
        monthlyRevenue, // FIX
        annualRevenue: monthlyRevenue * 12, // FIX
        breakEvenMonths, // FIX
        breakEvenYears: parseFloat((breakEvenMonths / 12).toFixed(1)), // FIX
        color: tier.color, // FIX
        isViable: breakEvenMonths <= 60, // FIX: viable if BEP ≤ 5 years
      }; // FIX
    }); // FIX

    // FIX: total take rate across all tiers
    const totalTakeRatePct = tierCfg.tiers.reduce((sum, t) => sum + t.takeRatePct, 0); // FIX
    const totalActiveHomepass = Math.round((estimatedHomepass * totalTakeRatePct) / 100); // FIX
    const totalMonthlyRevenue = tierRoi.reduce((sum, t) => sum + t.monthlyRevenue, 0); // FIX
    const overallBep = totalMonthlyRevenue > 0 ? Math.ceil(totalProjectCost / totalMonthlyRevenue) : 999; // FIX

    // FIX: completely rewrite recommendations — detailed + actionable
    const recommendations: Array<{
      icon: string; // FIX
      title: string; // FIX
      detail: string; // FIX
      severity: 'info' | 'success' | 'warning' | 'error'; // FIX
    }> = []; // FIX

    if (areaCategory === 'A') {
      recommendations.push({
        icon: '🔴', // FIX
        title: 'Kategori A — Prioritas Tinggi', // FIX
        severity: 'error', // FIX
        detail:
          `${estimatedHomepass} homepass dalam ${areaLabel}. ` + // FIX
          `Backbone terdekat ${Math.round(backboneDistanceM)}m (${params.backboneOwner || 'OSM'}). ` + // FIX
          `ROI sangat baik — mulai konstruksi dalam 30 hari.`, // FIX
      }); // FIX
    } else if (areaCategory === 'B') {
      recommendations.push({
        icon: '🟡', // FIX
        title: 'Kategori B — Prioritas Sedang', // FIX
        severity: 'warning', // FIX
        detail:
          `${estimatedHomepass} homepass dalam ${areaLabel}. ` + // FIX
          `Jadwalkan survey lapangan dalam 3 bulan. ` + // FIX
          `Pertimbangkan subsidi ODP untuk meningkatkan take rate.`, // FIX
      }); // FIX
    } else {
      recommendations.push({
        icon: '🟢', // FIX
        title: 'Kategori C — Prioritas Rendah', // FIX
        severity: 'success', // FIX
        detail:
          `${estimatedHomepass} homepass, density rendah untuk ${areaType}. ` + // FIX
          `Tunggu fase A & B selesai. ` + // FIX
          `Pertimbangkan teknologi alternatif (Fixed Wireless/FTTC).`, // FIX
      }); // FIX
    }

    if (powerMargin >= 6) {
      recommendations.push({
        icon: '✅', // FIX
        title: `Cadangan Daya Sangat Baik (${powerMargin.toFixed(1)} dB)`, // FIX
        severity: 'success', // FIX
        detail:
          `Budget optik aman dengan margin ${powerMargin.toFixed(1)} dB ` + // FIX
          `(standar minimum 3 dB). Bisa upgrade ke splitter ${odpCapacity === 8 ? '1:16' : '1:32'} ` + // FIX
          `jika homepass bertambah. Total loss ${totalLoss.toFixed(1)} dB dari budget 28 dB.`, // FIX
      }); // FIX
    } else if (powerMargin >= 3) {
      recommendations.push({
        icon: '⚠️', // FIX
        title: `Cadangan Daya Cukup (${powerMargin.toFixed(1)} dB)`, // FIX
        severity: 'warning', // FIX
        detail:
          `Margin ${powerMargin.toFixed(1)} dB memenuhi standar minimum (3 dB) tapi tipis. ` + // FIX
          `Gunakan konektor grade A (loss < 0.3 dB). ` + // FIX
          `Hindari tambahan splice di tengah rute. ` + // FIX
          `Lakukan OTDR test sebelum aktivasi.`, // FIX
      }); // FIX
    } else {
      recommendations.push({
        icon: '🔴', // FIX
        title: `Cadangan Daya Tidak Cukup (${powerMargin.toFixed(1)} dB)`, // FIX
        severity: 'error', // FIX
        detail:
          `Margin ${powerMargin.toFixed(1)} dB di bawah minimum 3 dB. ` + // FIX
          `Solusi: (1) Upgrade ke GPON Class C+ (32 dBm), ` + // FIX
          `(2) Kurangi split ratio dari 1:${odpCapacity} ke 1:${Math.max(2, Math.floor(odpCapacity / 2))}, ` + // FIX
          `(3) Pindahkan ODC lebih dekat ke area target.`, // FIX
      }); // FIX
    }

    recommendations.push({
      icon: '📐', // FIX
      title: `Kabel: ${feederCableType.split(' ').slice(0, 3).join(' ')}`, // FIX
      severity: 'info', // FIX
      detail:
        `Feeder ${Math.round(feederCableM)}m (${feederCableType}). ` + // FIX
        `Distribusi ${Math.round(distributionCableM)}m (${distCableType}). ` + // FIX
        `Drop ${Math.round(dropCableM)}m (${dropCableType}). ` + // FIX
        `Total dengan buffer 15%: ${(totalCableM / 1000).toFixed(2)} km.`, // FIX
    }); // FIX

    recommendations.push({
      icon: '🏗️', // FIX
      title: `Metode: ${installMethod}`, // FIX
      severity: 'info', // FIX
      detail:
        installReason +
        '. ' + // FIX
        (installMethod.includes('Aerial') || installMethod.includes('aerial')
          ? `Survey tiang PLN/Telkom existing sepanjang ${Math.round(aerialRouteM)}m rute. ` + // FIX
            `Estimasi ${existingPolesUsed} tiang existing bisa digunakan, ` + // FIX
            `perlu bangun ${newPolesNeeded} tiang baru. ` + // FIX
            `Koordinasi dengan PLN/Telkom untuk izin penggunaan tiang.`
          : `Perlu galian ${Math.round(feederCableM)}m untuk HDPE conduit 32mm. ` + // FIX
            `Estimasi kedalaman galian 60-80cm. ` + // FIX
            `Koordinasi dengan Dinas PUPR untuk izin galian.`), // FIX
    }); // FIX

    if (totalPolesNeeded > 0) {
      recommendations.push({
        icon: '🪝', // FIX
        title: `${newPolesNeeded} Tiang Baru + ${existingPolesUsed} Existing`, // FIX
        severity: newPolesNeeded > 50 ? 'warning' : 'info', // FIX
        detail:
          `Total ${totalPolesNeeded} tiang dibutuhkan sepanjang ${Math.round(aerialRouteM)}m rute aerial. ` + // FIX
          `Estimasi 75% (${existingPolesUsed} tiang) menggunakan existing PLN/Telkom. ` + // FIX
          `Perlu bangun ${newPolesNeeded} tiang baru, jarak antar tiang ${poleSpacingM}m. ` + // FIX
          `Biaya tiang baru ≈ Rp ${(newPolesNeeded * 2000000).toLocaleString('id-ID')}.`, // FIX
      }); // FIX
    }

    recommendations.push({
      icon: '🏠', // FIX
      title: `${activeHomepass} dari ${estimatedHomepass} Homepass Aktif (70%)`, // FIX
      severity: 'info', // FIX
      detail:
        `Estimasi ${estimatedHomepass} total homepass dalam ${areaLabel} ` + // FIX
        `(density ${dc.hpPerHa} HP/ha, area ${areaHa.toFixed(1)} ha). ` + // FIX
        `Take rate 70% = ${activeHomepass} pelanggan aktif. ` + // FIX
        `Untuk meningkatkan take rate: promo 3 bulan gratis, door-to-door canvassing, ` + // FIX
        `bundle TV+Internet.`, // FIX
    }); // FIX

    recommendations.push({
      icon: '📦', // FIX
      title: `${odpCount} ODP ${odpCapacity}-port (spacing ~${odpSpacingM}m)`, // FIX
      severity: 'info', // FIX
      detail:
        `Setiap ODP melayani max ${odpCapacity} pelanggan dalam radius ~50m. ` + // FIX
        `Pasang ODP di tiang atau dinding bangunan di pinggir jalan utama. ` + // FIX
        `Gunakan ODP weatherproof IP65+ untuk outdoor. ` + // FIX
        `Jarak ODC ke ODP terjauh ≈ ${Math.round((odpCount * odpSpacingM) / 2)}m.`, // FIX
    }); // FIX

    const bep = overallBep; // FIX: overall BEP from 3-tier stacked revenue
    recommendations.push({
      icon: '📈', // FIX
      title: `BEP Overall ~${bep} Bulan (3-tier ARPU stack)`, // FIX
      severity: bep <= 36 ? 'success' : bep <= 60 ? 'warning' : 'error', // FIX
      detail:
        `Total investasi Rp ${(totalProjectCost / 1e6).toFixed(0)}M. ` + // FIX
        `Revenue bulanan gabungan Rp ${(totalMonthlyRevenue / 1e6).toFixed(1)}M ` + // FIX
        `(${totalTakeRatePct}% take rate stack). ` + // FIX
        `BEP ${bep} bulan (${(bep / 12).toFixed(1)} tahun). ` + // FIX
        (bep <= 36
          ? 'Investasi sangat layak — ROI di bawah 3 tahun.'
          : bep <= 60
            ? 'Investasi layak — pertimbangkan subsidi untuk percepat BEP.'
            : 'Investasi berisiko — evaluasi ulang strategi pricing atau area.'), // FIX
    }); // FIX

    recommendations.push({
      icon: '📋', // FIX
      title: 'Langkah Selanjutnya', // FIX
      severity: 'info', // FIX
      detail:
        `1. Survey lapangan: verifikasi tiang & jalur kabel (1 minggu). ` + // FIX
        `2. Perizinan: ROW, galian, tiang PLN/Telkom (2-4 minggu). ` + // FIX
        `3. Procurement: material sesuai BoM di atas (2-3 minggu). ` + // FIX
        `4. Konstruksi feeder & distribusi (${areaCategory === 'A' ? '3-4' : '4-6'} minggu). ` + // FIX
        `5. Drop cable & aktivasi bertahap (2-4 minggu). ` + // FIX
        `6. OTDR commissioning & go-live.`, // FIX
    }); // FIX

    if (backboneDistanceM > 2000) {
      recommendations.push({
        icon: '⚠️', // FIX
        title: `Backbone jauh (${Math.round(backboneDistanceM)}m)`, // FIX
        severity: 'warning', // FIX
        detail:
          `Pertimbangkan OLT mini atau remote OLT untuk memperpendek jalur feeder dan menjaga link margin.`, // FIX
      }); // FIX
    }

    // FIX: FTTH topology auto-selector
    // Picks best physical topology based on geospatial params
    type FtthTopology = {
      type: string; // FIX
      label: string; // FIX
      description: string; // FIX
      pros: string[]; // FIX
      cons: string[]; // FIX
      suitability: number; // FIX: 0-100
    }; // FIX

    let selectedTopology: FtthTopology; // FIX

    if (estimatedHomepass <= 50 && backboneDistanceM <= 500) {
      // FIX: Home Run / Star — small area, few HP, short distance
      selectedTopology = {
        type: 'HOME_RUN',
        label: 'Home Run (Star)',
        description:
          'Satu fiber dedicated per pelanggan dari ODC ke ONT. ' + 'Tidak ada splitter passif.',
        pros: [
          'Bandwidth penuh per pelanggan (tidak shared)',
          'Troubleshooting mudah — 1 fiber = 1 pelanggan',
          'Link margin sangat baik',
          'Cocok untuk area kecil padat',
        ],
        cons: ['Biaya kabel lebih tinggi', 'Kapasitas ODC lebih besar dibutuhkan'],
        suitability: 90,
      }; // FIX
    } else if (estimatedHomepass > 500 || odcCount >= 2) {
      // FIX: Hybrid (Tree + Ring backbone) — large area, multiple ODC
      selectedTopology = {
        type: 'HYBRID_TREE_RING',
        label: 'Hybrid (Tree + Ring Backbone)',
        description:
          'Ring fiber backbone antar ODC untuk redundansi, ' + 'dengan PON tree distribusi ke pelanggan.',
        pros: [
          'Backbone ring — jika satu jalur putus, traffic dialihkan',
          'Scalable untuk ribuan pelanggan',
          'Proteksi 50ms automatic failover',
          'Standar operator tier-1 Indonesia',
        ],
        cons: [
          'Biaya lebih tinggi (ring backbone)',
          'Konfigurasi dan monitoring lebih kompleks',
          'Butuh OLT dengan fitur ring protection',
        ],
        suitability: 85,
      }; // FIX
    } else if (areaType === 'RURAL' || (estimatedHomepass < 80 && backboneDistanceM > 1500)) {
      // FIX: Bus/Chain — rural scattered, long distance
      selectedTopology = {
        type: 'BUS_CHAIN',
        label: 'Bus / Chain (P2P)',
        description:
          'Kabel utama memanjang mengikuti jalan desa, ' + 'dengan tap-off ke setiap pelanggan.',
        pros: [
          'Hemat kabel — satu jalur utama',
          'Cocok untuk area linear (jalan desa panjang)',
          'Biaya instalasi lebih rendah',
          'Simple dan mudah dipahami teknisi',
        ],
        cons: [
          'Jika kabel utama putus, semua pelanggan terdampak',
          'Bandwidth shared di sepanjang kabel',
          'Tidak ideal untuk area padat',
        ],
        suitability: 70,
      }; // FIX
    } else {
      // FIX: Default — PON Tree (GPON) — most common FTTH
      selectedTopology = {
        type: 'PON_TREE',
        label: 'PON Tree (GPON)',
        description:
          'Topologi pohon pasif: OLT → ODC → ODP (splitter) → ONT. ' +
          'Standar FTTH paling umum di Indonesia.',
        pros: [
          'Biaya paling efisien untuk 50-500 homepass',
          'Satu OLT port melayani hingga 128 ONT (GPON)',
          'Tidak ada active device antara OLT dan ONT',
          'Standar ITU-T G.984, didukung semua vendor',
          'Mudah di-scale dengan tambah ODP',
        ],
        cons: [
          'Bandwidth shared per PON port (2.5 Gbps / N pelanggan)',
          'Jika ODC bermasalah, semua ODP terdampak',
          'Link budget terbatas oleh splitter loss',
        ],
        suitability: 95,
      }; // FIX
    }

    const topologyReason = // FIX
      `Auto: ${selectedTopology.label} (${selectedTopology.type}). ` +
      `Kriteria: ~${estimatedHomepass} HP, ${odcCount} ODC, backbone ~${Math.round(backboneDistanceM)}m, ` +
      `area ${areaType}. Kesesuaian ${selectedTopology.suitability}/100.`; // FIX

    return {
      summary: {
        areaCategory, // FIX
        categoryReason, // FIX
        backboneDistanceM: Math.round(backboneDistanceM), // FIX
        backboneOwner: params.backboneOwner || 'OSM Data', // FIX
        areaType, // FIX
        areaRadiusMeters, // FIX
        coverageRadiusMeters, // FIX: for topology / spoke length (polygon → equiv. radius)
        polygonAreaSqM: polygonAreaSqM ?? undefined, // FIX
        polygonCentroidLat: params.polygonCentroidLat, // FIX
        polygonCentroidLon: params.polygonCentroidLon, // FIX
      },
      homepass: {
        estimated: estimatedHomepass, // FIX
        active: activeHomepass, // FIX
        takeRatePercent: totalTakeRatePct, // FIX: total tier take-rate stack
      },
      route: {
        totalM: routeTotalM, // FIX
        feederM: feederCableM, // FIX
        distributionM: distributionCableM, // FIX
      },
      cable: {
        totalM: totalCableM, // FIX
        feederCableType, // FIX
        distCableType, // FIX
        dropCableType, // FIX
        installMethod, // FIX
        installReason, // FIX
        breakdown: {
          feederM: feederCableM, // FIX
          distributionM: distributionCableM, // FIX
          dropM: dropCableM, // FIX
          bufferPercent: 15, // FIX
        },
      },
      equipment: {
        olt: {
          recommendation: oltRecommended, // FIX
          portsNeeded: oltPortsNeeded, // FIX
          standard: 'GPON ITU-T G.984', // FIX
        },
        odc: {
          count: odcCount, // FIX
          capacity: `${odcCapacity}-core`, // FIX
          unit: 'unit', // FIX
        },
        odp: {
          count: odpCount, // FIX
          capacity: odpCapacity, // FIX
          spacingM: odpSpacingM, // FIX
          unit: 'unit', // FIX
        },
        splitter: {
          count: splitterCount, // FIX
          ratio: splitterRatio, // FIX
          unit: 'unit', // FIX
        },
        closure: {
          inline: inlineClosure, // FIX
          total: totalClosure, // FIX
          unit: 'unit', // FIX
        },
        pole: {
          total: totalPolesNeeded, // FIX
          existing: existingPolesUsed, // FIX: dari PLN/Telkom
          newBuild: newPolesNeeded, // FIX: perlu dibangun baru
          spacingM: poleSpacingM, // FIX
          unit: 'unit', // FIX
          note:
            totalPolesNeeded > 0
              ? `${newPolesNeeded} tiang baru + ${existingPolesUsed} tiang existing PLN/Telkom`
              : 'Underground — tidak perlu tiang', // FIX
        },
        splice: {
          total: totalSplice, // FIX
          plan: splicingPlan, // FIX
          unit: 'titik', // FIX
        },
        connector: {
          count: connectorCount, // FIX
          type: 'SC/APC', // FIX
          unit: 'unit', // FIX
        },
        patchCord: {
          count: patchCordCount, // FIX
          type: 'SC/APC - SC/APC 1m', // FIX
          unit: 'unit', // FIX
        },
        ont: {
          count: ontCount, // FIX
          type: 'GPON ONT (customer premise)', // FIX
          unit: 'unit', // FIX
        },
        jointBox: {
          count: jointBoxCount, // FIX
          unit: 'unit', // FIX
        },
        hdpeConduit: {
          meters: hdpeConduitM, // FIX
          type: hdpeConduitM > 0 ? 'HDPE 32mm' : 'N/A', // FIX
          unit: 'meter', // FIX
        },
      },
      topology: {
        // FIX: keep existing topology segments + auto-selected topology
        ...topology,
        selected: selectedTopology,
      },
      topologyType: selectedTopology.type, // FIX
      topologyReason, // FIX
      powerBudget: {
        gponClass: 'GPON Class B+ (28 dBm)', // FIX
        linkMarginDB: parseFloat(powerMargin.toFixed(2)), // FIX: renamed
        isOk: powerMargin >= 3, // FIX
        totalLossDB: parseFloat(totalLoss.toFixed(2)), // FIX
        breakdown: {
          splitterDB: splitterLoss, // FIX
          seratFeederDB: parseFloat(feederLoss.toFixed(2)), // FIX
          konektorDB: parseFloat(connLoss.toFixed(2)), // FIX
          sambunganDB: parseFloat(spliceLoss.toFixed(2)), // FIX
          seratDistDB: parseFloat(distLoss.toFixed(2)), // FIX
          seratDropDB: parseFloat(dropLoss.toFixed(2)), // FIX
        },
      },
      // FIX: enhanced ROI with 3 tiers
      roi: {
        tiers: tierRoi, // FIX
        totalTakeRatePct, // FIX
        totalActiveHomepass, // FIX
        totalMonthlyRevenue, // FIX
        totalAnnualRevenue: totalMonthlyRevenue * 12, // FIX
        overallBepMonths: overallBep, // FIX
        overallBepYears: parseFloat((overallBep / 12).toFixed(1)), // FIX
        currency: 'IDR', // FIX
      },
      costEstimation: {
        currency: 'IDR', // FIX
        note: 'Estimasi harga pasar 2024, belum termasuk PPN & overhead', // FIX
        breakdown: [
          { item: 'Kabel Feeder', qty: `${feederCableM}m`, idr: costFeederCable }, // FIX
          { item: 'Kabel Distribusi', qty: `${distributionCableM}m`, idr: costDistCable }, // FIX
          { item: 'Kabel Drop', qty: `${dropCableM}m`, idr: costDropCable }, // FIX
          { item: `ODP ${odpCapacity}P`, qty: `${odpCount} unit`, idr: costOdp }, // FIX
          { item: 'ODC', qty: `${odcCount} unit`, idr: costOdc }, // FIX
          { item: 'Splitter', qty: `${splitterCount} unit`, idr: costSplitter }, // FIX
          { item: 'Closure', qty: `${totalClosure} unit`, idr: costClosure }, // FIX
          ...(totalPolesNeeded > 0
            ? [{ item: 'Tiang (baru)', qty: `${newPolesNeeded} unit`, idr: costPole }] // FIX
            : []),
          ...(hdpeConduitM > 0
            ? [{ item: 'HDPE Conduit', qty: `${hdpeConduitM}m`, idr: costHdpe }] // FIX
            : []),
          { item: 'ONT/CPE', qty: `${activeHomepass} unit`, idr: costOnt }, // FIX
          { item: 'Jasa Instalasi', qty: `${routeTotalM}m`, idr: costInstall }, // FIX
        ],
        totalMaterial: totalMaterialCost, // FIX
        totalInstall: costInstall, // FIX
        totalProject: totalProjectCost, // FIX
        costPerHomepass, // FIX
        roi: {
          revenuePerHpPerMonth: tierRoi[1]?.arpu || 150000, // FIX: Standard tier
          monthlyRevenue: totalMonthlyRevenue, // FIX
          breakEvenMonths: overallBep, // FIX
          tiers: tierRoi, // FIX: add tiers to costEstimation.roi too
        },
      },
      installation: {
        method: installMethod, // FIX
        totalDuration: '5-8 minggu', // FIX
        sequence: installationSequence, // FIX
      },
      recommendations, // FIX: Array<{ icon, title, detail, severity }>
    }; // FIX
  }
}
