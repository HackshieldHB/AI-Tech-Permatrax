import type { MutableRefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import { toast } from 'sonner';
import { API_BASE } from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';
import { useDesignStore } from '../../../store/useDesignStore';
import { extractHomepassPoints } from '../utils/geojsonMapper';
import type { FtthCalcApiResponse, TopoExportData } from './types';

export type LastRenderedGeometry = {
  oltCoords: [number, number];
  odcCoords: [number, number];
  odpPositions: [number, number][];
  feederCoords: [number, number][];
  distRoutes: [number, number][][];
} | null;

// ── Topology layer ids (verbatim from page.tsx) ───────────────────────────────
// FIX: complete cleanup including tiang, backbone, closure
const TOPO_SOURCE_IDS = [
  'topo-feeder', // FIX
  'topo-distribution', // FIX
  'topo-drop', // FIX
  'topo-homepass', // FIX
  'topo-closure', // FIX: ensure included
  'topo-odc', // FIX
  'topo-odp', // FIX
  'topo-backbone', // FIX: ensure included
  'topo-tiang', // FIX: ensure included
] as const; // FIX

// FIX: layer list — all topology layers for safe removal
const TOPO_LAYER_IDS = [
  'topo-feeder-line', // FIX
  'topo-dist-line', // FIX
  'topo-dist-line-straight', // GIS Issue 4: dashed fallback overlay
  'topo-drop-line', // FIX
  'topo-homepass-circle', // FIX: reserved id if used
  'topo-homepass-label', // FIX: restore stored homepass labels
  'topo-ont-circle', // FIX
  'topo-ont-label', // FIX
  'topo-closure-circle', // FIX: ensure included
  'topo-tiang-circle', // FIX: ensure included
  'topo-tiang-label', // FIX: ensure included
  'topo-backbone-circle', // FIX: ensure included
  'topo-backbone-label', // FIX: ensure included
  'topo-odc-circle', // FIX
  'topo-odc-label', // FIX
  'topo-odp-circle', // FIX
  'topo-odp-label', // FIX
] as const; // FIX

// ── Topology helpers colocated here (omit getAllCoordinates → useKmzLayers) ──
// FIX: haversine distance in meters
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // FIX
  const dLat = ((lat2 - lat1) * Math.PI) / 180; // FIX
  const dLon = ((lon2 - lon1) * Math.PI) / 180; // FIX
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2; // FIX
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // FIX
}

// FIX: route via backend proxy (OSRM + Valhalla + cache)
async function backendRoute(
  apiBase: string, // FIX
  token: string, // FIX
  fromLng: number, // FIX
  fromLat: number, // FIX
  toLng: number, // FIX
  toLat: number, // FIX
): Promise<{ coordinates: [number, number][]; distanceM: number; source?: string }> {
  try {
    const res = await fetch(`${apiBase}/map/route`, {
      method: 'POST', // FIX
      headers: {
        'Content-Type': 'application/json', // FIX
        Authorization: `Bearer ${token}`, // FIX
        'ngrok-skip-browser-warning': 'true', // FIX
      }, // FIX
      // GIS Issue 9: kabel tidak mengikuti aturan arah lalu lintas — profil
      // 'foot' membuat routing mengabaikan one-way (Valhalla pedestrian)
      body: JSON.stringify({ fromLng, fromLat, toLng, toLat, profile: 'foot' }), // FIX
      signal: AbortSignal.timeout(12000), // FIX
    }); // FIX
    if (!res.ok) throw new Error(`route HTTP ${res.status}`); // FIX
    return await res.json(); // FIX
  } catch {
    // FIX: straight line fallback if backend unreachable
    return {
      coordinates: [
        [fromLng, fromLat],
        [toLng, toLat],
      ], // FIX
      distanceM: Math.round(haversineM(fromLat, fromLng, toLat, toLng) * 1.4), // FIX
      source: 'straight', // GIS Issue 4: tandai fallback garis lurus
    }; // FIX
  }
}

// FIX: batch route via backend — 1 OSRM call for multi-waypoint leg
async function backendMultiRoute(
  apiBase: string, // FIX
  token: string, // FIX
  waypoints: Array<[number, number]>, // FIX
): Promise<Array<{ coordinates: [number, number][]; distanceM: number }>> {
  try {
    const res = await fetch(`${apiBase}/map/multi-route`, {
      method: 'POST', // FIX
      headers: {
        'Content-Type': 'application/json', // FIX
        Authorization: `Bearer ${token}`, // FIX
        'ngrok-skip-browser-warning': 'true', // FIX
      }, // FIX
      // GIS Issue 9: profil 'foot' — kabel mengabaikan arah lalu lintas
      body: JSON.stringify({ waypoints, profile: 'foot' }), // FIX
      signal: AbortSignal.timeout(15000), // FIX
    }); // FIX
    if (!res.ok) throw new Error(`multi-route HTTP ${res.status}`); // FIX
    const data = await res.json(); // FIX
    return data.segments || []; // FIX
  } catch {
    return waypoints.slice(0, -1).map((wp, i) => ({
      coordinates: [wp, waypoints[i + 1]] as [number, number][], // FIX
      distanceM: Math.round(
        haversineM(wp[1], wp[0], waypoints[i + 1][1], waypoints[i + 1][0]) * 1.4, // FIX
      ), // FIX
    })); // FIX
  }
}

// FIX: snap point to road via backend proxy
async function backendSnap(
  apiBase: string, // FIX
  token: string, // FIX
  lng: number, // FIX
  lat: number, // FIX
): Promise<[number, number]> {
  try {
    const res = await fetch(`${apiBase}/map/snap`, {
      method: 'POST', // FIX
      headers: {
        'Content-Type': 'application/json', // FIX
        Authorization: `Bearer ${token}`, // FIX
        'ngrok-skip-browser-warning': 'true', // FIX
      }, // FIX
      body: JSON.stringify({ lng, lat }), // FIX
      signal: AbortSignal.timeout(5000), // FIX
    }); // FIX
    if (!res.ok) throw new Error(`snap HTTP ${res.status}`); // FIX
    const data = await res.json(); // FIX
    return Array.isArray(data) ? (data as [number, number]) : [lng, lat]; // FIX
  } catch {
    return [lng, lat]; // FIX: return original if snap fails
  }
}

// FIX: get OSM buildings via backend proxy
async function backendBuildings(
  apiBase: string, // FIX
  token: string, // FIX
  lat: number, // FIX
  lon: number, // FIX
  radiusM: number, // FIX
): Promise<Array<{ lng: number; lat: number; osmId: number; type: string }>> {
  try {
    const res = await fetch(
      `${apiBase}/map/buildings?lat=${lat}&lon=${lon}&radius=${Math.min(radiusM, 2000)}`, // FIX
      {
        headers: {
          Authorization: `Bearer ${token}`, // FIX
          'ngrok-skip-browser-warning': 'true', // FIX
        }, // FIX
        signal: AbortSignal.timeout(25000), // FIX
      },
    ); // FIX
    if (!res.ok) throw new Error(`buildings HTTP ${res.status}`); // FIX
    const data = await res.json(); // FIX
    return data.buildings || []; // FIX
  } catch {
    return []; // FIX: empty — fallback to synthetic
  }
}

// FIX: place ODPs along a road route geometry
function placeOdpsAlongRoute(
  routeCoords: [number, number][], // FIX
  odpCount: number, // FIX
  spacingM: number, // FIX
): [number, number][] {
  if (!routeCoords || routeCoords.length < 2) return []; // FIX

  // FIX: compute cumulative distance along route
  const cumDist: number[] = [0]; // FIX
  for (let i = 1; i < routeCoords.length; i++) {
    const [lng1, lat1] = routeCoords[i - 1]; // FIX
    const [lng2, lat2] = routeCoords[i]; // FIX
    cumDist.push(cumDist[i - 1] + haversineM(lat1, lng1, lat2, lng2)); // FIX
  }
  const totalRouteM = cumDist[cumDist.length - 1]; // FIX

  // FIX: place ODP at every spacingM along the route
  const positions: [number, number][] = []; // FIX
  let placedAt = spacingM; // FIX: first ODP at spacingM from ODC

  while (positions.length < odpCount && placedAt <= totalRouteM) {
    // FIX: find which segment this distance falls in
    let segIdx = Math.max(0, cumDist.length - 2); // FIX
    for (let i = 1; i < cumDist.length; i++) {
      if (cumDist[i] >= placedAt) {
        segIdx = i - 1; // FIX
        break; // FIX
      }
    }
    // FIX: interpolate position within segment
    const segStart = cumDist[segIdx]; // FIX
    const segEnd = cumDist[segIdx + 1] ?? cumDist[segIdx]; // FIX
    const segLen = segEnd - segStart; // FIX
    const ratio = segLen > 0 ? (placedAt - segStart) / segLen : 0; // FIX
    const [lng1, lat1] = routeCoords[segIdx]; // FIX
    const [lng2, lat2] = routeCoords[segIdx + 1] ?? routeCoords[segIdx]; // FIX
    positions.push([lng1 + (lng2 - lng1) * ratio, lat1 + (lat2 - lat1) * ratio]); // FIX
    placedAt += spacingM; // FIX
  }

  // JLM Issue 4: do NOT pad with duplicate endpoints (caused stacked ODPs).
  // Short routes simply contribute fewer candidates; caller pads via other directions.
  return positions.slice(0, odpCount); // FIX
}

// FIX: generate ODP positions along road network
// FIX: Uses a ring/chain pattern: ODC → road segments → back
// FIX: Much more realistic than radial spokes
async function computeOdpAlongRoads(
  apiBase: string, // FIX
  token: string, // FIX
  odcLng: number, // FIX
  odcLat: number, // FIX
  odpCount: number, // FIX
  spacingM: number, // FIX
  radiusM: number, // FIX
): Promise<{
  positions: [number, number][]; // FIX
  routes: [number, number][][]; // FIX
}> {
  // FIX: also add diagonal routes for better coverage
  const ALL_DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
    const rad = (angle * Math.PI) / 180; // FIX
    const dLat = ((radiusM * 0.85) / 6371000) * (180 / Math.PI) * Math.cos(rad); // FIX
    const dLng =
      ((radiusM * 0.85) / 6371000) *
      (180 / Math.PI) *
      (Math.sin(rad) / Math.cos((odcLat * Math.PI) / 180)); // FIX
    return {
      angle, // FIX
      edgeLng: odcLng + dLng, // FIX
      edgeLat: odcLat + dLat, // FIX
    }; // FIX
  }); // FIX

  // JLM Issue 4: sample evenly around the compass (not a contiguous 0°–135° sector)
  const numDirections = Math.min(8, Math.max(4, Math.ceil(odpCount / 3))); // FIX
  const step = ALL_DIRECTIONS.length / numDirections;
  const selectedDirs = Array.from({ length: numDirections }, (_, i) => {
    const idx = Math.min(ALL_DIRECTIONS.length - 1, Math.round(i * step) % ALL_DIRECTIONS.length);
    return ALL_DIRECTIONS[idx];
  });

  const routeResults = await Promise.allSettled(
    selectedDirs.map((d) => backendRoute(apiBase, token, odcLng, odcLat, d.edgeLng, d.edgeLat)), // FIX
  ); // FIX

  // FIX: place ODPs along each route at spacingM intervals
  const allPositions: [number, number][] = []; // FIX
  const allRoutes: [number, number][][] = []; // FIX
  const odpsPerDir = Math.ceil(odpCount / numDirections); // FIX

  routeResults.forEach((result, i) => {
    if (result.status !== 'fulfilled' || !result.value?.coordinates?.length) {
      // FIX: fallback straight line for this direction
      const d = selectedDirs[i]; // FIX
      const pts = placeOdpsAlongRoute(
        [
          [odcLng, odcLat],
          [d.edgeLng, d.edgeLat],
        ], // FIX
        odpsPerDir, // FIX
        spacingM, // FIX
      ); // FIX
      pts.forEach((p) => allPositions.push(p)); // FIX
      allRoutes.push([
        [odcLng, odcLat],
        [d.edgeLng, d.edgeLat],
      ]); // FIX
      return; // FIX
    } // FIX

    const coords = result.value.coordinates; // FIX
    // FIX: place ODPs at regular intervals along this road route
    const pts = placeOdpsAlongRoute(coords, odpsPerDir, spacingM); // FIX
    pts.forEach((p) => allPositions.push(p)); // FIX
    allRoutes.push(coords); // FIX
  }); // FIX

  // FIX: deduplicate positions that are too close (< 30m)
  const deduped: [number, number][] = []; // FIX
  allPositions.forEach((pos) => {
    const tooClose = deduped.some(
      (existing) => haversineM(pos[1], pos[0], existing[1], existing[0]) < 30, // FIX
    ); // FIX
    if (!tooClose) deduped.push(pos); // FIX
  }); // FIX

  // JLM Issue 4: if dedupe removed too many, sample extra points along longest routes
  // instead of cloning the last coordinate (which stacked ODPs on one pole).
  if (deduped.length < odpCount && allRoutes.length > 0) {
    const longest = [...allRoutes].sort(
      (a, b) =>
        (b.length > 1 ? haversineM(b[0][1], b[0][0], b[b.length - 1][1], b[b.length - 1][0]) : 0) -
        (a.length > 1 ? haversineM(a[0][1], a[0][0], a[a.length - 1][1], a[a.length - 1][0]) : 0),
    )[0];
    const extras = placeOdpsAlongRoute(longest, odpCount - deduped.length + 2, Math.max(40, spacingM * 0.75));
    for (const p of extras) {
      if (deduped.length >= odpCount) break;
      const tooClose = deduped.some(
        (existing) => haversineM(p[1], p[0], existing[1], existing[0]) < 30,
      );
      if (!tooClose) deduped.push(p);
    }
  }

  return {
    positions: deduped.slice(0, odpCount), // FIX
    routes: allRoutes, // FIX
  }; // FIX
}

// FIX: cascade chain routing — more realistic cable layout
// FIX: ODC → ODP-1 → ODP-2 → ODP-3 (daisy chain per road branch)
// FIX: Saves cable vs star topology for long distances
function buildCascadeRoutes(
  odcPos: [number, number], // FIX
  odpPositions: [number, number][], // FIX
  spokeRoutes: [number, number][][], // FIX
  _spacingM: number, // FIX: reserved for trim tolerance
): [number, number][][] {
  if (odpPositions.length === 0) return []; // FIX

  if (spokeRoutes.length === 0) {
    const sorted = [...odpPositions].sort(
      (a, b) =>
        haversineM(a[1], a[0], odcPos[1], odcPos[0]) - haversineM(b[1], b[0], odcPos[1], odcPos[0]), // FIX
    ); // FIX
    const chain: [number, number][][] = []; // FIX
    let prevPos: [number, number] = odcPos; // FIX
    sorted.forEach((odp) => {
      chain.push([prevPos, odp]); // FIX
      prevPos = odp; // FIX
    }); // FIX
    return chain; // FIX
  } // FIX

  // FIX: group ODPs by nearest spoke route
  const groups = new Map<number, [number, number][]>(); // FIX
  spokeRoutes.forEach((_, i) => groups.set(i, [])); // FIX

  odpPositions.forEach((odp) => {
    let minDist = Infinity; // FIX
    let bestSpoke = 0; // FIX
    spokeRoutes.forEach((route, i) => {
      route.forEach(([rLng, rLat]) => {
        const d = haversineM(odp[1], odp[0], rLat, rLng); // FIX
        if (d < minDist) {
          minDist = d; // FIX
          bestSpoke = i; // FIX
        } // FIX
      }); // FIX
    }); // FIX
    groups.get(bestSpoke)?.push(odp); // FIX
  }); // FIX

  // FIX: for each spoke group, sort ODPs by distance from ODC
  // FIX: then chain them: ODC → nearest ODP → next ODP → ...
  const cascadeRoutes: [number, number][][] = []; // FIX

  groups.forEach((odps) => {
    if (odps.length === 0) return; // FIX

    const sorted = [...odps].sort(
      (a, b) =>
        haversineM(a[1], a[0], odcPos[1], odcPos[0]) - haversineM(b[1], b[0], odcPos[1], odcPos[0]), // FIX
    ); // FIX

    // FIX: build chain: ODC → ODP1, ODP1 → ODP2, ODP2 → ODP3
    let prevPos: [number, number] = odcPos; // FIX
    sorted.forEach((odp) => {
      cascadeRoutes.push([prevPos, odp]); // FIX
      prevPos = odp; // FIX
    }); // FIX
  }); // FIX

  return cascadeRoutes; // FIX
}

// FIX: generate synthetic homepass around ODP
function syntheticHomepass(
  odp: [number, number], // FIX
  count: number, // FIX
  radiusM: number, // FIX
  seed: number, // FIX
): Array<{ lng: number; lat: number }> {
  const points: Array<{ lng: number; lat: number }> = []; // FIX
  const R = 6371000; // FIX
  for (let i = 0; i < count; i++) {
    // FIX: deterministic "random" using seed so it's stable
    const angle = ((2 * Math.PI * (i + seed * 7)) / count + seed * 0.4); // FIX
    const dist = radiusM * (0.3 + (0.7 * (((i * 3 + seed) % 7) / 7))); // FIX
    const dLat = (dist / R) * (180 / Math.PI) * Math.cos(angle); // FIX
    const dLng =
      ((dist / R) * (180 / Math.PI) * Math.sin(angle)) / Math.cos((odp[1] * Math.PI) / 180); // FIX
    points.push({ lng: odp[0] + dLng, lat: odp[1] + dLat }); // FIX
  }
  return points; // FIX
}
// FIX: check if point is inside polygon using ray casting
function isPointInPolygon(lng: number, lat: number, poly: [number, number][]): boolean {
  // FIX: try turf first
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), turf.polygon([[...poly, poly[0]]])); // FIX
  } catch {
    // FIX: fallback ray casting (lng/lat plane, small areas)
    let inside = false; // FIX
    const n = poly.length; // FIX
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = poly[i]; // FIX
      const [xj, yj] = poly[j]; // FIX
      const intersect =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi; // FIX
      if (intersect) inside = !inside; // FIX
    } // FIX
    return inside; // FIX
  } // FIX
} // FIX

// FIX: check if point is inside circle
function isPointInCircle(
  lng: number, // FIX
  lat: number, // FIX
  centerLng: number, // FIX
  centerLat: number, // FIX
  radiusM: number, // FIX
): boolean {
  return haversineM(lat, lng, centerLat, centerLng) <= radiusM; // FIX
} // FIX

// FIX: after snap — ensure ODP stays inside polygon/circle (clamp to edge or nearest vertex)
function verifyOdpInBoundary(
  [lng, lat]: [number, number], // FIX
  boundary: // FIX
    | { type: 'polygon'; points: [number, number][] } // FIX
    | { type: 'circle'; centerLng: number; centerLat: number; radiusM: number }, // FIX
): [number, number] {
  if (boundary.type === 'circle') {
    const d = haversineM(lat, lng, boundary.centerLat, boundary.centerLng); // FIX
    if (d <= boundary.radiusM) return [lng, lat]; // FIX
    const R = 6371000; // FIX
    const dist = boundary.radiusM * 0.95; // FIX
    const δ = dist / R; // FIX
    const φ1 = (boundary.centerLat * Math.PI) / 180; // FIX
    const λ1 = (boundary.centerLng * Math.PI) / 180; // FIX
    const y =
      ((lng - boundary.centerLng) * Math.PI) / 180; // FIX
    const x = ((lat - boundary.centerLat) * Math.PI) / 180; // FIX
    const θ = Math.atan2(y * Math.cos(φ1), x); // FIX: bearing toward point
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)); // FIX
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), // FIX
        Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2), // FIX
      ); // FIX
    return [(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]; // FIX: [lng, lat]
  } // FIX
  if (isPointInPolygon(lng, lat, boundary.points)) return [lng, lat]; // FIX
  // JLM Issue 4: clamp to nearest boundary EDGE (not vertex) so ODPs stay on
  // the polygon perimeter instead of jumping to a far corner.
  const ring = [...boundary.points];
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push(ring[0]);
  }
  let minDist = Infinity;
  let nearest: [number, number] = boundary.points[0];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / len2)) : 0;
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = haversineM(lat, lng, py, px);
    if (d < minDist) {
      minDist = d;
      nearest = [px, py];
    }
  }
  return nearest;
} // FIX

// FIX: max distance from center to polygon vertices (meters) — sampling radius for syntheticInsideBoundary
// GIS Issue 3: setelah snap-ke-jalan beberapa ODP bisa menumpuk di titik/tiang
// yang sama. Sebar ulang dengan jarak minimum antar-ODP: pakai posisi mentah
// (pre-snap) dulu, lalu geser bertahap bila masih menumpuk.
function spreadStackedOdps(
  snapped: [number, number][],
  raw: [number, number][],
  minSepM = 20,
): [number, number][] {
  const out: [number, number][] = [];
  const tooClose = (p: [number, number]) =>
    out.some((q) => haversineM(p[1], p[0], q[1], q[0]) < minSepM);
  snapped.forEach((pos, i) => {
    let candidate = pos;
    if (tooClose(candidate) && raw[i]) {
      candidate = raw[i]; // posisi ring asli biasanya sudah tersebar
    }
    let attempt = 0;
    while (tooClose(candidate) && attempt < 8) {
      attempt += 1;
      const bearing = (((i * 47 + attempt * 45) % 360) * Math.PI) / 180;
      const dM = minSepM * attempt;
      const dLat = (dM / 6371000) * (180 / Math.PI) * Math.cos(bearing);
      const dLng =
        ((dM / 6371000) * (180 / Math.PI) * Math.sin(bearing)) /
        Math.max(0.2, Math.cos((pos[1] * Math.PI) / 180));
      candidate = [pos[0] + dLng, pos[1] + dLat];
    }
    out.push(candidate);
  });
  return out;
}

function polygonMaxRadiusFromCenter(
  points: [number, number][], // FIX
  centerLng: number, // FIX
  centerLat: number, // FIX
): number {
  let maxD = 0; // FIX
  for (const [lng, lat] of points) {
    maxD = Math.max(maxD, haversineM(lat, lng, centerLat, centerLng)); // FIX
  } // FIX
  return maxD > 0 ? maxD : 200; // FIX
} // FIX

// FIX: generate synthetic homepass points INSIDE boundary (deterministic seed)
function syntheticInsideBoundary(
  centerLng: number, // FIX
  centerLat: number, // FIX
  count: number, // FIX
  boundary: { type: 'circle'; radiusM: number } | { type: 'polygon'; points: [number, number][] }, // FIX
  seed: number, // FIX
): Array<{ lng: number; lat: number }> {
  const results: Array<{ lng: number; lat: number }> = []; // FIX
  const R = 6371000; // FIX
  const maxTries = count * 40; // FIX: try up to 40x per point
  let tries = 0; // FIX
  let s = (seed + 1) * 9973; // FIX
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) >>> 0; // FIX
    return (s % 0x7fffffff) / 0x7fffffff; // FIX
  }; // FIX

  const maxR =
    boundary.type === 'circle' // FIX
      ? boundary.radiusM * 0.92 // FIX
      : polygonMaxRadiusFromCenter(boundary.points, centerLng, centerLat) * 0.95; // FIX

  while (results.length < count && tries < maxTries) {
    tries++; // FIX
    const angle = rnd() * 2 * Math.PI; // FIX
    const dist = rnd() * maxR; // FIX
    const dLat = (dist / R) * (180 / Math.PI) * Math.cos(angle); // FIX
    const dLng =
      ((dist / R) * (180 / Math.PI) * Math.sin(angle)) / Math.cos((centerLat * Math.PI) / 180); // FIX
    const lng = centerLng + dLng; // FIX
    const lat = centerLat + dLat; // FIX

    const inside = // FIX
      boundary.type === 'circle' // FIX
        ? isPointInCircle(lng, lat, centerLng, centerLat, boundary.radiusM) // FIX
        : isPointInPolygon(lng, lat, boundary.points); // FIX

    if (inside) results.push({ lng, lat }); // FIX
  } // FIX

  return results; // FIX
} // FIX


/** Phase 2: constructs GeoJSON for POST /api/design (topology contract — nodes/edges with refIds). */
export function buildDesignGeometry(args: {
  backbone: [number, number];
  odcPoint: [number, number];
  odpPositions: [number, number][];
  feederCoords: [number, number][];
  distRoutes: [number, number][][];
}): FeatureCollection {
  type NodeKind = 'node';
  type EdgeKind = 'edge';
  const routeLenM = (c: [number, number][]): number => {
    let t = 0;
    for (let i = 1; i < c.length; i++) {
      const [lng1, lat1] = c[i - 1];
      const [lng2, lat2] = c[i];
      t += haversineM(lat1, lng1, lat2, lng2);
    }
    return Math.round(t);
  };
  const feats: Feature[] = [];
  const oltRefId = crypto.randomUUID();
  const odcRefId = crypto.randomUUID();
  const odpRefIds = args.odpPositions.map(() => crypto.randomUUID());

  feats.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: args.backbone },
    properties: { kind: 'node' satisfies NodeKind, type: 'OLT', refId: oltRefId },
  });
  feats.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: args.odcPoint },
    properties: { kind: 'node' satisfies NodeKind, type: 'ODC', refId: odcRefId },
  });
  args.odpPositions.forEach((coords, i) => {
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { kind: 'node' satisfies NodeKind, type: 'ODP', refId: odpRefIds[i] },
    });
  });

  feats.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: args.feederCoords },
    properties: {
      kind: 'edge' satisfies EdgeKind,
      refId: crypto.randomUUID(),
      type: 'FEEDER',
      fromRef: oltRefId,
      toRef: odcRefId,
      length_m: routeLenM(args.feederCoords),
      route_source: 'osrm',
    },
  });

  args.distRoutes.forEach((routeCoords, segIdx) => {
    const fromRef = segIdx === 0 ? odcRefId : odpRefIds[segIdx - 1];
    const toRef = odpRefIds[segIdx];
    if (!fromRef || !toRef) return;
    feats.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: routeCoords },
      properties: {
        kind: 'edge' satisfies EdgeKind,
        refId: crypto.randomUUID(),
        type: 'DISTRIBUTION',
        fromRef,
        toRef,
        length_m: routeLenM(routeCoords),
        route_source: 'osrm',
      },
    });
  });

  return { type: 'FeatureCollection', features: feats };
}


/**
 * Phase 1: topoExportData is owned here and passed into export handlers via the page/useExports wiring.
 */
export function useTopologyRender(args: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  /** Explicit shared calc input — avoid implicit cross-hook refs (see GIS map refactor notes). */
  inputMode: 'radius' | 'polygon';
  polygonPoints: [number, number][];
  /** GIS Issue 5: titik pelanggan dari layer KMZ (menggantikan bangunan OSM bila terisi) */
  customerPoints?: [number, number][];
  /** JLM hybrid: existing ODP/ODC/OLT from KMZ + Gambar Manual — locked, gap-fill only */
  existingNetwork?: {
    olt: [number, number][];
    odc: [number, number][];
    odp: [number, number][];
  };
}) {
  const { mapRef, inputMode, polygonPoints, customerPoints, existingNetwork } = args;
  const [renderingTopology, setRenderingTopology] = useState(false);
  const [topologyRendered, setTopologyRendered] = useState(false);
  const [topoExportData, setTopoExportData] = useState<TopoExportData | null>(null);
  const [lastRenderedGeometry, setLastRenderedGeometry] = useState<LastRenderedGeometry>(null);
  const topoHandlersRef = useRef<
    Array<{
      layerId: string;
      ev: 'click' | 'mouseenter' | 'mouseleave';
      fn: (e: maplibregl.MapLayerMouseEvent) => void;
    }>
  >([]);

  // FIX: cleanup topology from map
  const clearTopology = useCallback(() => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    topoHandlersRef.current.forEach(({ layerId, ev, fn }) => {
      try {
        map.off(ev, layerId, fn); // FIX
      } catch {
        /* FIX: silent */ // FIX
      }
    }); // FIX
    topoHandlersRef.current = []; // FIX
    // FIX: remove all layers first (before sources)
    TOPO_LAYER_IDS.forEach((id) => {
      try {
        if (map.getLayer(id)) map.removeLayer(id); // FIX
      } catch {
        /* FIX: silent */ // FIX
      }
    }); // FIX
    // FIX: then remove sources
    TOPO_SOURCE_IDS.forEach((id) => {
      try {
        if (map.getSource(id)) map.removeSource(id); // FIX
      } catch {
        /* FIX: silent */ // FIX
      }
    }); // FIX
    setTopologyRendered(false); // FIX
    setLastRenderedGeometry(null);
    setTopoExportData(null);
    // JLM Issue 3: do NOT call useDesignStore.clear() — that wiped sketchTopology /
    // manual nodes when Batalkan / remap / Hitung Ulang ran. Legend "clear" and
    // remap only need map layers removed; design data stays until user explicitly clears.
  }, []);

  // FIX: render full FTTH topology on map (backend route/snap/buildings + road ODPs)
  const renderTopology = useCallback(
    async (
      result: FtthCalcApiResponse, // FIX
      backbone: [number, number], // FIX
      target: [number, number], // FIX
      drawnPolygon?: [number, number][] | null, // FIX: closed user polygon for boundary filter
    ) => {
      const map = mapRef.current; // FIX
      if (!map || !map.isStyleLoaded()) return; // FIX

      setRenderingTopology(true); // FIX
      clearTopology(); // FIX

      // FIX: get API base + token for backend calls
      const apiBase = API_BASE; // FIX: centralized API URL (smart fallback resolves at runtime via window.location)
      const cookieTok =
        typeof document !== 'undefined' ? document.cookie.match(/token=([^;]+)/)?.[1] : ''; // FIX
      const winTok =
        typeof window !== 'undefined'
          ? (window as unknown as { __permaToken?: string }).__permaToken
          : ''; // FIX
      const { accessToken } = useAuthStore.getState(); // FIX
      const authToken = accessToken || cookieTok || winTok || ''; // FIX

      try {
        const odpCount = result.equipment.odp.count; // FIX
        const spacingM = result.equipment.odp.spacingM || 65; // FIX
        // JLM Issue 3B: per-ODP port capacity — caps how many homepass each ODP serves
        const odpCapacityVal = result.equipment.odp.capacity || 8; // 8 or 16 ports
        const COVERAGE_RADIUS_M = Math.max(250, spacingM * 3); // homepass beyond this = Tidak Tercover
        const radiusM =
          result.summary.coverageRadiusMeters ?? result.summary.areaRadiusMeters ?? 300; // FIX

        const polygonPoints =
          drawnPolygon && drawnPolygon.length >= 3 ? drawnPolygon : null; // FIX
        const boundary = polygonPoints // FIX: shared by ODP verify + buildings
          ? { type: 'polygon' as const, points: polygonPoints } // FIX
          : {
              type: 'circle' as const, // FIX
              radiusM, // FIX
              centerLng: target[0], // FIX
              centerLat: target[1], // FIX
            }; // FIX

        // ── STEP ①: Snap ODC to nearest road (prefer existing KMZ/manual ODC) ──
        toast.info('① Menempatkan ODC ke jalan terdekat...'); // FIX
        const existingOdc = existingNetwork?.odc?.[0];
        const odcSeed = existingOdc ?? target;
        let odcSnapped = await backendSnap(apiBase, authToken, odcSeed[0], odcSeed[1]); // FIX
        // Extra E: keep ODC inside polygon/circle after snap
        odcSnapped = verifyOdpInBoundary(odcSnapped, boundary);
        if (existingOdc) {
          // Lock existing ODC position (still lightly verified in-boundary)
          odcSnapped = verifyOdpInBoundary(existingOdc, boundary);
          toast.info('① Memakai ODC existing dari KMZ / desain manual');
        }
        const [odcLng, odcLat] = odcSnapped; // FIX
        const odcSnappedLng = odcLng; // FIX
        const odcSnappedLat = odcLat; // FIX

        // ── STEP ②: Feeder route backbone → ODC ─────────
        toast.info('② Menghitung jalur feeder (backbone → ODC)...'); // FIX
        const feederResult = await backendRoute(
          apiBase, // FIX
          authToken, // FIX
          backbone[0], // FIX
          backbone[1], // FIX
          odcLng, // FIX
          odcLat, // FIX
        ); // FIX
        const feederCoords = feederResult.coordinates; // FIX

        // FIX: place closures along feeder route geometry
        const closurePoints: [number, number][] = []; // FIX
        if (feederCoords.length > 1) {
          let traversed = 0; // FIX
          let nextClosureAt = 500; // FIX
          for (let i = 1; i < feederCoords.length; i++) {
            const [lng1, lat1] = feederCoords[i - 1]; // FIX
            const [lng2, lat2] = feederCoords[i]; // FIX
            const segmentM = haversineM(lat1, lng1, lat2, lng2); // FIX
            while (traversed + segmentM >= nextClosureAt) {
              const fromStart = nextClosureAt - traversed; // FIX
              const ratio = fromStart / segmentM; // FIX
              closurePoints.push([
                lng1 + (lng2 - lng1) * ratio, // FIX
                lat1 + (lat2 - lat1) * ratio, // FIX
              ]); // FIX
              nextClosureAt += 500; // FIX
            }
            traversed += segmentM; // FIX
          }
        }

        // ── STEP ③: ODP placement — seed existing, gap-fill only ──
        const lockedExistingOdps = (existingNetwork?.odp ?? [])
          .map((p) => verifyOdpInBoundary(p, boundary))
          .filter((p) => {
            if (boundary.type === 'polygon') return isPointInPolygon(p[0], p[1], boundary.points);
            return isPointInCircle(p[0], p[1], boundary.centerLng, boundary.centerLat, boundary.radiusM);
          });
        const gapFillCount = Math.max(0, odpCount - lockedExistingOdps.length);
        if (lockedExistingOdps.length > 0) {
          toast.info(
            `③ ${lockedExistingOdps.length} ODP existing dikunci` +
              (gapFillCount > 0 ? ` · menambah ${gapFillCount} ODP baru` : ' · kapasitas cukup'),
          );
        } else {
          toast.info(`③ Menghitung posisi ${odpCount} ODP di sepanjang jalan...`); // FIX
        }

        let rawOdpPositions: [number, number][] = [];
        let spokeRoutes: [number, number][][] = [];
        if (gapFillCount > 0) {
          const computed = await computeOdpAlongRoads(
            apiBase,
            authToken,
            odcLng,
            odcLat,
            gapFillCount,
            spacingM,
            radiusM,
          );
          rawOdpPositions = computed.positions;
          spokeRoutes = computed.routes;
        }

        toast.info('③ Snap ODP ke jalan...'); // FIX
        const snappedGap = await Promise.all(
          rawOdpPositions.map(([lng, lat]) => backendSnap(apiBase, authToken, lng, lat)),
        );
        let verifiedGap = snappedGap.map((odp) => verifyOdpInBoundary(odp, boundary));
        verifiedGap = spreadStackedOdps(verifiedGap, rawOdpPositions);
        // Extra E: re-snap + re-verify after spread; drop still-outside
        const refinedGap: [number, number][] = [];
        for (const p of verifiedGap) {
          const reSnapped = await backendSnap(apiBase, authToken, p[0], p[1]);
          const clamped = verifyOdpInBoundary(reSnapped, boundary);
          const inside =
            boundary.type === 'polygon'
              ? isPointInPolygon(clamped[0], clamped[1], boundary.points)
              : isPointInCircle(
                  clamped[0],
                  clamped[1],
                  boundary.centerLng,
                  boundary.centerLat,
                  boundary.radiusM,
                );
          if (inside) refinedGap.push(clamped);
        }

        // ── STEP ⑤ early: buildings/homepass (also used for Extra F building reject) ──
        const kmzCustomers = (customerPoints ?? []).map(([lng, lat]) => ({
          lng,
          lat,
          osmId: 0,
          type: 'kmz-customer',
        }));
        let osmBuildingsRaw: Array<{ lng: number; lat: number; osmId: number; type: string }>;
        if (kmzCustomers.length > 0) {
          toast.info(`⑤ Memakai ${kmzCustomers.length} titik pelanggan dari KMZ...`); // GIS Issue 5
          osmBuildingsRaw = kmzCustomers;
        } else {
          toast.info('⑤ Mengambil bangunan OSM dalam area...'); // FIX
          let queryRadius = radiusM + 200;
          if (drawnPolygon && drawnPolygon.length >= 3) {
            queryRadius =
              Math.max(
                ...drawnPolygon.map(([lng, lat]) => haversineM(target[1], target[0], lat, lng)),
              ) + 100;
          }
          queryRadius = Math.min(queryRadius, 2000);
          osmBuildingsRaw = await backendBuildings(apiBase, authToken, target[1], target[0], queryRadius);
        }

        const osmBuildings = osmBuildingsRaw.filter((b) => {
          if (boundary.type === 'polygon') {
            return isPointInPolygon(b.lng, b.lat, boundary.points);
          }
          return isPointInCircle(
            b.lng,
            b.lat,
            boundary.centerLng,
            boundary.centerLat,
            boundary.radiusM,
          );
        });

        // Extra F: push gap-fill ODPs away from building centroids (existing ODPs stay locked)
        const BUILDING_CLEARANCE_M = 12;
        const clearedGap: [number, number][] = [];
        for (const p of refinedGap) {
          const tooClose = osmBuildings.some(
            (b) => haversineM(p[1], p[0], b.lat, b.lng) < BUILDING_CLEARANCE_M,
          );
          if (!tooClose) {
            clearedGap.push(p);
            continue;
          }
          // Nudge along a small bearing then re-snap to road + boundary
          let rescued: [number, number] | null = null;
          for (let attempt = 1; attempt <= 6; attempt++) {
            const bearing = ((attempt * 60) * Math.PI) / 180;
            const dM = BUILDING_CLEARANCE_M + attempt * 4;
            const dLat = (dM / 6371000) * (180 / Math.PI) * Math.cos(bearing);
            const dLng =
              ((dM / 6371000) * (180 / Math.PI) * Math.sin(bearing)) /
              Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
            const candidate = await backendSnap(apiBase, authToken, p[0] + dLng, p[1] + dLat);
            const clamped = verifyOdpInBoundary(candidate, boundary);
            const inside =
              boundary.type === 'polygon'
                ? isPointInPolygon(clamped[0], clamped[1], boundary.points)
                : isPointInCircle(
                    clamped[0],
                    clamped[1],
                    boundary.centerLng,
                    boundary.centerLat,
                    boundary.radiusM,
                  );
            const stillClose = osmBuildings.some(
              (b) => haversineM(clamped[1], clamped[0], b.lat, b.lng) < BUILDING_CLEARANCE_M,
            );
            if (inside && !stillClose) {
              rescued = clamped;
              break;
            }
          }
          if (rescued) clearedGap.push(rescued);
        }

        const odpPositions = [...lockedExistingOdps, ...clearedGap].slice(
          0,
          Math.max(odpCount, lockedExistingOdps.length),
        );

        // ── STEP ④: Distribution — cascade chain routing ──
        toast.info('④ Menghitung jalur distribusi (cascade)...'); // FIX

        const cascadeRoutes = buildCascadeRoutes(
          [odcSnappedLng, odcSnappedLat],
          odpPositions,
          spokeRoutes || [],
          spacingM,
        );

        const distRouteResults = await Promise.allSettled(
          cascadeRoutes.map(([from, to]) =>
            backendRoute(apiBase, authToken, from[0], from[1], to[0], to[1]),
          ),
        );

        const distRoutes: [number, number][][] = distRouteResults.map((r, i) =>
          r.status === 'fulfilled' && r.value?.coordinates?.length
            ? r.value.coordinates
            : ([cascadeRoutes[i][0], cascadeRoutes[i][1]] as [number, number][]),
        );
        const distRouteIsStraight: boolean[] = distRouteResults.map((r) =>
          r.status === 'fulfilled'
            ? r.value?.source === 'straight' || (r.value?.coordinates?.length ?? 0) <= 2
            : true,
        );

        // ── JLM Issue 3B: capacity-aware assignment — each ODP serves at most odpCapacityVal ──
        const odpLoad: number[] = odpPositions.map(() => 0); // ports used per ODP
        // Serve the tightest-clustered buildings first so they get the nearby ODP ports;
        // spillover beyond capacity / coverage becomes "Tidak Tercover".
        const buildingsByNeed = osmBuildings
          .map((b) => {
            let nearest = Infinity; // FIX
            odpPositions.forEach(([oLng, oLat]) => {
              const d = haversineM(b.lat, b.lng, oLat, oLng); // FIX
              if (d < nearest) nearest = d; // FIX
            }); // FIX
            return { b, nearest }; // FIX
          })
          .sort((a, z) => a.nearest - z.nearest); // FIX

        const assignedHomepass: Array<{ coords: [number, number]; odpIdx: number; covered: boolean }> = [];
        buildingsByNeed.forEach(({ b }) => {
          let chosen = -1; // FIX: nearest ODP that is in range AND has a free port
          let chosenDist = Infinity; // FIX
          odpPositions.forEach(([oLng, oLat], oi) => {
            if (odpLoad[oi] >= odpCapacityVal) return; // ODP full — skip
            const d = haversineM(b.lat, b.lng, oLat, oLng); // FIX
            if (d <= COVERAGE_RADIUS_M && d < chosenDist) {
              chosen = oi; // FIX
              chosenDist = d; // FIX
            }
          }); // FIX
          if (chosen >= 0) {
            odpLoad[chosen] += 1; // FIX
            assignedHomepass.push({ coords: [b.lng, b.lat], odpIdx: chosen, covered: true }); // FIX
          } else {
            assignedHomepass.push({ coords: [b.lng, b.lat], odpIdx: -1, covered: false }); // Tidak Tercover
          }
        }); // FIX

        // Preserve homepass coordinates carried across recalculations (keep their ODP if valid)
        const preservedHomepass = Array.isArray(result.homepassPoints) ? result.homepassPoints : [];
        const homepassKey = (c: [number, number]) => `${c[0]},${c[1]}`;
        const validHomepass: Array<{ coords: [number, number]; odpIdx: number; covered: boolean }> = [
          ...assignedHomepass,
        ];
        const seenHomepass = new Set(validHomepass.map((h) => homepassKey(h.coords)));
        preservedHomepass.forEach((hp) => {
          if (seenHomepass.has(homepassKey(hp.coords))) return; // FIX
          seenHomepass.add(homepassKey(hp.coords)); // FIX
          const idx =
            typeof hp.odpIdx === 'number' && hp.odpIdx >= 0 && hp.odpIdx < odpPositions.length
              ? hp.odpIdx
              : -1; // FIX
          if (idx >= 0) odpLoad[idx] += 1; // FIX
          validHomepass.push({ coords: hp.coords, odpIdx: idx, covered: idx >= 0 }); // FIX
        }); // FIX

        const osmCount = validHomepass.filter((h) => h.covered).length; // covered homepass total

        // Export shape for KMZ + Excel (Tercover/Tidak Tercover)
        const homepassExport = validHomepass.map((h) => ({
          lng: h.coords[0], // FIX
          lat: h.coords[1], // FIX
          isOsm: true, // FIX
          odpIndex: h.covered ? h.odpIdx + 1 : undefined, // FIX
          covered: h.covered, // FIX
        })); // FIX

        // ── STEP ⑥: Render all layers ───────────────────
        toast.info('⑥ Merender topologi di peta...'); // FIX

        // FIX: safe addSource helper to prevent duplicate errors
        const safeAddSource = (id: string, data: Parameters<maplibregl.Map['addSource']>[1]) => {
          try {
            if (map.getSource(id)) map.removeSource(id); // FIX
            map.addSource(id, data); // FIX
          } catch (e) {
            console.warn(`Failed to add source ${id}:`, e); // FIX
          }
        }; // FIX
        const safeAddLayer = (layer: Parameters<maplibregl.Map['addLayer']>[0]) => {
          try {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id); // FIX
            map.addLayer(layer); // FIX
          } catch (e) {
            console.warn(`Failed to add layer ${layer.id}:`, e); // FIX
          }
        }; // FIX

        safeAddSource('topo-feeder', {
          type: 'geojson', // FIX
          data: {
            type: 'Feature', // FIX
            geometry: { type: 'LineString', coordinates: feederCoords }, // FIX
            properties: {}, // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-feeder-line', // FIX
          type: 'line', // FIX
          source: 'topo-feeder', // FIX
          paint: {
            'line-color': '#EF4444', // FIX: feeder red
            'line-width': 4, // FIX
            'line-opacity': 0.9, // FIX
          },
        }); // FIX

        // FIX: distribution uses cascade routes (chain topology)
        safeAddSource('topo-distribution', {
          type: 'geojson', // FIX
          data: {
            type: 'FeatureCollection', // FIX
            features: distRoutes.map((coords, i) => ({
              type: 'Feature', // FIX
              geometry: { type: 'LineString', coordinates: coords }, // FIX
              properties: {
                segmentIndex: i + 1, // FIX: cascade segment
                isCascade: true, // FIX
                isStraight: distRouteIsStraight[i] === true, // GIS Issue 4
              },
            })), // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-dist-line', // FIX
          type: 'line', // FIX
          source: 'topo-distribution', // FIX
          filter: ['!=', ['get', 'isStraight'], true], // GIS Issue 4: hanya rute jalan
          paint: {
            'line-color': '#3B82F6', // FIX: distribusi blue
            'line-width': 2.5, // FIX
            'line-opacity': 0.85, // FIX
          },
        }); // FIX
        // GIS Issue 4: segmen fallback garis lurus (OSRM/Valhalla gagal) tampil
        // dashed oranye — penanda "rute belum mengikuti jalan, perlu verifikasi"
        safeAddLayer({
          id: 'topo-dist-line-straight',
          type: 'line',
          source: 'topo-distribution',
          filter: ['==', ['get', 'isStraight'], true],
          paint: {
            'line-color': '#F59E0B',
            'line-width': 2.5,
            'line-opacity': 0.9,
            'line-dasharray': [2, 2],
          },
        });

        safeAddSource('topo-drop', {
          type: 'geojson', // FIX
          data: {
            type: 'FeatureCollection', // FIX
            // JLM Issue 3B: only covered homepass have a drop cable to an ODP
            features: validHomepass
              .filter((hp) => hp.covered && odpPositions[hp.odpIdx]) // FIX
              .map((hp) => ({
                type: 'Feature' as const, // FIX
                geometry: {
                  type: 'LineString' as const, // FIX
                  coordinates: [odpPositions[hp.odpIdx], hp.coords], // FIX
                },
                properties: {}, // FIX
              })), // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-drop-line', // FIX
          type: 'line', // FIX
          source: 'topo-drop', // FIX
          paint: {
            'line-color': '#111827', // FIX: drop dark gray
            'line-width': 0.8, // FIX
            'line-opacity': 0.6, // FIX
            'line-dasharray': [2, 2], // FIX
          },
        }); // FIX

        if (closurePoints.length > 0) {
          // FIX: Closure along feeder
          safeAddSource('topo-closure', {
            type: 'geojson', // FIX
            data: {
              type: 'FeatureCollection', // FIX
              features: closurePoints.map(([lng, lat], i) => ({
                type: 'Feature', // FIX
                geometry: { type: 'Point', coordinates: [lng, lat] }, // FIX
                properties: { label: `Closure ${i + 1}` }, // FIX
              })), // FIX
            },
          }); // FIX
          safeAddLayer({
            id: 'topo-closure-circle', // FIX
            type: 'circle', // FIX
            source: 'topo-closure', // FIX
            paint: {
              'circle-radius': 6, // FIX
              'circle-color': '#F59E0B', // FIX: closure amber
              'circle-stroke-color': 'white', // FIX
              'circle-stroke-width': 2, // FIX
            },
          }); // FIX
        }

        // JLM Issue B: poles are always planned at the user-configured interval
        // (result.equipment.pole.spacingM echoes the value chosen in the calc panel).
        const poleSpacingM = result.equipment?.pole?.spacingM || 45; // FIX
        let polePointsForExport: [number, number][] = []; // JLM Issue B

        {
          const tiangPoints: [number, number][] = []; // FIX
          let accumulated = 0; // FIX
          let nextPoleAt = poleSpacingM; // FIX

          // FIX: place tiang along feeder route
          for (let i = 1; i < feederCoords.length; i++) {
            const [lng1, lat1] = feederCoords[i - 1]; // FIX
            const [lng2, lat2] = feederCoords[i]; // FIX
            const segM = haversineM(lat1, lng1, lat2, lng2); // FIX
            while (accumulated + segM >= nextPoleAt) {
              const ratio = (nextPoleAt - accumulated) / segM; // FIX
              tiangPoints.push([
                lng1 + (lng2 - lng1) * ratio, // FIX
                lat1 + (lat2 - lat1) * ratio, // FIX
              ]); // FIX
              nextPoleAt += poleSpacingM; // FIX
            }
            accumulated += segM; // FIX
          }

          // FIX: also place tiang along distribution routes
          distRoutes.forEach((route) => {
            let acc2 = 0; // FIX
            let nextP2 = poleSpacingM; // FIX
            for (let i = 1; i < route.length; i++) {
              const [lng1, lat1] = route[i - 1]; // FIX
              const [lng2, lat2] = route[i]; // FIX
              const segM = haversineM(lat1, lng1, lat2, lng2); // FIX
              while (acc2 + segM >= nextP2) {
                const ratio = (nextP2 - acc2) / segM; // FIX
                tiangPoints.push([
                  lng1 + (lng2 - lng1) * ratio, // FIX
                  lat1 + (lat2 - lat1) * ratio, // FIX
                ]); // FIX
                nextP2 += poleSpacingM; // FIX
              }
              acc2 += segM; // FIX
            }
          }); // FIX

          // FIX: dedupe tiang too close together
          const dedupedTiang: [number, number][] = []; // FIX
          tiangPoints.forEach((t) => {
            const tooClose = dedupedTiang.some(
              (existing) => haversineM(t[1], t[0], existing[1], existing[0]) < 20, // FIX
            ); // FIX
            if (!tooClose) dedupedTiang.push(t); // FIX
          }); // FIX

          // FIX: max 100 tiang markers for performance
          const tiangSample = dedupedTiang
            .filter((_, i) => i % Math.max(1, Math.floor(dedupedTiang.length / 100)) === 0) // FIX
            .slice(0, 100); // FIX
          polePointsForExport = tiangSample; // JLM Issue B: include poles in export result

          if (tiangSample.length > 0) {
            safeAddSource('topo-tiang', {
              type: 'geojson', // FIX
              data: {
                type: 'FeatureCollection', // FIX
                features: tiangSample.map(([lng, lat], i) => ({
                  type: 'Feature', // FIX
                  geometry: { type: 'Point', coordinates: [lng, lat] }, // FIX
                  properties: { label: `T-${i + 1}`, index: i + 1 }, // FIX
                })), // FIX
              },
            }); // FIX
            safeAddLayer({
              id: 'topo-tiang-circle', // FIX
              type: 'circle', // FIX
              source: 'topo-tiang', // FIX
              paint: {
                'circle-radius': 4, // FIX
                'circle-color': '#D1D5DB', // FIX
                'circle-stroke-color': '#6B7280', // FIX
                'circle-stroke-width': 1.5, // FIX
                'circle-opacity': 0.85, // FIX
              },
            }); // FIX
            safeAddLayer({
              id: 'topo-tiang-label', // FIX
              type: 'symbol', // FIX
              source: 'topo-tiang', // FIX
              layout: {
                'text-field': ['get', 'label'] as maplibregl.ExpressionSpecification, // FIX
                'text-size': 8, // FIX
                'text-offset': [0, 1.2], // FIX
                'text-anchor': 'top', // FIX
                'text-optional': true, // FIX
              }, // FIX
              paint: {
                'text-color': '#6B7280', // FIX
                'text-halo-color': 'white', // FIX
                'text-halo-width': 1, // FIX
              },
            }); // FIX
          }
        }

        safeAddSource('topo-homepass', {
          type: 'geojson', // FIX
          data: {
            type: 'FeatureCollection', // FIX
            features: validHomepass.map((hp) => ({
              type: 'Feature', // FIX
              geometry: { type: 'Point', coordinates: hp.coords }, // FIX
              // JLM Issue 3B: carry coverage so the map can distinguish Tercover/Tidak Tercover
              properties: { odpIndex: hp.covered ? hp.odpIdx + 1 : 0, covered: hp.covered ? 1 : 0 }, // FIX
            })), // FIX
          },
        }); // FIX

        safeAddLayer({
          id: 'topo-ont-circle', // FIX
          type: 'circle', // FIX
          source: 'topo-homepass', // FIX
          paint: {
            'circle-radius': 5, // FIX: homepass medium green
            // JLM Issue 3B: green = Tercover, gray = Tidak Tercover
            'circle-color': ['case', ['==', ['get', 'covered'], 1], '#22C55E', '#9CA3AF'] as maplibregl.ExpressionSpecification, // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 1.5, // FIX
            'circle-opacity': 0.9, // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-ont-label', // FIX
          type: 'symbol', // FIX
          source: 'topo-homepass', // FIX
          layout: {
            'text-field': 'HP', // FIX
            'text-size': 7, // FIX
            'text-offset': [0, -1.3], // FIX
            'text-anchor': 'bottom', // FIX
            'text-optional': true, // FIX
          }, // FIX
          paint: {
            'text-color': '#15803D', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 1, // FIX
          },
        }); // FIX

        // FIX: Backbone/OLT — always render
        safeAddSource('topo-backbone', {
          type: 'geojson', // FIX
          data: {
            type: 'Feature', // FIX
            geometry: { type: 'Point', coordinates: backbone }, // FIX
            properties: { label: 'OLT' }, // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-backbone-circle', // FIX
          type: 'circle', // FIX
          source: 'topo-backbone', // FIX
          paint: {
            'circle-radius': 13, // FIX
            'circle-color': '#1D4ED8', // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 3, // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-backbone-label', // FIX
          type: 'symbol', // FIX
          source: 'topo-backbone', // FIX
          layout: {
            'text-field': 'OLT', // FIX
            'text-size': 11, // FIX
            'text-offset': [0, -2], // FIX
            'text-anchor': 'bottom', // FIX
          },
          paint: {
            'text-color': '#1D4ED8', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 2, // FIX
          },
        }); // FIX

        safeAddSource('topo-odc', {
          type: 'geojson', // FIX
          data: {
            type: 'Feature', // FIX
            geometry: { type: 'Point', coordinates: [odcLng, odcLat] }, // FIX
            properties: { label: `ODC ${result.equipment.odc.capacity}` }, // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-odc-circle', // FIX
          type: 'circle', // FIX
          source: 'topo-odc', // FIX
          paint: {
            'circle-radius': 11, // FIX
            'circle-color': '#7C3AED', // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 3, // FIX
          },
        }); // FIX

        safeAddSource('topo-odp', {
          type: 'geojson', // FIX
          data: {
            type: 'FeatureCollection', // FIX
            features: odpPositions.map(([lng, lat], i) => ({
              type: 'Feature', // FIX
              geometry: { type: 'Point', coordinates: [lng, lat] }, // FIX
              properties: {
                label: `ODP-${i + 1}`, // FIX
                capacity: result.equipment.odp.capacity, // FIX
                // JLM Issue 3A: port utilization (covered homepass served / total ports)
                portUsage: odpLoad[i] ?? 0, // FIX
                portCapacity: odpCapacityVal, // FIX
              },
            })), // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-odp-circle', // FIX
          type: 'circle', // FIX
          source: 'topo-odp', // FIX
          paint: {
            'circle-radius': 8, // FIX: ODP dark green
            'circle-color': '#16A34A', // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 2.5, // FIX
            'circle-opacity': 1.0, // FIX
          },
        }); // FIX
        // FIX: ODP label shows splitter info
        safeAddLayer({
          id: 'topo-odp-label', // FIX
          type: 'symbol', // FIX
          source: 'topo-odp', // FIX
          layout: {
            'text-field': [
              'concat',
              ['get', 'label'],
              '\n',
              // JLM Issue 3A: show port utilization e.g. "6/8"
              ['to-string', ['get', 'portUsage']],
              '/',
              ['to-string', ['get', 'portCapacity']],
            ] as maplibregl.ExpressionSpecification, // FIX
            'text-size': 9, // FIX
            'text-offset': [0, 1.8], // FIX
            'text-anchor': 'top', // FIX
            'text-optional': true, // FIX
            'text-line-height': 1.2, // FIX
          },
          paint: {
            'text-color': '#15803D', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 1.5, // FIX
          },
        }); // FIX

        safeAddLayer({
          id: 'topo-odc-label', // FIX
          type: 'symbol', // FIX
          source: 'topo-odc', // FIX
          layout: {
            'text-field': 'ODC', // FIX
            'text-size': 11, // FIX
            'text-offset': [0, -2], // FIX
            'text-anchor': 'bottom', // FIX
          },
          paint: {
            'text-color': '#7C3AED', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 2, // FIX
          },
        }); // FIX

        const addClickPopup = (
          layerId: string, // FIX
          htmlFn: (props: Record<string, unknown> | null | undefined, lngLat: maplibregl.LngLat) => string, // FIX
        ) => {
          const onClick = (e: maplibregl.MapLayerMouseEvent) => {
            if (!e.features?.length) return; // FIX
            new maplibregl.Popup({ maxWidth: '220px' }) // FIX
              .setLngLat(e.lngLat) // FIX
              .setHTML(htmlFn(e.features[0].properties as Record<string, unknown>, e.lngLat)) // FIX
              .addTo(map); // FIX
          }; // FIX
          const onEnter = () => {
            map.getCanvas().style.cursor = 'pointer'; // FIX
          }; // FIX
          const onLeave = () => {
            map.getCanvas().style.cursor = ''; // FIX
          }; // FIX
          map.on('click', layerId, onClick); // FIX
          map.on('mouseenter', layerId, onEnter); // FIX
          map.on('mouseleave', layerId, onLeave); // FIX
          topoHandlersRef.current.push({ layerId, ev: 'click', fn: onClick }); // FIX
          topoHandlersRef.current.push({ layerId, ev: 'mouseenter', fn: onEnter }); // FIX
          topoHandlersRef.current.push({ layerId, ev: 'mouseleave', fn: onLeave }); // FIX
        }; // FIX

        // FIX: enhanced OLT popup
        addClickPopup('topo-backbone-circle', (_, ll) => // FIX
          `<div style="font-family:sans-serif;padding:6px;min-width:180px">` + // FIX
            `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` + // FIX
            `<div style="width:10px;height:10px;border-radius:50%;background:#1D4ED8;flex-shrink:0"></div>` + // FIX
            `<b style="color:#1D4ED8;font-size:13px">OLT / Backbone</b></div>` + // FIX
            `<table style="width:100%;border-collapse:collapse;font-size:11px">` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Provider</td>` + // FIX
            `<td style="font-weight:600">${result.summary.backboneOwner || 'OSM Data'}</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Standard</td>` + // FIX
            `<td style="font-weight:600">${result.equipment.olt.standard || 'GPON ITU-T G.984'}</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Port needed</td>` + // FIX
            `<td style="font-weight:600">${result.equipment.olt.portsNeeded || 0} port</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Koordinat</td>` + // FIX
            `<td style="font-weight:600;font-size:10px">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</td></tr>` + // FIX
            `</table></div>`, // FIX
        ); // FIX
        // FIX: enhanced ODC popup
        addClickPopup('topo-odc-circle', (_, ll) => // FIX
          `<div style="font-family:sans-serif;padding:6px;min-width:180px">` + // FIX
            `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` + // FIX
            `<div style="width:10px;height:10px;border-radius:50%;background:#7C3AED;flex-shrink:0"></div>` + // FIX
            `<b style="color:#7C3AED;font-size:13px">ODC</b></div>` + // FIX
            `<table style="width:100%;border-collapse:collapse;font-size:11px">` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Kapasitas</td>` + // FIX
            `<td style="font-weight:600">${result.equipment.odc.capacity || '144-core'}</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">ODP terhubung</td>` + // FIX
            `<td style="font-weight:600">${result.equipment.odp.count || 0} unit</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Koordinat</td>` + // FIX
            `<td style="font-weight:600;font-size:10px">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</td></tr>` + // FIX
            `</table></div>`, // FIX
        ); // FIX
        // FIX: enhanced ODP popup with full device info
        addClickPopup('topo-odp-circle', (p, ll) => // FIX
          `<div style="font-family:sans-serif;padding:6px;min-width:180px">` + // FIX
            `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` + // FIX
            `<div style="width:10px;height:10px;border-radius:50%;background:#16A34A;flex-shrink:0"></div>` + // FIX
            `<b style="color:#16A34A;font-size:13px">${String(p?.label ?? 'ODP')}</b></div>` + // FIX
            `<table style="width:100%;border-collapse:collapse;font-size:11px">` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Tipe</td>` + // FIX
            `<td style="font-weight:600">ODP ${p?.capacity}-port</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Splitter</td>` + // FIX
            `<td style="font-weight:600">1:${p?.capacity} passive</td></tr>` + // FIX
            `<tr><td style="color:#6B7280;padding:2px 0">Koordinat</td>` + // FIX
            `<td style="font-weight:600;font-size:10px">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</td></tr>` + // FIX
            `</table></div>`, // FIX
        ); // FIX
        addClickPopup('topo-ont-circle', (p, ll) => // FIX: Homepass popup
          `<div style="font-family:sans-serif;padding:4px">` + // FIX
            `<b style="color:#16A34A">🏠 Homepass</b><br>` + // FIX
            `<small style="color:#6B7280">` + // FIX
            `ODP-${p?.odpIndex}` + // FIX
            `</small><br>` + // FIX
            `<small>${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</small>` + // FIX
            `</div>`, // FIX
        ); // FIX
        if (map.getLayer('topo-closure-circle')) {
          // FIX: enhanced Closure popup
          addClickPopup('topo-closure-circle', (p, ll) => // FIX
            `<div style="font-family:sans-serif;padding:6px">` + // FIX
              `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` + // FIX
              `<div style="width:10px;height:10px;border-radius:50%;background:#F59E0B;flex-shrink:0"></div>` + // FIX
              `<b style="color:#F59E0B;font-size:13px">${String(p?.label || 'Closure')}</b></div>` + // FIX
              `<div style="font-size:11px;color:#6B7280">` + // FIX
              `Splice Closure — setiap 500m di feeder<br>` + // FIX
              `<span style="font-size:10px">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</span>` + // FIX
              `</div></div>`, // FIX
          ); // FIX
        }

        const straightRouteCount = distRouteIsStraight.filter(Boolean).length;

        // FIX: store for KMZ + Excel export (JLM Issue 1/2/3A)
        setTopoExportData({
          backbone, // FIX
          odcPoint: [odcLng, odcLat], // FIX
          odpPositions, // FIX
          homepassPoints: homepassExport, // FIX: incl. odpIndex + covered status
          feederCoords, // JLM Issue 2: OLT → ODC path
          distRoutes, // JLM Issue 2: ODC → ODP paths
          closurePoints, // JLM Issue 2: splice closures
          polePoints: polePointsForExport, // JLM Issue B: auto-planned poles
          odpLoad, // JLM Issue 3A: per-ODP load
          odpCapacity: odpCapacityVal, // JLM Issue 3A
          straightRouteCount,
          existingOdpCount: lockedExistingOdps.length,
        }); // FIX

        setTopologyRendered(true); // FIX
        // Added in Phase 2A: mirror render inputs for save/load UI without reading map source internals.
        // Inserted before success toast block to keep existing render flow unchanged.
        setLastRenderedGeometry({
          oltCoords: backbone,
          odcCoords: [odcLng, odcLat],
          odpPositions,
          feederCoords,
          distRoutes,
        });
        const existingNote =
          lockedExistingOdps.length > 0 ? ` · ${lockedExistingOdps.length} ODP existing` : '';
        const straightNote =
          straightRouteCount > 0 ? ` · ${straightRouteCount} jalur fallback lurus` : '';
        toast.success(
          `✅ Topologi selesai: ${odpPositions.length} ODP · ` +
            `${osmCount} tercover / ${validHomepass.length} homepass (kapasitas 1:${odpCapacityVal})` +
            existingNote +
            straightNote,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error'; // FIX
        toast.error(`Gagal render topologi: ${msg}`); // FIX
      } finally {
        setRenderingTopology(false); // FIX
      }
    },
    [clearTopology, inputMode, polygonPoints, customerPoints, existingNetwork],
  );

  const renderStoredDesign = useCallback(
    async (args: { baseTopology: any; geometry: FeatureCollection; calcInputs?: any }): Promise<void> => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;

      setRenderingTopology(true);
      clearTopology();

      try {
        const features = Array.isArray(args.geometry?.features) ? args.geometry.features : [];
        const nodeFeatures = features.filter(
          (f): f is Feature =>
            f?.type === 'Feature' &&
            f.geometry?.type === 'Point' &&
            (f.properties as Record<string, unknown> | undefined)?.kind === 'node',
        );
        const edgeFeatures = features.filter(
          (f): f is Feature =>
            f?.type === 'Feature' &&
            f.geometry?.type === 'LineString' &&
            (f.properties as Record<string, unknown> | undefined)?.kind === 'edge',
        );

        const oltFeature = nodeFeatures.find(
          (f) => (f.properties as Record<string, unknown>)?.type === 'OLT',
        );
        const odcFeature = nodeFeatures.find(
          (f) => (f.properties as Record<string, unknown>)?.type === 'ODC',
        );
        const odpFeatures = nodeFeatures.filter(
          (f) => (f.properties as Record<string, unknown>)?.type === 'ODP',
        );

        const feederFeature = edgeFeatures.find(
          (f) => (f.properties as Record<string, unknown>)?.type === 'FEEDER',
        );
        const distributionFeatures = edgeFeatures.filter(
          (f) => (f.properties as Record<string, unknown>)?.type === 'DISTRIBUTION',
        );

        const oltCoords = (oltFeature?.geometry as { coordinates?: [number, number] } | undefined)
          ?.coordinates;
        const odcCoords = (odcFeature?.geometry as { coordinates?: [number, number] } | undefined)
          ?.coordinates;
        if (!oltCoords || !odcCoords) {
          throw new Error('Stored design is missing required OLT/ODC geometry');
        }

        const feederCoords = (
          feederFeature?.geometry as { coordinates?: [number, number][] } | undefined
        )?.coordinates;
        const distRoutes = distributionFeatures
          .map(
            (f) =>
              (f.geometry as { coordinates?: [number, number][] } | undefined)?.coordinates ?? [],
          )
          .filter((coords) => coords.length >= 2);
        const odpPositions = odpFeatures
          .map(
            (f) =>
              (f.geometry as { coordinates?: [number, number] } | undefined)?.coordinates,
          )
          .filter((coords): coords is [number, number] => Array.isArray(coords));

        const safeAddSource = (id: string, data: Parameters<maplibregl.Map['addSource']>[1]) => {
          try {
            if (map.getSource(id)) map.removeSource(id); // FIX
            map.addSource(id, data); // FIX
          } catch (e) {
            console.warn(`Failed to add source ${id}:`, e); // FIX
          }
        }; // FIX
        const safeAddLayer = (layer: Parameters<maplibregl.Map['addLayer']>[0]) => {
          try {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id); // FIX
            map.addLayer(layer); // FIX
          } catch (e) {
            console.warn(`Failed to add layer ${layer.id}:`, e); // FIX
          }
        }; // FIX

        if (feederCoords && feederCoords.length >= 2) {
          safeAddSource('topo-feeder', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: feederCoords }, properties: {} },
          });
          safeAddLayer({
            id: 'topo-feeder-line',
            type: 'line',
            source: 'topo-feeder',
            paint: { 'line-color': '#EF4444', 'line-width': 4, 'line-opacity': 0.9 },
          });
        }

        if (distRoutes.length > 0) {
          safeAddSource('topo-distribution', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: distRoutes.map((coords, i) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { segmentIndex: i + 1, isCascade: true },
              })),
            },
          });
          safeAddLayer({
            id: 'topo-dist-line',
            type: 'line',
            source: 'topo-distribution',
            paint: { 'line-color': '#3B82F6', 'line-width': 2.5, 'line-opacity': 0.85 },
          });
        }

        safeAddSource('topo-backbone', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: oltCoords },
            properties: { label: 'OLT' },
          },
        });
        safeAddLayer({
          id: 'topo-backbone-circle',
          type: 'circle',
          source: 'topo-backbone',
          paint: {
            'circle-radius': 13,
            'circle-color': '#1D4ED8',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
          },
        });
        safeAddLayer({
          id: 'topo-backbone-label',
          type: 'symbol',
          source: 'topo-backbone',
          layout: { 'text-field': 'OLT', 'text-size': 11, 'text-offset': [0, -2], 'text-anchor': 'bottom' },
          paint: { 'text-color': '#1D4ED8', 'text-halo-color': 'white', 'text-halo-width': 2 },
        });

        const odcCapacity =
          (
            args.baseTopology as {
              equipment?: { odc?: { capacity?: string } };
            }
          )?.equipment?.odc?.capacity ?? '144-core';

        safeAddSource('topo-odc', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: odcCoords },
            properties: { label: `ODC ${odcCapacity}` },
          },
        });
        safeAddLayer({
          id: 'topo-odc-circle',
          type: 'circle',
          source: 'topo-odc',
          paint: {
            'circle-radius': 11,
            'circle-color': '#7C3AED',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 3,
          },
        });
        safeAddLayer({
          id: 'topo-odc-label',
          type: 'symbol',
          source: 'topo-odc',
          layout: { 'text-field': 'ODC', 'text-size': 11, 'text-offset': [0, -2], 'text-anchor': 'bottom' },
          paint: { 'text-color': '#7C3AED', 'text-halo-color': 'white', 'text-halo-width': 2 },
        });

        const odpCapacity =
          (
            args.baseTopology as {
              equipment?: { odp?: { capacity?: number | string } };
            }
          )?.equipment?.odp?.capacity ?? '?';

        safeAddSource('topo-odp', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: odpPositions.map(([lng, lat], i) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: { label: `ODP-${i + 1}`, capacity: odpCapacity },
            })),
          },
        });
        safeAddLayer({
          id: 'topo-odp-circle',
          type: 'circle',
          source: 'topo-odp',
          paint: {
            'circle-radius': 8,
            'circle-color': '#16A34A',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 2.5,
            'circle-opacity': 1.0,
          },
        });
        safeAddLayer({
          id: 'topo-odp-label',
          type: 'symbol',
          source: 'topo-odp',
          layout: {
            'text-field': ['concat', ['get', 'label'], '\n', '1:', ['to-string', ['get', 'capacity']]] as maplibregl.ExpressionSpecification,
            'text-size': 9,
            'text-offset': [0, 1.8],
            'text-anchor': 'top',
            'text-optional': true,
            'text-line-height': 1.2,
          },
          paint: { 'text-color': '#15803D', 'text-halo-color': 'white', 'text-halo-width': 1.5 },
        });

        // ── STEP ⑤: Homepass points (RESTORED from baseTopology) ────────
        const baseTopo = args.baseTopology as any;
        const homepassPoints = extractHomepassPoints(baseTopo, args.calcInputs);

        if (homepassPoints.length > 0) {
          safeAddSource('topo-homepass', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: homepassPoints.map((coords, idx) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: coords },
                properties: { kind: 'homepass', refId: `hp-${idx + 1}` },
              })),
            },
          });
          safeAddLayer({
            id: 'topo-homepass-circle',
            type: 'circle',
            source: 'topo-homepass',
            paint: {
              'circle-radius': 3.5,
              'circle-color': '#111827',
              'circle-stroke-width': 1,
              'circle-stroke-color': 'white',
            },
          });
          safeAddLayer({
            id: 'topo-homepass-label',
            type: 'symbol',
            source: 'topo-homepass',
            layout: {
              'text-field': 'HP',
              'text-size': 8,
              'text-offset': [0, -1.2],
              'text-anchor': 'bottom',
              'text-optional': true,
            },
            paint: {
              'text-color': '#111827',
              'text-halo-color': 'white',
              'text-halo-width': 1,
            },
          });
        }

        // JLM Issue 1/2/3A: enrich stored-design export — nearest-ODP assignment + coverage + cables
        const storedCapacity =
          typeof odpCapacity === 'number' ? odpCapacity : Number(odpCapacity) || 8;
        const storedCoverageM = 100; // drop-cable coverage from ODP
        const storedOdpLoad: number[] = odpPositions.map(() => 0);
        const storedHomepass = homepassPoints.map((coords) => {
          let bestIdx = -1;
          let bestDist = Infinity;
          odpPositions.forEach(([oLng, oLat], oi) => {
            const d = haversineM(coords[1], coords[0], oLat, oLng);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = oi;
            }
          });
          const covered = bestIdx >= 0 && bestDist <= storedCoverageM;
          if (covered) storedOdpLoad[bestIdx] += 1;
          return {
            lng: coords[0],
            lat: coords[1],
            isOsm: true,
            odpIndex: covered ? bestIdx + 1 : undefined,
            covered,
          };
        });
        setTopoExportData({
          backbone: oltCoords,
          odcPoint: odcCoords,
          odpPositions,
          homepassPoints: storedHomepass,
          feederCoords: feederCoords ?? undefined,
          distRoutes,
          odpLoad: storedOdpLoad,
          odpCapacity: storedCapacity,
        });
        setTopologyRendered(true);
        setLastRenderedGeometry({
          oltCoords,
          odcCoords,
          odpPositions,
          feederCoords: feederCoords ?? [],
          distRoutes,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error';
        toast.error(`Gagal render design tersimpan: ${msg}`);
        throw err;
      } finally {
        setRenderingTopology(false);
      }
    },
    [clearTopology],
  );

  /** Phase 2: wire to POST /api/design — stub for Phase 1. */
  const saveDesignAsDraft = useCallback(async () => {
    await Promise.resolve(undefined);
  }, []);

  return {
    renderingTopology,
    topologyRendered,
    topoExportData,
    lastRenderedGeometry,
    topoHandlersRef,
    clearTopology,
    renderTopology,
    renderStoredDesign,
    buildDesignGeometry,
    saveDesignAsDraft,
  };
}
