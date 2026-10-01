/**
 * Routing candidates for FTTT. Straight-line geometry is never returned:
 * a cable route must come from a road/foot router.
 */

import {
  classifyRoadKind,
  type LngLat,
  type RouteStep,
  type WaterSegment,
} from './fttt-gis.calc';

export type RawFtttRoute = {
  coordinates: LngLat[];
  steps: RouteStep[];
  profile: 'driving' | 'foot';
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function asCoord(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

export function parseOsrmRoutes(payload: unknown, profile: 'driving' | 'foot'): RawFtttRoute[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as {
    code?: string;
    routes?: Array<{
      geometry?: { coordinates?: unknown[] };
      legs?: Array<{ steps?: Array<{ name?: string; ref?: string; distance?: number }> }>;
    }>;
  };
  if (data.code !== 'Ok' || !Array.isArray(data.routes)) return [];
  const out: RawFtttRoute[] = [];
  for (const route of data.routes) {
    const coordinates = (route.geometry?.coordinates ?? [])
      .map((coord) => asCoord(coord))
      .filter((coord): coord is LngLat => coord != null);
    if (coordinates.length < 2) continue;
    const steps: RouteStep[] = [];
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        steps.push({
          name: typeof step.name === 'string' ? step.name : undefined,
          ref: typeof step.ref === 'string' ? step.ref : undefined,
          distance: typeof step.distance === 'number' ? step.distance : undefined,
        });
      }
    }
    out.push({ coordinates, steps, profile });
  }
  return out;
}

export function parseOverpassWaterways(payload: unknown): WaterSegment[] {
  if (!payload || typeof payload !== 'object') return [];
  const elements = (payload as { elements?: unknown[] }).elements;
  if (!Array.isArray(elements)) return [];
  const segments: WaterSegment[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const geometry = (element as { geometry?: Array<{ lon?: number; lat?: number }> }).geometry;
    if (!Array.isArray(geometry)) continue;
    const line: LngLat[] = [];
    for (const point of geometry) {
      if (typeof point.lon !== 'number' || typeof point.lat !== 'number') continue;
      line.push([point.lon, point.lat]);
    }
    for (let i = 1; i < line.length; i++) segments.push([line[i - 1], line[i]]);
    if (segments.length > 4_000) break;
  }
  return segments;
}

async function fetchOsrm(
  fetchImpl: FetchLike,
  baseUrl: string,
  profilePath: string,
  profile: 'driving' | 'foot',
  start: LngLat,
  end: LngLat,
): Promise<RawFtttRoute[]> {
  const coord = `${start[0]},${start[1]};${end[0]},${end[1]}`;
  const url =
    `${baseUrl}/route/v1/${profilePath}/${coord}` +
    '?overview=full&geometries=geojson&steps=true&alternatives=2';
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'PermaTrax-GIS/1.0' },
  });
  if (!res.ok) return [];
  return parseOsrmRoutes(await res.json(), profile);
}

export async function fetchFtttRouteCandidates(
  fetchImpl: FetchLike,
  start: LngLat,
  end: LngLat,
): Promise<RawFtttRoute[]> {
  const jobs: Array<Promise<RawFtttRoute[]>> = [
    fetchOsrm(fetchImpl, 'https://router.project-osrm.org', 'driving', 'driving', start, end).catch(() => []),
    fetchOsrm(fetchImpl, 'https://routing.openstreetmap.de/routed-foot', 'foot', 'foot', start, end).catch(() => []),
  ];
  const batches = await Promise.all(jobs);
  return batches.flat();
}

export async function fetchWaterwaySegments(
  fetchImpl: FetchLike,
  west: number,
  south: number,
  east: number,
  north: number,
): Promise<{ segments: WaterSegment[]; available: boolean }> {
  const query = `
    [out:json][timeout:12];
    (
      way["natural"="water"](${south},${west},${north},${east});
      way["waterway"~"river|canal|stream"](${south},${west},${north},${east});
    );
    out geom;
  `;
  const mirrors = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (const mirror of mirrors) {
    try {
      const res = await fetchImpl(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'PermaTrax-GIS/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(14000),
      });
      if (!res.ok) continue;
      return { segments: parseOverpassWaterways(await res.json()), available: true };
    } catch {
      /* try next mirror */
    }
  }
  return { segments: [], available: false };
}

export function classifyRawRoutes(
  raw: RawFtttRoute[],
): Array<RawFtttRoute & { kind: ReturnType<typeof classifyRoadKind> }> {
  return raw.map((route) => ({
    ...route,
    kind: classifyRoadKind(route.steps, route.profile),
  }));
}
