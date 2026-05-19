'use client';

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'; // FIX: MapLibre GIS page + Nominatim search
import maplibregl from 'maplibre-gl'; // FIX: vector map
import 'maplibre-gl/dist/maplibre-gl.css'; // FIX: default controls styling
import { apiGet, apiPost, apiPatch, apiDelete, API_BASE } from '../../lib/api'; // FIX: API base for topology proxy
import { useAuthStore } from '../../store/authStore'; // FIX: JWT for /map/route, /map/snap, /map/buildings
import { toast } from 'sonner'; // FIX: user feedback
import JSZip from 'jszip'; // FIX: KMZ unzip
import toGeoJSON from 'togeojson'; // FIX: KML → GeoJSON
import * as turf from '@turf/turf'; // FIX: analysis circle
import type { FeatureCollection, Geometry } from 'geojson'; // FIX: MapLibre GeoJSON + bounds helper

// FIX: extract every [lng, lat] from any GeoJSON geometry (module scope — not inside component)
function getAllCoordinates(geometry: Geometry | null | undefined): [number, number][] {
  if (!geometry) return []; // FIX
  const coords: [number, number][] = []; // FIX
  const extract = (c: unknown): void => {
    if (c == null) return; // FIX
    if (
      Array.isArray(c) &&
      c.length >= 2 &&
      typeof c[0] === 'number' &&
      typeof c[1] === 'number'
    ) {
      coords.push([c[0], c[1]]); // FIX: coordinate pair
      return; // FIX
    }
    if (Array.isArray(c)) {
      c.forEach((x) => extract(x)); // FIX: recurse nested rings / lines
    }
  }; // FIX
  if ('coordinates' in geometry && geometry.coordinates !== undefined) {
    extract(geometry.coordinates); // FIX
  }
  return coords; // FIX
}

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
): Promise<{ coordinates: [number, number][]; distanceM: number }> {
  try {
    const res = await fetch(`${apiBase}/map/route`, {
      method: 'POST', // FIX
      headers: {
        'Content-Type': 'application/json', // FIX
        Authorization: `Bearer ${token}`, // FIX
        'ngrok-skip-browser-warning': 'true', // FIX
      }, // FIX
      body: JSON.stringify({ fromLng, fromLat, toLng, toLat }), // FIX
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
      body: JSON.stringify({ waypoints }), // FIX
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

  // FIX: if route too short, add remaining at end
  while (positions.length < odpCount) {
    positions.push(routeCoords[routeCoords.length - 1]); // FIX
  }

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

  // FIX: get road routes from ODC to each direction
  const numDirections = Math.min(8, Math.max(4, Math.ceil(odpCount / 3))); // FIX
  const selectedDirs = ALL_DIRECTIONS.slice(0, numDirections); // FIX

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

  // FIX: pad if dedupe removed too many
  while (deduped.length < odpCount) {
    const last = deduped[deduped.length - 1] ?? ([odcLng, odcLat] as [number, number]); // FIX
    deduped.push(last); // FIX
  } // FIX

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

// FIX: calculate polygon area using Shoelace formula
function polygonAreaFromCoords(coords: [number, number][]): number {
  // FIX: use turf if available, else Shoelace
  try {
    const poly = turf.polygon([[...coords, coords[0]]]); // FIX
    return turf.area(poly); // FIX: returns m²
  } catch {
    // FIX: fallback Shoelace formula (approximate)
    const R = 6371000; // FIX
    let area = 0; // FIX
    const n = coords.length; // FIX
    for (let i = 0; i < n; i++) {
      const [lng1, lat1] = coords[i]; // FIX
      const [lng2, lat2] = coords[(i + 1) % n]; // FIX
      area +=
        ((lng2 - lng1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180)); // FIX
    } // FIX
    return Math.abs((area * R * R) / 2); // FIX
  } // FIX
} // FIX

// FIX: polygon centroid
function polygonCentroidFromCoords(coords: [number, number][]): [number, number] {
  try {
    const poly = turf.polygon([[...coords, coords[0]]]); // FIX
    const c = turf.centroid(poly); // FIX
    return c.geometry.coordinates as [number, number]; // FIX
  } catch {
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length; // FIX
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length; // FIX
    return [lng, lat]; // FIX
  } // FIX
} // FIX

// FIX: clear polygon from map
function clearPolygonFromMap(map: maplibregl.Map) {
  ['poly-line', 'poly-fill', 'poly-points'].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id); // FIX: layers before sources
  }); // FIX
  ['poly-fill', 'poly-points'].forEach((id) => {
    if (map.getSource(id)) map.removeSource(id); // FIX
  }); // FIX
} // FIX

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
  let minDist = Infinity; // FIX
  let nearest: [number, number] = boundary.points[0]; // FIX
  boundary.points.forEach(([px, py]) => {
    const d = haversineM(lat, lng, py, px); // FIX
    if (d < minDist) {
      minDist = d; // FIX
      nearest = [px, py]; // FIX
    }
  }); // FIX
  return nearest; // FIX
} // FIX

// FIX: max distance from center to polygon vertices (meters) — sampling radius for syntheticInsideBoundary
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

// FIX: export map as PNG image
async function exportMapImage(mapRef: RefObject<maplibregl.Map | null>, filename: string) {
  const map = mapRef.current; // FIX
  if (!map) throw new Error('Map not ready'); // FIX
  const canvas = map.getCanvas(); // FIX
  const dataUrl = canvas.toDataURL('image/png'); // FIX
  const a = document.createElement('a'); // FIX
  a.href = dataUrl; // FIX
  a.download = filename; // FIX
  document.body.appendChild(a); // FIX
  a.click(); // FIX
  document.body.removeChild(a); // FIX
} // FIX

// FIX: export topology GeoJSON as KMZ
async function exportKmz(
  topologyData: {
    backbone?: [number, number]; // FIX
    odcPoint?: [number, number]; // FIX
    odpPositions?: [number, number][]; // FIX
    homepassPoints?: Array<{ lng: number; lat: number; isOsm: boolean }>; // FIX
  }, // FIX
  filename: string, // FIX
) {
  const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${filename}</name>
<Style id="olt"><IconStyle><color>ffff0000</color></IconStyle></Style>
<Style id="odc"><IconStyle><color>ffaa00ff</color></IconStyle></Style>
<Style id="odp"><IconStyle><color>ff00aa00</color></IconStyle></Style>
<Style id="homepass"><IconStyle><color>ff00cc44</color></IconStyle></Style>
`; // FIX

  let kmlBody = ''; // FIX

  if (topologyData.odcPoint) {
    const [lng, lat] = topologyData.odcPoint; // FIX
    kmlBody += `<Placemark><name>ODC</name><styleUrl>#odc</styleUrl>
      <Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>\n`; // FIX
  } // FIX

  if (topologyData.odpPositions) {
    topologyData.odpPositions.forEach((pos: [number, number], i: number) => {
      kmlBody += `<Placemark><name>ODP-${i + 1}</name><styleUrl>#odp</styleUrl>
        <Point><coordinates>${pos[0]},${pos[1]},0</coordinates></Point></Placemark>\n`; // FIX
    }); // FIX
  } // FIX

  if (topologyData.homepassPoints) {
    topologyData.homepassPoints.forEach((hp, i: number) => {
      kmlBody += `<Placemark><name>HP-${i + 1}</name><styleUrl>#homepass</styleUrl>
        <description>Homepass (OSM)</description>
        <Point><coordinates>${hp.lng},${hp.lat},0</coordinates></Point></Placemark>\n`; // FIX
    }); // FIX
  } // FIX

  if (topologyData.backbone) {
    const [blng, blat] = topologyData.backbone; // FIX
    kmlBody += `<Placemark><name>OLT/Backbone</name><styleUrl>#olt</styleUrl>
      <description>Optical Line Terminal</description>
      <Point><coordinates>${blng},${blat},0</coordinates></Point></Placemark>\n`; // FIX
  } // FIX

  const kmlFooter = '</Document></kml>'; // FIX
  const kmlContent = kmlHeader + kmlBody + kmlFooter; // FIX

  const zip = new JSZip(); // FIX
  zip.file('doc.kml', kmlContent); // FIX
  const blob = await zip.generateAsync({ type: 'blob' }); // FIX
  const url = URL.createObjectURL(blob); // FIX
  const a = document.createElement('a'); // FIX
  a.href = url; // FIX
  a.download = `${filename}.kmz`; // FIX
  document.body.appendChild(a); // FIX
  a.click(); // FIX
  document.body.removeChild(a); // FIX
  URL.revokeObjectURL(url); // FIX
} // FIX

// FIX: complete PDF export with proper layout
async function exportPdf(
  type: 'pdf-map' | 'pdf-full', // FIX
  mapRef: RefObject<maplibregl.Map | null>, // FIX
  calcResult: any, // FIX
) {
  const { jsPDF } = await import('jspdf'); // FIX
  const ACCENT = [0, 212, 180] as [number, number, number]; // FIX: #00D4B4
  const DARK = [31, 41, 55] as [number, number, number]; // FIX: #1F2937
  const GRAY = [107, 114, 128] as [number, number, number]; // FIX
  const LIGHT_GRAY = [243, 244, 246] as [number, number, number]; // FIX

  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' }); // FIX
  const W = doc.internal.pageSize.getWidth(); // FIX
  const H = doc.internal.pageSize.getHeight(); // FIX
  const M = 14; // FIX: margin
  const CW = W - M * 2; // FIX: content width
  let pageNum = 1; // FIX

  // FIX: helper — draw page header
  const drawHeader = (title: string, pnum: number) => {
    doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]); // FIX: teal header bar
    doc.rect(0, 0, W, 14, 'F'); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setFontSize(11); // FIX
    doc.setTextColor(255, 255, 255); // FIX
    doc.text('PermaTrax — Kalkulasi Jaringan FTTH', M, 9.5); // FIX
    doc.setFontSize(9); // FIX
    doc.text(title, W - M, 9.5, { align: 'right' }); // FIX
    doc.setFontSize(7); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX: footer
    doc.text(`Generated: ${new Date().toLocaleString('id-ID')} | Halaman ${pnum}`, M, H - 4); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
  }; // FIX

  // FIX: helper — section title box
  const sectionTitle = (text: string, y: number): number => {
    doc.setFillColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]); // FIX
    doc.rect(M, y, CW, 7, 'F'); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setFontSize(9); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
    doc.text(text, M + 3, y + 5); // FIX
    return y + 10; // FIX
  }; // FIX

  // FIX: helper — key-value row
  const kvRow = (label: string, value: string, y: number, x = M, w = CW / 2): number => {
    doc.setFont('helvetica', 'normal'); // FIX
    doc.setFontSize(9); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
    doc.text(label, x, y); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
    doc.text(value, x + w * 0.55, y); // FIX
    return y + 6; // FIX
  }; // FIX

  // FIX: ─── PAGE 1: MAP ─────────────────────────────
  drawHeader('Peta Jaringan', pageNum); // FIX

  const map = mapRef.current; // FIX
  if (map) {
    const canvas = map.getCanvas(); // FIX
    const imgData = canvas.toDataURL('image/jpeg', 0.92); // FIX: JPEG for smaller PDF
    const imgH = H - 22; // FIX: leave room for header + footer
    doc.addImage(imgData, 'JPEG', M, 17, CW, imgH); // FIX
  } else {
    doc.setFillColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]); // FIX: placeholder
    doc.rect(M, 17, CW, H - 22, 'F'); // FIX
    doc.setFont('helvetica', 'normal'); // FIX
    doc.setFontSize(12); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
    doc.text('Map tidak tersedia', W / 2, H / 2, { align: 'center' }); // FIX
  } // FIX

  if (type === 'pdf-full' && calcResult) {
    const s = calcResult.summary || {}; // FIX
    const hp = calcResult.homepass || {}; // FIX
    const rt = calcResult.route || {}; // FIX
    const cab = calcResult.cable || {}; // FIX
    const eq = calcResult.equipment || {}; // FIX
    const pb = calcResult.powerBudget || {}; // FIX

    // FIX: ─── PAGE 2: SUMMARY + EQUIPMENT ─────────────
    doc.addPage(); // FIX
    pageNum++; // FIX
    drawHeader('Ringkasan & Kebutuhan Perangkat', pageNum); // FIX

    let y = 20; // FIX

    const colW = (CW - 8) / 2; // FIX
    y = sectionTitle('Ringkasan Area', y); // FIX: ASCII section label for PDF font
    y = kvRow('Tipe Area', String(s.areaType || '-'), y, M, colW); // FIX
    y = kvRow('Kategori', `Kategori ${s.areaCategory || '-'}`, y, M, colW); // FIX
    y = kvRow('Homepass Estimasi', `${hp.estimated || 0} unit`, y, M, colW); // FIX
    y = kvRow(
      'Homepass Aktif',
      `${hp.active || 0} unit (${hp.takeRatePercent || 0}%)`,
      y,
      M,
      colW,
    ); // FIX
    y = kvRow('Total Route', `${((rt.totalM || 0) / 1000).toFixed(2)} km`, y, M, colW); // FIX
    y = kvRow('Total Kabel', `${((cab.totalM || 0) / 1000).toFixed(2)} km`, y, M, colW); // FIX
    y = kvRow('Backbone Distance', `${s.backboneDistanceM || 0} m`, y, M, colW); // FIX
    y = kvRow('Backbone Owner', String(s.backboneOwner || '-'), y, M, colW); // FIX

    y += 6; // FIX
    y = sectionTitle('Optical Power Budget', y); // FIX
    y = kvRow('GPON Class', String(pb.gponClass || 'Class B+ (28 dBm)'), y, M, colW); // FIX
    y = kvRow(
      'Cadangan Daya',
      `${pb.linkMarginDB || 0} dB ${pb.isOk ? 'OK' : 'Kurang'}`,
      y,
      M,
      colW,
    ); // FIX
    y = kvRow('Total Rugi Optik', `${pb.totalLossDB || 0} dB`, y, M, colW); // FIX
    y = kvRow('Splitter Loss', `${pb.breakdown?.splitterDB ?? 0} dB`, y, M, colW); // FIX
    y = kvRow('Serat Feeder', `${pb.breakdown?.seratFeederDB ?? 0} dB`, y, M, colW); // FIX
    y = kvRow('Konektor', `${pb.breakdown?.konektorDB ?? 0} dB`, y, M, colW); // FIX

    const rx = M + colW + 8; // FIX: RIGHT COLUMN
    let ry = 20; // FIX
    ry = sectionTitle('Kebutuhan Perangkat', ry); // FIX

    const eqRows: [string, string][] = [
      [
        'OLT',
        `1 unit (${eq.olt?.portsNeeded ?? 0} port) — ${eq.olt?.recommendation ?? ''}`,
      ], // FIX
      [`ODC ${eq.odc?.capacity ?? ''}`, `${eq.odc?.count ?? 0} unit`], // FIX
      [
        `ODP ${eq.odp?.capacity ?? ''}P`,
        `${eq.odp?.count ?? 0} unit (spacing ${eq.odp?.spacingM ?? 0}m)`,
      ], // FIX
      [`Splitter ${eq.splitter?.ratio ?? ''}`, `${eq.splitter?.count ?? 0} unit`], // FIX
      [
        'Closure',
        `${eq.closure?.total ?? 0} unit (${eq.closure?.inline ?? 0} inline)`,
      ], // FIX
      [
        'Tiang',
        `${eq.pole?.total ?? 0} unit (${eq.pole?.newBuild ?? 0} baru + ${eq.pole?.existing ?? 0} existing)`,
      ], // FIX
      ['Splice', `${eq.splice?.total ?? 0} titik`], // FIX
      ['Connector SC/APC', `${eq.connector?.count ?? 0} unit`], // FIX
      ['ONT/CPE', `${eq.ont?.count ?? 0} unit`], // FIX
    ]; // FIX
    eqRows.forEach(([label, value]) => {
      ry = kvRow(label, value, ry, rx, colW); // FIX
    }); // FIX

    ry += 6; // FIX
    ry = sectionTitle('Rincian Kabel', ry); // FIX
    ry = kvRow(
      'Feeder (OLT-ODC)',
      `${cab.breakdown?.feederM ?? 0} m — ${cab.feederCableType ?? ''}`,
      ry,
      rx,
      colW,
    ); // FIX
    ry = kvRow('Distribusi (ODC-ODP)', `${cab.breakdown?.distributionM ?? 0} m`, ry, rx, colW); // FIX
    ry = kvRow('Drop (ODP-ONT)', `${cab.breakdown?.dropM ?? 0} m`, ry, rx, colW); // FIX
    ry = kvRow('Buffer 15%', 'sudah termasuk', ry, rx, colW); // FIX
    ry = kvRow('TOTAL', `${((cab.totalM || 0) / 1000).toFixed(2)} km`, ry, rx, colW); // FIX

    // FIX: ─── PAGE 3: ROI 3 TIER ───────────────────────
    if (calcResult.roi?.tiers) {
      doc.addPage(); // FIX
      pageNum++; // FIX
      drawHeader('Estimasi ROI — 3 Segmen Pasar', pageNum); // FIX

      y = 20; // FIX
      const roi = calcResult.roi; // FIX
      const tiers = roi.tiers || []; // FIX

      doc.setFillColor(255, 251, 235); // FIX
      doc.setDrawColor(253, 230, 138); // FIX
      doc.rect(M, y, CW, 14, 'FD'); // FIX: Overall summary box
      doc.setFont('helvetica', 'bold'); // FIX
      doc.setFontSize(10); // FIX
      doc.setTextColor(146, 64, 14); // FIX
      doc.text(
        `Total Revenue/bulan: Rp ${((roi.totalMonthlyRevenue || 0) / 1e6).toFixed(1)}M  |  ` +
          `Overall BEP: ${roi.overallBepMonths || 0} bulan (${roi.overallBepYears || 0} tahun)  |  ` +
          `Take Rate Total: ${roi.totalTakeRatePct || 0}%`,
        W / 2,
        y + 9,
        { align: 'center' },
      ); // FIX
      y += 18; // FIX

      const tierW = (CW - 10) / 3; // FIX
      const TIER_COLORS: Record<string, [number, number, number]> = {
        Basic: [59, 130, 246], // FIX
        Standard: [0, 212, 180], // FIX
        Premium: [139, 92, 246], // FIX
      }; // FIX

      tiers.forEach((tier: any, i: number) => {
        const tx = M + i * (tierW + 5); // FIX
        const tc = TIER_COLORS[tier.name] || ACCENT; // FIX
        const tHeight = 80; // FIX

        doc.setDrawColor(tc[0], tc[1], tc[2]); // FIX
        doc.setLineWidth(0.8); // FIX
        doc.rect(tx, y, tierW, tHeight); // FIX

        doc.setFillColor(tc[0], tc[1], tc[2]); // FIX
        doc.rect(tx, y, tierW, 12, 'F'); // FIX
        doc.setFont('helvetica', 'bold'); // FIX
        doc.setFontSize(11); // FIX
        doc.setTextColor(255, 255, 255); // FIX
        doc.text(tier.name, tx + tierW / 2, y + 8, { align: 'center' }); // FIX

        const viableText = tier.isViable ? 'Viable' : 'Review'; // FIX: ASCII for jsPDF
        doc.setFontSize(7); // FIX
        doc.setFont('helvetica', 'normal'); // FIX
        doc.text(viableText, tx + tierW - 2, y + 8, { align: 'right' }); // FIX

        doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
        let ty = y + 18; // FIX
        const addMetric = (label: string, value: string, highlight = false) => {
          doc.setFont('helvetica', highlight ? 'bold' : 'normal'); // FIX
          doc.setFontSize(8); // FIX
          doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
          doc.text(label, tx + 3, ty); // FIX
          doc.setFont('helvetica', 'bold'); // FIX
          if (highlight) {
            doc.setTextColor(tc[0], tc[1], tc[2]); // FIX
          } else {
            doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
          } // FIX
          doc.setFontSize(highlight ? 10 : 9); // FIX
          doc.text(value, tx + tierW - 3, ty, { align: 'right' }); // FIX
          ty += highlight ? 8 : 7; // FIX
          doc.setFontSize(8); // FIX
        }; // FIX

        addMetric('ARPU/bulan', `Rp ${(tier.arpu / 1000).toFixed(0)}k`); // FIX
        addMetric('Take Rate', `${tier.takeRatePct}%`); // FIX
        addMetric('Active Homepass', `${tier.activeHomepass} unit`); // FIX
        addMetric('Revenue/bulan', `Rp ${(tier.monthlyRevenue / 1e6).toFixed(1)}M`, true); // FIX
        const annRev = tier.annualRevenue ?? tier.monthlyRevenue * 12; // FIX
        addMetric('Revenue/tahun', `Rp ${(annRev / 1e6).toFixed(0)}M`); // FIX
        addMetric('BEP', `${tier.breakEvenMonths} bulan`, true); // FIX
      }); // FIX

      y += 90; // FIX

      y = sectionTitle('Ringkasan Investasi', y); // FIX
      const ce = calcResult.costEstimation || {}; // FIX
      y = kvRow('Total Material', `Rp ${((ce.totalMaterial || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow('Total Instalasi', `Rp ${((ce.totalInstall || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow('TOTAL PROYEK', `Rp ${((ce.totalProject || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow(
        'Cost per Homepass',
        `Rp ${(ce.costPerHomepass || 0).toLocaleString('id-ID')}`,
        y,
      ); // FIX
    } // FIX

    // FIX: ─── PAGE 4: RECOMMENDATIONS ─────────────────
    if (calcResult.recommendations?.length) {
      doc.addPage(); // FIX
      pageNum++; // FIX
      drawHeader('Rekomendasi Detail', pageNum); // FIX

      y = 20; // FIX
      const recs: any[] = calcResult.recommendations; // FIX

      recs.forEach((r: any) => {
        if (y > H - 30) {
          doc.addPage(); // FIX
          pageNum++; // FIX
          drawHeader('Rekomendasi Detail (lanjutan)', pageNum); // FIX
          y = 20; // FIX
        } // FIX

        const title = typeof r === 'string' ? r : r.title || ''; // FIX
        const detail = typeof r === 'string' ? '' : r.detail || ''; // FIX
        const sev = typeof r === 'string' ? 'info' : r.severity || 'info'; // FIX

        const sevColor: Record<string, [number, number, number]> = {
          success: [34, 197, 94], // FIX
          warning: [245, 158, 11], // FIX
          error: [239, 68, 68], // FIX
          info: [59, 130, 246], // FIX
        }; // FIX
        const sc = sevColor[sev] || sevColor.info; // FIX

        doc.setFillColor(sc[0], sc[1], sc[2]); // FIX
        doc.rect(M, y, 2, detail ? 14 : 8, 'F'); // FIX

        doc.setFont('helvetica', 'bold'); // FIX
        doc.setFontSize(9); // FIX
        doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
        const cleanTitle =
          title.replace(/[^\x00-\x7F]/g, '').trim() || // FIX
          title.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim(); // FIX: strip BMP-surrogate emoji without /u flag
        doc.text(cleanTitle || title, M + 5, y + 5.5); // FIX

        if (detail) {
          doc.setFont('helvetica', 'normal'); // FIX
          doc.setFontSize(8); // FIX
          doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
          const cleanDetail = detail.replace(/[^\x00-\x7F\s]/g, '').trim(); // FIX
          const lines = doc.splitTextToSize(cleanDetail || detail, CW - 8); // FIX
          const showLines = lines.slice(0, 2); // FIX
          doc.text(showLines, M + 5, y + 11); // FIX
          y += 18 + Math.max(0, (showLines.length - 1) * 4); // FIX
        } else {
          y += 12; // FIX
        } // FIX
      }); // FIX
    } // FIX
  } // FIX

  doc.save(`permatrax-ftth-${new Date().toISOString().slice(0, 10)}.pdf`); // FIX
} // FIX

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
  'topo-drop-line', // FIX
  'topo-homepass-circle', // FIX: reserved id if used
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

// ── TYPES ──────────────────────────────────────────────
interface ClusterPin {
  id: string; // FIX
  clusterCode: string; // FIX
  ispCustomer: string; // FIX
  fiberType: string; // FIX
  phase: string; // FIX
  status: string; // FIX
  latitude: number | null; // FIX
  longitude: number | null; // FIX
  rwName: string | null; // FIX
  areaCategory: string | null; // FIX
  siteName: string | null; // FIX
  isDone: boolean; // FIX
  homepasCount: number; // FIX
  doneAt?: string | null; // FIX
}

interface GisLayer {
  id: string; // FIX
  name: string; // FIX
  geoJson: FeatureCollection; // FIX
  color: string; // FIX
  isVisible: boolean; // FIX
}

interface NominatimResult {
  display_name: string; // FIX
  lat: string; // FIX
  lon: string; // FIX
  type?: string; // FIX
  class?: string; // FIX
}

// FIX: shape of POST /map/calculate response (enhanced FTTH topology)
type FtthCalcApiResponse = {
  summary: {
    areaCategory: 'A' | 'B' | 'C'; // FIX
    categoryReason: string; // FIX
    backboneOwner: string; // FIX
    backboneDistanceM: number; // FIX
    areaType: string; // FIX
    areaRadiusMeters?: number; // FIX
    coverageRadiusMeters?: number; // FIX: equiv. radius for topology (polygon)
    polygonAreaSqM?: number; // FIX
    polygonCentroidLat?: number; // FIX
    polygonCentroidLon?: number; // FIX
  }; // FIX
  roi?: {
    tiers: Array<{
      name: string; // FIX
      arpu: number; // FIX
      takeRatePct: number; // FIX
      activeHomepass: number; // FIX
      monthlyRevenue: number; // FIX
      annualRevenue: number; // FIX
      breakEvenMonths: number; // FIX
      breakEvenYears: number; // FIX
      color: string; // FIX
      isViable: boolean; // FIX
    }>; // FIX
    totalTakeRatePct: number; // FIX
    totalActiveHomepass: number; // FIX
    totalMonthlyRevenue: number; // FIX
    totalAnnualRevenue: number; // FIX
    overallBepMonths: number; // FIX
    overallBepYears: number; // FIX
    currency: string; // FIX
  }; // FIX
  homepass: { estimated: number; active: number; takeRatePercent: number }; // FIX
  route: { totalM: number; feederM: number; distributionM: number }; // FIX
  cable: {
    totalM: number; // FIX
    feederCableType: string; // FIX
    distCableType: string; // FIX
    dropCableType: string; // FIX
    installMethod: string; // FIX
    installReason: string; // FIX
    breakdown: {
      feederM: number; // FIX
      distributionM: number; // FIX
      dropM: number; // FIX
      bufferPercent: number; // FIX
    }; // FIX
  }; // FIX
  equipment: {
    olt: { recommendation: string; portsNeeded: number; standard: string }; // FIX
    odc: { count: number; capacity: string; unit: string }; // FIX
    odp: { count: number; capacity: number; spacingM: number; unit: string }; // FIX
    splitter: { count: number; ratio: string; unit: string }; // FIX
    closure: { inline: number; total: number; unit: string }; // FIX
    pole: {
      total: number; // FIX
      existing: number; // FIX
      newBuild: number; // FIX
      spacingM: number; // FIX
      unit: string; // FIX
      note: string; // FIX
    }; // FIX
    splice: { total: number; plan: unknown[]; unit: string }; // FIX
    connector: { count: number; type: string; unit: string }; // FIX
    patchCord: { count: number; type: string; unit: string }; // FIX
    ont: { count: number; type: string; unit: string }; // FIX
    jointBox: { count: number; unit: string }; // FIX
    hdpeConduit: { meters: number; type: string; unit: string }; // FIX
  }; // FIX
  topology: {
    description: string; // FIX
    segments: Array<{
      name: string; // FIX
      from: string; // FIX
      to: string; // FIX
      distance: string; // FIX
      cable: string; // FIX
      notes?: string; // FIX
    }>; // FIX
    standards: string[]; // FIX
    selected?: {
      // FIX: auto-selected topology from API
      type: string; // FIX
      label: string; // FIX
      description: string; // FIX
      pros: string[]; // FIX
      cons: string[]; // FIX
      suitability: number; // FIX
    }; // FIX
  }; // FIX
  powerBudget: {
    gponClass: string; // FIX
    linkMarginDB: number; // FIX
    isOk: boolean; // FIX
    totalLossDB: number; // FIX
    breakdown: {
      splitterDB: number; // FIX
      seratFeederDB: number; // FIX
      konektorDB: number; // FIX
      sambunganDB: number; // FIX
      seratDistDB: number; // FIX
      seratDropDB: number; // FIX
    }; // FIX
  }; // FIX
  costEstimation: {
    currency: string; // FIX
    note: string; // FIX
    breakdown: Array<{ item: string; qty: string; idr: number }>; // FIX
    totalMaterial: number; // FIX
    totalInstall: number; // FIX
    totalProject: number; // FIX
    costPerHomepass: number; // FIX
    roi: {
      revenuePerHpPerMonth: number; // FIX
      monthlyRevenue: number; // FIX
      breakEvenMonths: number; // FIX
      tiers?: Array<{
        name: string; // FIX
        arpu: number; // FIX
        takeRatePct: number; // FIX
        activeHomepass: number; // FIX
        monthlyRevenue: number; // FIX
        breakEvenMonths: number; // FIX
        isViable: boolean; // FIX
        color: string; // FIX
      }>; // FIX
    }; // FIX
  }; // FIX
  installation: {
    method: string; // FIX
    totalDuration: string; // FIX
    sequence: Array<{
      step: number; // FIX
      title: string; // FIX
      tasks: string[]; // FIX
      duration: string; // FIX
    }>; // FIX
  }; // FIX
  recommendations: Array<{
    icon: string; // FIX
    title: string; // FIX
    detail: string; // FIX
    severity: 'info' | 'success' | 'warning' | 'error'; // FIX
  }>; // FIX
}; // FIX

// ── TILE LAYERS ─────────────────────────────────────────
const TILE_LAYERS = {
  osm: {
    label: 'OpenStreetMap', // FIX
    icon: '🗺️', // FIX
    style: {
      version: 8 as const, // FIX
      sources: {
        osm: {
          type: 'raster' as const, // FIX
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], // FIX
          tileSize: 256, // FIX
          attribution: '© OpenStreetMap contributors', // FIX
          maxzoom: 19, // FIX
        },
      },
      layers: [
        {
          id: 'osm', // FIX
          type: 'raster' as const, // FIX
          source: 'osm', // FIX
        },
      ],
    },
  },
  satellite: {
    label: 'Satelit', // FIX
    icon: '🛰️', // FIX
    style: {
      version: 8 as const, // FIX
      sources: {
        satellite: {
          type: 'raster' as const, // FIX
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ], // FIX
          tileSize: 256, // FIX
          attribution: '© Esri World Imagery', // FIX
          maxzoom: 18, // FIX
        },
      },
      layers: [
        {
          id: 'satellite', // FIX
          type: 'raster' as const, // FIX
          source: 'satellite', // FIX
        },
      ],
    },
  },
};

// ── CATEGORY CONFIG ─────────────────────────────────────
const CATEGORY_CONFIG = {
  A: {
    label: 'Kategori A', // FIX
    color: '#EF4444', // FIX
    bg: '#EF444420', // FIX
    desc: 'High Priority (>200 homepass, backbone <500m)', // FIX
  },
  B: {
    label: 'Kategori B', // FIX
    color: '#F59E0B', // FIX
    bg: '#F59E0B20', // FIX
    desc: 'Medium Priority (80-200 homepass)', // FIX
  },
  C: {
    label: 'Kategori C', // FIX
    color: '#22C55E', // FIX
    bg: '#22C55E20', // FIX
    desc: 'Low Priority (<80 homepass)', // FIX
  },
};

// ── PHASE COLOR MAP ─────────────────────────────────────
const getPhaseColor = (phase: string, isDone: boolean): string => {
  if (isDone) return '#22C55E'; // FIX: hijau untuk DONE
  const colors: Record<string, string> = {
    SITE_VISIT: '#3B82F6', // FIX
    SURVEY_INPUT: '#3B82F6', // FIX
    SIP_REQUEST: '#8B5CF6', // FIX
    HLD_SUBMISSION: '#F59E0B', // FIX
    LLD_SUBMISSION: '#F59E0B', // FIX
    PR_BR_ISSUANCE: '#EF4444', // FIX
    SKOM_BUDGET: '#EF4444', // FIX
    PERMIT_DONE: '#22C55E', // FIX
  };
  return colors[phase] || '#6B7280'; // FIX
};

type OsmElement = { tags?: Record<string, string> }; // FIX: Overpass element shape

export default function GisMapPage() {
  const mapRef = useRef<maplibregl.Map | null>(null); // FIX
  const clusterReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // FIX: Sprint 2 — debounce cluster fetch on pan/zoom
  const mapContainer = useRef<HTMLDivElement>(null); // FIX
  const markersRef = useRef<maplibregl.Marker[]>([]); // FIX
  const backboneMarkerRef = useRef<maplibregl.Marker | null>(null); // FIX: calc backbone pin
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null); // FIX: calc target pin
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // FIX: Nominatim debounce

  const [mapType, setMapType] = useState<'osm' | 'satellite'>('osm'); // FIX
  const [styleEpoch, setStyleEpoch] = useState(0); // FIX: re-pin markers + KMZ after setStyle
  const [clusters, setClusters] = useState<ClusterPin[]>([]); // FIX
  const [layers, setLayers] = useState<GisLayer[]>([]); // FIX
  const [loading, setLoading] = useState(true); // FIX
  const [activePanel, setActivePanel] = useState<'layers' | 'calc' | 'legend' | null>('legend'); // FIX

  const [searchQuery, setSearchQuery] = useState(''); // FIX: Nominatim query
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]); // FIX
  const [searchLoading, setSearchLoading] = useState(false); // FIX
  const [showSearchDrop, setShowSearchDrop] = useState(false); // FIX

  const [calcMode, setCalcMode] = useState<'idle' | 'backbone' | 'target' | 'result'>('idle'); // FIX
  const [backbonePoint, setBackbonePoint] = useState<[number, number] | null>(null); // FIX
  const [targetPoint, setTargetPoint] = useState<[number, number] | null>(null); // FIX
  const [areaType, setAreaType] = useState<'URBAN' | 'SUBURBAN' | 'RURAL'>('URBAN'); // FIX
  const [areaRadius, setAreaRadius] = useState(300); // FIX
  const [calcResult, setCalcResult] = useState<FtthCalcApiResponse | null>(null); // FIX
  const [calculating, setCalculating] = useState(false); // FIX

  const [uploadingKmz, setUploadingKmz] = useState(false); // FIX

  const [nearestBackbone, setNearestBackbone] = useState<OsmElement | null>(null); // FIX

  // FIX: topology rendering state
  const [renderingTopology, setRenderingTopology] = useState(false); // FIX
  const [topologyRendered, setTopologyRendered] = useState(false); // FIX

  // FIX: dual input mode
  const [inputMode, setInputMode] = useState<'radius' | 'polygon'>('radius'); // FIX
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]); // FIX
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false); // FIX
  const [polygonAreaSqM, setPolygonAreaSqM] = useState<number | null>(null); // FIX
  const [polygonCentroid, setPolygonCentroid] = useState<[number, number] | null>(null); // FIX
  const polygonMarkersRef = useRef<maplibregl.Marker[]>([]); // FIX

  // FIX: store topology data for export
  const [topoExportData, setTopoExportData] = useState<{
    backbone?: [number, number]; // FIX
    odcPoint?: [number, number]; // FIX
    odpPositions?: [number, number][]; // FIX
    homepassPoints?: Array<{ lng: number; lat: number; isOsm: boolean }>; // FIX
  } | null>(null); // FIX

  // FIX: export state
  const [exporting, setExporting] = useState(false); // FIX

  // FIX: registered OSRM/topology map handlers (must off before remove layers)
  const topoHandlersRef = useRef<
    Array<{
      layerId: string; // FIX
      ev: 'click' | 'mouseenter' | 'mouseleave'; // FIX
      fn: (e: maplibregl.MapLayerMouseEvent) => void; // FIX
    }>
  >([]); // FIX

  const loadData = useCallback(async (mapInstance?: maplibregl.Map | null) => {
    try {
      const m = mapInstance ?? mapRef.current;
      let clustersPath = '/map/clusters?limit=200';
      if (m) {
        const b = m.getBounds();
        clustersPath = `/map/clusters?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&limit=200`;
      }
      const [clustersData, layersData] = await Promise.all([
        apiGet<ClusterPin[]>(clustersPath),
        apiGet<GisLayer[]>('/map/layers?limit=200'),
      ]);
      setClusters(clustersData || []); // FIX
      setLayers(
        (layersData || []).map((L) => ({
          ...L,
          isVisible: L.isVisible !== false, // FIX
        })),
      ); // FIX
    } catch {
      // FIX: map tetap bisa dipakai tanpa API
    } finally {
      setLoading(false); // FIX
    }
  }, []);

  // FIX: debounced Nominatim search (OSM — identify app per usage policy)
  const handleSearchInput = useCallback((val: string) => {
    setSearchQuery(val); // FIX
    setShowSearchDrop(true); // FIX
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); // FIX
    if (!val.trim() || val.length < 2) {
      setSearchResults([]); // FIX
      return; // FIX
    }
    searchTimeoutRef.current = setTimeout(() => {
      void (async () => {
        setSearchLoading(true); // FIX
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=6&addressdetails=1`,
            {
              headers: {
                'Accept-Language': 'id,en', // FIX
                'User-Agent': 'PermaTrax-GIS/1.0 (internal; contact: support@permatrax.local)', // FIX: Nominatim policy
              },
            },
          ); // FIX
          const data = (await res.json()) as NominatimResult[]; // FIX
          setSearchResults(Array.isArray(data) ? data : []); // FIX
        } catch {
          setSearchResults([]); // FIX
        } finally {
          setSearchLoading(false); // FIX
        }
      })();
    }, 500); // FIX: 500ms debounce
  }, []);

  // FIX: fly to selected Nominatim result
  const handleSearchSelect = useCallback((result: NominatimResult) => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    const lat = parseFloat(result.lat); // FIX
    const lon = parseFloat(result.lon); // FIX
    map.flyTo({
      center: [lon, lat], // FIX
      zoom: 15, // FIX
      duration: 1200, // FIX
      essential: true, // FIX
    }); // FIX
    setSearchQuery(result.display_name.split(',').slice(0, 2).join(',')); // FIX
    setShowSearchDrop(false); // FIX
    setSearchResults([]); // FIX
  }, []);

  // FIX: update layer color (API may reject extra fields — then update locally only)
  const handleColorChange = useCallback(async (layerId: string, newColor: string, isVisible: boolean) => {
    try {
      await apiPatch(`/map/layers/${layerId}/visibility`, {
        isVisible, // FIX
        color: newColor, // FIX: backend may ignore — ValidationPipe may error
      }); // FIX
    } catch {
      // FIX: expected if backend only allows isVisible
    }
    setLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, color: newColor } : l))); // FIX: always refresh map paint
  }, []);

  // FIX: delete KMZ layer via API + remove map layers/sources
  const handleDeleteLayer = useCallback(async (layerId: string, layerName: string) => {
    if (!confirm(`Hapus layer "${layerName}"?`)) return; // FIX
    try {
      await apiDelete(`/map/layers/${layerId}`); // FIX
      const map = mapRef.current; // FIX
      if (map) {
        const ids = [
          `kmz-line-${layerId}`, // FIX
          `kmz-fill-${layerId}`, // FIX
          `kmz-fill-${layerId}-outline`, // FIX
          `kmz-circle-${layerId}`, // FIX
          `kmz-symbol-${layerId}`, // FIX
        ]; // FIX
        ids.forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id); // FIX
        }); // FIX
        const src = `kmz-${layerId}`; // FIX
        if (map.getSource(src)) map.removeSource(src); // FIX
      }
      setLayers((prev) => prev.filter((l) => l.id !== layerId)); // FIX
      toast.success(`Layer "${layerName}" dihapus`); // FIX
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error'; // FIX
      toast.error(`Gagal hapus: ${msg}`); // FIX
    }
  }, []);

  // ── Init map ───────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return; // FIX

    const map = new maplibregl.Map({
      container: mapContainer.current, // FIX
      style: TILE_LAYERS.osm.style, // FIX
      center: [106.8456, -6.2088], // FIX: Jakarta default
      zoom: 11, // FIX
      maxZoom: 19, // FIX
      preserveDrawingBuffer: true, // FIX: required for canvas.toDataURL() to work
    }); // FIX

    map.addControl(new maplibregl.NavigationControl(), 'top-right'); // FIX
    // FIX: remove ScaleControl — causes white bar at bottom
    map.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true }), // FIX
      'top-right',
    ); // FIX

    mapRef.current = map; // FIX

    const onMoveEnd = () => {
      if (clusterReloadTimerRef.current) clearTimeout(clusterReloadTimerRef.current);
      clusterReloadTimerRef.current = setTimeout(() => {
        clusterReloadTimerRef.current = null;
        void loadData(map);
      }, 300);
    };

    map.on('load', () => {
      void loadData(map);
    });
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('moveend', onMoveEnd);
      if (clusterReloadTimerRef.current) clearTimeout(clusterReloadTimerRef.current);
      map.remove(); // FIX
      mapRef.current = null; // FIX
    };
  }, [loadData]);

  // ── Render cluster markers ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map || !map.isStyleLoaded()) return; // FIX

    markersRef.current.forEach((m) => m.remove()); // FIX
    markersRef.current = []; // FIX

    clusters
      .filter(
        (c) =>
          c.latitude != null &&
          c.longitude != null &&
          !Number.isNaN(c.latitude) &&
          !Number.isNaN(c.longitude),
      ) // FIX: hanya pin valid
      .forEach((cluster) => {
        const color = getPhaseColor(cluster.phase, cluster.isDone); // FIX
        const category = cluster.areaCategory || 'C'; // FIX
        const catCfg =
          CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.C; // FIX

        const el = document.createElement('div'); // FIX
        el.style.cssText = `
          width: 32px; height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: ${color};
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          cursor: pointer;
          position: relative;
        `; // FIX

        const badge = document.createElement('div'); // FIX
        badge.style.cssText = `
          position: absolute;
          top: -2px; right: -2px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: ${catCfg.color};
          color: white;
          font-size: 8px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(45deg);
          border: 1px solid white;
        `; // FIX
        badge.textContent = category; // FIX
        el.appendChild(badge); // FIX

        const popup = new maplibregl.Popup({
          offset: 25, // FIX
          maxWidth: '280px', // FIX
        }).setHTML(`
          <div style="font-family:sans-serif;padding:4px">
            <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:4px">
              ${cluster.clusterCode}
            </div>
            <div style="font-size:12px;color:#666;margin-bottom:8px">
              ${cluster.siteName || cluster.rwName || ''}
              ${cluster.ispCustomer ? `· ${cluster.ispCustomer}` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                font-weight:600;background:${color}20;color:${color}">
                ${cluster.phase?.replace(/_/g, ' ')}
              </span>
              <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                font-weight:600;background:${catCfg.bg};color:${catCfg.color}">
                ${catCfg.label}
              </span>
              ${
                cluster.isDone
                  ? `
                <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                  font-weight:600;background:#22C55E20;color:#22C55E">
                  🟢 DONE (ISP Approved)
                </span>
              `
                  : ''
              }
            </div>
            <div style="font-size:11px;color:#888">
              📡 ${cluster.fiberType} · 🏠 ${cluster.homepasCount ?? '?'} homepass
            </div>
            ${cluster.doneAt ? `<div style="font-size:10px;color:#6B7280;margin-top:4px">Selesai: ${new Date(cluster.doneAt).toLocaleDateString('id-ID')}</div>` : ''}
            ${
              cluster.latitude != null
                ? `
              <div style="font-size:10px;color:#aaa;margin-top:4px">
                ${cluster.latitude.toFixed(5)}, ${cluster.longitude?.toFixed(5)}
              </div>
            `
                : ''
            }
            ${cluster.isDone ? `<a href="/document-list/${cluster.id}" style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:8px;background:#22C55E15;color:#16A34A;font-size:11px;font-weight:700;text-decoration:none">View BAKP Document</a>` : ''}
          </div>
        `); // FIX

        const marker = new maplibregl.Marker({ element: el }) // FIX
          .setLngLat([cluster.longitude!, cluster.latitude!]) // FIX
          .setPopup(popup) // FIX
          .addTo(map); // FIX

        markersRef.current.push(marker); // FIX
      });
  }, [clusters, styleEpoch]); // FIX: re-render markers when style changes

  // ── Render KMZ layers (line + fill + outline + circle + symbol) ──
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map || !map.isStyleLoaded()) return; // FIX

    const pointFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['Point', 'MultiPoint'],
      true,
      false,
    ]; // FIX

    const lineFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['LineString', 'MultiLineString'],
      true,
      false,
    ]; // FIX

    const polyFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['Polygon', 'MultiPolygon'],
      true,
      false,
    ]; // FIX

    type KmzHandlers = {
      circleId: string; // FIX
      onClick: (e: maplibregl.MapLayerMouseEvent) => void; // FIX
      onEnter: () => void; // FIX
      onLeave: () => void; // FIX
    }; // FIX
    const kmzHandlers: KmzHandlers[] = []; // FIX

    layers.forEach((layer) => {
      const sourceId = `kmz-${layer.id}`; // FIX
      const lineId = `kmz-line-${layer.id}`; // FIX
      const fillId = `kmz-fill-${layer.id}`; // FIX
      const fillOutlineId = `${fillId}-outline`; // FIX
      const circleId = `kmz-circle-${layer.id}`; // FIX
      const symbolId = `kmz-symbol-${layer.id}`; // FIX

      ;[lineId, fillId, fillOutlineId, circleId, symbolId].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id); // FIX
      }); // FIX
      if (map.getSource(sourceId)) map.removeSource(sourceId); // FIX

      if (!layer.isVisible || !layer.geoJson) return; // FIX

      map.addSource(sourceId, {
        type: 'geojson', // FIX
        data: layer.geoJson as FeatureCollection, // FIX
      }); // FIX

      const features = layer.geoJson.features || []; // FIX
      const hasPoint = features.some(
        (f) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint',
      ); // FIX
      const hasLine = features.some(
        (f) =>
          f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
      ); // FIX
      const hasPolygon = features.some(
        (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
      ); // FIX

      if (hasPoint) {
        map.addLayer({
          id: circleId, // FIX
          type: 'circle', // FIX
          source: sourceId, // FIX
          filter: pointFilter, // FIX
          paint: {
            'circle-radius': 7, // FIX
            'circle-color': layer.color, // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 2, // FIX
            'circle-opacity': 0.9, // FIX
          },
        }); // FIX

        map.addLayer({
          id: symbolId, // FIX
          type: 'symbol', // FIX
          source: sourceId, // FIX
          filter: pointFilter, // FIX
          layout: {
            'text-field': [
              'coalesce',
              ['get', 'name'],
              ['get', 'Name'],
              ['get', 'description'],
              '',
            ] as maplibregl.ExpressionSpecification, // FIX: KML props
            'text-size': 11, // FIX
            'text-offset': [0, 1.5], // FIX
            'text-anchor': 'top', // FIX
            'text-optional': true, // FIX
          },
          paint: {
            'text-color': '#111', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 1.5, // FIX
          },
        }); // FIX

        const onClick = (e: maplibregl.MapLayerMouseEvent) => {
          if (!e.features?.length) return; // FIX
          const props = (e.features[0].properties || {}) as Record<string, unknown>; // FIX
          const nameRaw = props.name ?? props.Name ?? props.description ?? 'KMZ Point'; // FIX
          const name = String(nameRaw); // FIX
          const descRaw = props.description; // FIX
          const desc = descRaw != null ? String(descRaw) : ''; // FIX
          new maplibregl.Popup() // FIX
            .setLngLat(e.lngLat) // FIX
            .setHTML(`
          <div style="font-family:sans-serif;padding:4px">
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:4px">
              ${name}
            </div>
            ${
              desc && desc !== name
                ? `<div style="font-size:11px;color:#6B7280">${desc}</div>`
                : ''
            }
            <div style="font-size:10px;color:#9CA3AF;margin-top:4px">
              Layer: ${layer.name}
            </div>
          </div>
        `) // FIX
            .addTo(map); // FIX
        }; // FIX
        const onEnter = () => {
          map.getCanvas().style.cursor = 'pointer'; // FIX
        }; // FIX
        const onLeave = () => {
          map.getCanvas().style.cursor = ''; // FIX
        }; // FIX
        map.on('click', circleId, onClick); // FIX
        map.on('mouseenter', circleId, onEnter); // FIX
        map.on('mouseleave', circleId, onLeave); // FIX
        kmzHandlers.push({ circleId, onClick, onEnter, onLeave }); // FIX
      }

      if (hasLine) {
        map.addLayer({
          id: lineId, // FIX
          type: 'line', // FIX
          source: sourceId, // FIX
          filter: lineFilter, // FIX
          paint: {
            'line-color': layer.color, // FIX
            'line-width': 2.5, // FIX
            'line-opacity': 0.85, // FIX
          },
        }); // FIX
      }

      if (hasPolygon) {
        map.addLayer({
          id: fillId, // FIX
          type: 'fill', // FIX
          source: sourceId, // FIX
          filter: polyFilter, // FIX
          paint: {
            'fill-color': layer.color, // FIX
            'fill-opacity': 0.18, // FIX
          },
        }); // FIX

        map.addLayer({
          id: fillOutlineId, // FIX
          type: 'line', // FIX
          source: sourceId, // FIX
          filter: polyFilter, // FIX
          paint: {
            'line-color': layer.color, // FIX
            'line-width': 1.5, // FIX
            'line-opacity': 0.7, // FIX
          },
        }); // FIX
      }
    });

    return () => {
      kmzHandlers.forEach(({ circleId, onClick, onEnter, onLeave }) => {
        map.off('click', circleId, onClick); // FIX
        map.off('mouseenter', circleId, onEnter); // FIX
        map.off('mouseleave', circleId, onLeave); // FIX
      }); // FIX
    }; // FIX
  }, [layers, styleEpoch]); // FIX: re-render when style changes

  // ── Switch map type ─────────────────────────────────────
  const switchMapType = useCallback((type: 'osm' | 'satellite') => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    setMapType(type); // FIX
    map.setStyle(TILE_LAYERS[type].style); // FIX
    map.once('style.load', () => {
      // FIX: bump styleEpoch to trigger ALL layer useEffects
      setStyleEpoch((prev) => prev + 1); // FIX
      // FIX: small delay to ensure style fully loaded
      setTimeout(() => {
        setStyleEpoch((prev) => prev + 1); // FIX
      }, 200); // FIX
    }); // FIX
  }, []);

  // ── KMZ Upload handler ─────────────────────────────────
  const handleKmzUpload = useCallback(async (file: File) => {
    if (!file.name.match(/\.(kmz|kml)$/i)) {
      toast.error('Hanya file .kmz atau .kml yang didukung'); // FIX
      return; // FIX
    }
    setUploadingKmz(true); // FIX
    try {
      let kmlText: string; // FIX

      if (file.name.toLowerCase().endsWith('.kmz')) {
        const zip = await JSZip.loadAsync(file); // FIX
        const kmlFile = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml')); // FIX
        if (!kmlFile) throw new Error('KMZ tidak mengandung file KML'); // FIX
        kmlText = await kmlFile.async('text'); // FIX
      } else {
        kmlText = await file.text(); // FIX
      }

      const parser = new DOMParser(); // FIX
      const kmlDom = parser.parseFromString(kmlText, 'text/xml'); // FIX
      const geoJson = toGeoJSON.kml(kmlDom) as FeatureCollection; // FIX

      if (!geoJson.features?.length) {
        throw new Error('KMZ tidak mengandung data yang dapat ditampilkan'); // FIX
      }

      const colors = ['#FF6B00', '#9B59B6', '#2980B9', '#27AE60', '#E74C3C']; // FIX
      const color = colors[Math.floor(Math.random() * colors.length)]; // FIX

      const saved = await apiPost<GisLayer>('/map/layers', {
        name: file.name.replace(/\.(kmz|kml)$/i, ''), // FIX
        fileUrl: '', // FIX: optional file storage later
        geoJson, // FIX
        color, // FIX
      }); // FIX

      setLayers((prev) => [...prev, { ...saved, isVisible: saved.isVisible !== false }]); // FIX
      toast.success(`✅ ${file.name} berhasil diupload (${geoJson.features.length} fitur)`); // FIX

      if (geoJson.features?.length > 0) {
        try {
          let minLng = 180; // FIX
          let maxLng = -180; // FIX
          let minLat = 90; // FIX
          let maxLat = -90; // FIX
          geoJson.features.forEach((feature) => {
            const coords = getAllCoordinates(feature.geometry as Geometry | null | undefined); // FIX
            coords.forEach(([lng, lat]) => {
              minLng = Math.min(minLng, lng); // FIX
              maxLng = Math.max(maxLng, lng); // FIX
              minLat = Math.min(minLat, lat); // FIX
              maxLat = Math.max(maxLat, lat); // FIX
            }); // FIX
          }); // FIX
          if (minLng < 180 && mapRef.current) {
            mapRef.current.fitBounds(
              [
                [minLng, minLat],
                [maxLng, maxLat],
              ], // FIX
              { padding: 60, duration: 1000, maxZoom: 16 }, // FIX
            ); // FIX
          }
        } catch {
          // FIX: silently fail if bounds calc fails
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'; // FIX
      toast.error(`Upload gagal: ${msg}`); // FIX
    } finally {
      setUploadingKmz(false); // FIX
    }
  }, []);

  // ── Calculation mode ────────────────────────────────────
  const clearCalcGraphics = useCallback(() => {
    const map = mapRef.current; // FIX
    backboneMarkerRef.current?.remove(); // FIX
    backboneMarkerRef.current = null; // FIX
    targetMarkerRef.current?.remove(); // FIX
    targetMarkerRef.current = null; // FIX
    if (map) {
      if (map.getLayer('calc-circle-fill')) map.removeLayer('calc-circle-fill'); // FIX
      if (map.getLayer('calc-circle-line')) map.removeLayer('calc-circle-line'); // FIX
      if (map.getSource('calc-circle')) map.removeSource('calc-circle'); // FIX
    }
  }, []);

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
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || API_BASE || 'http://localhost:3001/api'; // FIX
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

        // ── STEP ①: Snap ODC to nearest road ────────────
        toast.info('① Menempatkan ODC ke jalan terdekat...'); // FIX
        const odcSnapped = await backendSnap(apiBase, authToken, target[0], target[1]); // FIX
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

        // ── STEP ③: ODP placement along roads (linear) ──
        toast.info(`③ Menghitung posisi ${odpCount} ODP di sepanjang jalan...`); // FIX

        // FIX: use road-following distribution instead of spokes
        const { positions: rawOdpPositions, routes: spokeRoutes } = await computeOdpAlongRoads(
          apiBase, // FIX
          authToken, // FIX
          odcLng, // FIX
          odcLat, // FIX
          odpCount, // FIX
          spacingM, // FIX
          radiusM, // FIX
        ); // FIX

        // FIX: snap each ODP to nearest road
        toast.info('③ Snap ODP ke jalan...'); // FIX
        const snappedOdps = await Promise.all(
          rawOdpPositions.map(([lng, lat]) => backendSnap(apiBase, authToken, lng, lat)), // FIX
        ); // FIX

        // FIX: verify each ODP is inside polygon boundary
        const odpPositions = snappedOdps.map((odp) => verifyOdpInBoundary(odp, boundary)); // FIX

        // ── STEP ④: Distribution — cascade chain routing ──
        toast.info('④ Menghitung jalur distribusi (cascade)...'); // FIX

        // FIX: use cascade routing instead of star from ODC
        const cascadeRoutes = buildCascadeRoutes(
          [odcSnappedLng, odcSnappedLat], // FIX
          odpPositions, // FIX
          spokeRoutes || [], // FIX
          spacingM, // FIX
        ); // FIX

        // FIX: get actual road routes for cascade segments
        const distRouteResults = await Promise.allSettled(
          cascadeRoutes.map(([from, to]) =>
            backendRoute(apiBase, authToken, from[0], from[1], to[0], to[1]), // FIX
          ), // FIX
        ); // FIX

        const distRoutes: [number, number][][] = distRouteResults.map((r, i) =>
          r.status === 'fulfilled' && r.value?.coordinates?.length
            ? r.value.coordinates
            : ([cascadeRoutes[i][0], cascadeRoutes[i][1]] as [number, number][]), // FIX
        ); // FIX

        // ── STEP ⑤: Get ALL buildings in polygon area ──
        toast.info('⑤ Mengambil bangunan OSM dalam area...'); // FIX

        let queryRadius = radiusM + 200; // FIX: larger default capture radius
        if (drawnPolygon && drawnPolygon.length >= 3) {
          queryRadius =
            Math.max(
              ...drawnPolygon.map(([lng, lat]) =>
                haversineM(target[1], target[0], lat, lng), // FIX: centroid to vertex
              ),
            ) + 100; // FIX
        } // FIX
        queryRadius = Math.min(queryRadius, 2000); // FIX

        const osmBuildingsRaw = await backendBuildings(
          apiBase, // FIX
          authToken, // FIX
          target[1], // FIX
          target[0], // FIX
          queryRadius, // FIX
        ); // FIX

        const osmBuildings = osmBuildingsRaw.filter((b) => {
          if (boundary.type === 'polygon') {
            return isPointInPolygon(b.lng, b.lat, boundary.points); // FIX
          }
          return isPointInCircle(
            b.lng, // FIX
            b.lat, // FIX
            boundary.centerLng, // FIX
            boundary.centerLat, // FIX
            boundary.radiusM, // FIX
          ); // FIX
        }); // FIX

        const buildingToOdp = new Map<number, number>(); // FIX: building idx → nearest ODP
        osmBuildings.forEach((b, bi) => {
          let minDist = Infinity; // FIX
          let nearest = 0; // FIX
          odpPositions.forEach(([oLng, oLat], oi) => {
            const d = haversineM(b.lat, b.lng, oLat, oLng); // FIX
            if (d < minDist) {
              minDist = d; // FIX
              nearest = oi; // FIX
            }
          }); // FIX
          buildingToOdp.set(bi, nearest); // FIX
        }); // FIX

        type OsmBld = (typeof osmBuildings)[number]; // FIX
        const odpBuildings = new Map<number, OsmBld[]>(); // FIX
        odpPositions.forEach((_, i) => odpBuildings.set(i, [])); // FIX
        osmBuildings.forEach((b, bi) => {
          const odpIdx = buildingToOdp.get(bi) ?? 0; // FIX
          odpBuildings.get(odpIdx)?.push(b); // FIX
        }); // FIX

        const allHomepass: Array<{
          coords: [number, number]; // FIX
          odpIdx: number; // FIX
        }> = []; // FIX

        odpPositions.forEach((odp, odpIdx) => {
          const assigned = odpBuildings.get(odpIdx) || []; // FIX
          assigned.forEach((b) => {
            allHomepass.push({
              coords: [b.lng, b.lat], // FIX: OSM only — no synthetic
              odpIdx, // FIX
            }); // FIX
          }); // FIX
        }); // FIX

        const validHomepass = allHomepass; // FIX
        const osmCount = validHomepass.length; // FIX

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
            'line-color': '#2563EB', // FIX: feeder blue
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
              },
            })), // FIX
          },
        }); // FIX
        safeAddLayer({
          id: 'topo-dist-line', // FIX
          type: 'line', // FIX
          source: 'topo-distribution', // FIX
          paint: {
            'line-color': '#00D4B4', // FIX: distribusi teal
            'line-width': 2.5, // FIX
            'line-opacity': 0.85, // FIX
          },
        }); // FIX

        safeAddSource('topo-drop', {
          type: 'geojson', // FIX
          data: {
            type: 'FeatureCollection', // FIX
            features: validHomepass.map((hp) => ({
              type: 'Feature', // FIX
              geometry: {
                type: 'LineString', // FIX
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
            'line-color': '#86EFAC', // FIX: drop light green
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

        // FIX: tiang — always attempt to render if aerial route
        const poleSpacingM = result.equipment?.pole?.spacingM || 45; // FIX
        const installMethod = result.cable?.installMethod || ''; // FIX

        if (
          installMethod.includes('Aerial') || // FIX
          installMethod.includes('aerial') || // FIX
          (result.equipment?.pole?.total || 0) > 0 // FIX
        ) {
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
              properties: { odpIndex: hp.odpIdx + 1 }, // FIX
            })), // FIX
          },
        }); // FIX

        safeAddLayer({
          id: 'topo-ont-circle', // FIX
          type: 'circle', // FIX
          source: 'topo-homepass', // FIX
          paint: {
            'circle-radius': 5, // FIX: homepass medium green
            'circle-color': '#22C55E', // FIX
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
              '1:',
              ['to-string', ['get', 'capacity']], // FIX: show splitter ratio
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

        // FIX: store for KMZ export
        setTopoExportData({
          backbone, // FIX
          odcPoint: [odcLng, odcLat], // FIX
          odpPositions, // FIX
          homepassPoints: validHomepass.map((h) => ({
            lng: h.coords[0], // FIX
            lat: h.coords[1], // FIX
            isOsm: true, // FIX: OSM buildings only
          })), // FIX
        }); // FIX

        setTopologyRendered(true); // FIX
        toast.success(
          `✅ Topologi selesai: ${odpPositions.length} ODP, ` + // FIX
            `${osmCount} homepass (bangunan OSM)`, // FIX
        ); // FIX
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error'; // FIX
        toast.error(`Gagal render topologi: ${msg}`); // FIX
      } finally {
        setRenderingTopology(false); // FIX
      }
    },
    [clearTopology, inputMode, polygonPoints],
  );

  const startCalculation = useCallback(() => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    clearCalcGraphics(); // FIX
    clearTopology(); // FIX
    setCalcMode('backbone'); // FIX
    setBackbonePoint(null); // FIX
    setTargetPoint(null); // FIX
    setCalcResult(null); // FIX
    setNearestBackbone(null); // FIX
    toast.info('📍 Klik pada peta untuk menandai titik BACKBONE terdekat'); // FIX
  }, [clearCalcGraphics, clearTopology]);

  // FIX: polygon mode starts drawing instead
  const handleStartCalc = useCallback(() => {
    if (inputMode === 'polygon') {
      setIsDrawingPolygon(true); // FIX
      setPolygonPoints([]); // FIX
      setPolygonAreaSqM(null); // FIX
      setPolygonCentroid(null); // FIX
      polygonMarkersRef.current.forEach((mk) => mk.remove()); // FIX
      polygonMarkersRef.current = []; // FIX
      const map = mapRef.current; // FIX
      if (map) clearPolygonFromMap(map); // FIX
      setCalcMode('idle'); // FIX: backbone only after polygon closed
      toast.info(
        '🔷 Mode polygon: klik titik-titik area. Double-click untuk selesai, lalu klik backbone.', // FIX
      ); // FIX
    } else {
      startCalculation(); // FIX
    } // FIX
  }, [inputMode, startCalculation]);

  // FIX: polygon drawing click handler
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map || !isDrawingPolygon) return; // FIX

    let lastClickTime = 0; // FIX

    const handlePolyClick = (e: maplibregl.MapMouseEvent) => {
      const now = Date.now(); // FIX
      const { lng, lat } = e.lngLat; // FIX

      if (now - lastClickTime < 300) {
        setPolygonPoints((prev) => {
          if (prev.length >= 3) {
            const area = polygonAreaFromCoords(prev); // FIX
            const centroid = polygonCentroidFromCoords(prev); // FIX
            setPolygonAreaSqM(area); // FIX
            setPolygonCentroid(centroid); // FIX
            setIsDrawingPolygon(false); // FIX
            setCalcMode('backbone'); // FIX

            const closedCoords = [...prev, prev[0]]; // FIX
            clearPolygonFromMap(map); // FIX

            map.addSource('poly-fill', {
              type: 'geojson', // FIX
              data: {
                type: 'Feature', // FIX
                geometry: { type: 'Polygon', coordinates: [closedCoords] }, // FIX
                properties: {}, // FIX
              },
            }); // FIX
            map.addLayer({
              id: 'poly-fill', // FIX
              type: 'fill', // FIX
              source: 'poly-fill', // FIX
              paint: { 'fill-color': '#EF4444', 'fill-opacity': 0.15 }, // FIX
            }); // FIX
            map.addLayer({
              id: 'poly-line', // FIX
              type: 'line', // FIX
              source: 'poly-fill', // FIX
              paint: {
                'line-color': '#EF4444', // FIX
                'line-width': 2, // FIX
                'line-dasharray': [3, 3], // FIX
              },
            }); // FIX

            toast.success(
              `✅ Area polygon: ${
                area > 1_000_000
                  ? `${(area / 1_000_000).toFixed(3)} km²`
                  : `${Math.round(area).toLocaleString('id-ID')} m²`
              }`, // FIX
            ); // FIX
            toast.info('📡 Sekarang klik titik BACKBONE di peta'); // FIX
          } else {
            toast.warning('Minimal 3 titik untuk membuat polygon'); // FIX
          } // FIX
          return prev; // FIX
        }); // FIX
        lastClickTime = 0; // FIX: reset so triple-click does not chain
        return; // FIX
      } // FIX

      lastClickTime = now; // FIX

      const el = document.createElement('div'); // FIX
      el.style.cssText = `
      width: 10px; height: 10px; border-radius: 50%;
      background: #EF4444; border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    `; // FIX
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map); // FIX
      polygonMarkersRef.current.push(marker); // FIX

      setPolygonPoints((prev) => {
        const newPoints = [...prev, [lng, lat] as [number, number]]; // FIX

        if (newPoints.length >= 2) {
          clearPolygonFromMap(map); // FIX
          const previewCoords = [...newPoints]; // FIX
          map.addSource('poly-fill', {
            type: 'geojson', // FIX
            data: {
              type: 'Feature', // FIX
              geometry: { type: 'LineString', coordinates: previewCoords }, // FIX
              properties: {}, // FIX
            },
          }); // FIX
          map.addLayer({
            id: 'poly-line', // FIX
            type: 'line', // FIX
            source: 'poly-fill', // FIX
            paint: {
              'line-color': '#EF4444', // FIX
              'line-width': 2, // FIX
              'line-dasharray': [3, 3], // FIX
            },
          }); // FIX
        } // FIX
        return newPoints; // FIX
      }); // FIX
    }; // FIX

    map.on('click', handlePolyClick); // FIX
    map.getCanvas().style.cursor = 'crosshair'; // FIX

    return () => {
      map.off('click', handlePolyClick); // FIX
      map.getCanvas().style.cursor = ''; // FIX
    }; // FIX
  }, [isDrawingPolygon]);

  // FIX: Map click handler for calculation
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX

    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      if (isDrawingPolygon) return; // FIX: polygon drawing takes precedence
      if (calcMode === 'idle') return; // FIX
      const { lng, lat } = e.lngLat; // FIX

      if (calcMode === 'backbone') {
        backboneMarkerRef.current?.remove(); // FIX
        setBackbonePoint([lng, lat]); // FIX
        setCalcMode('target'); // FIX

        const m = new maplibregl.Marker({ color: '#3B82F6' }) // FIX
          .setLngLat([lng, lat]) // FIX
          .setPopup(new maplibregl.Popup().setText('📡 Titik Backbone')) // FIX
          .addTo(map); // FIX
        backboneMarkerRef.current = m; // FIX

        try {
          const backbone = await apiGet<unknown[]>(
            `/map/fiber-backbone?lat=${lat}&lon=${lng}&radius=3000`,
          ); // FIX
          if (backbone?.length > 0) {
            setNearestBackbone(backbone[0] as OsmElement); // FIX
            toast.success(`📡 Ditemukan ${backbone.length} jalur backbone di OSM`); // FIX
          } else {
            toast.info('📡 Tidak ada backbone di OSM — gunakan titik yang Anda pilih'); // FIX
          }
        } catch {
          // FIX: tetap lanjut tanpa Overpass
        }

        toast.info('🎯 Sekarang klik area TARGET yang ingin dipasang FTTH'); // FIX
      } else if (calcMode === 'target') {
        targetMarkerRef.current?.remove(); // FIX
        setTargetPoint([lng, lat]); // FIX
        setCalcMode('result'); // FIX

        const tm = new maplibregl.Marker({ color: '#EF4444' }) // FIX
          .setLngLat([lng, lat]) // FIX
          .setPopup(new maplibregl.Popup().setText('🎯 Area Target')) // FIX
          .addTo(map); // FIX
        targetMarkerRef.current = tm; // FIX

        if (inputMode === 'radius') {
          const circle = turf.circle([lng, lat], areaRadius / 1000, {
            steps: 64, // FIX
            units: 'kilometers', // FIX
          }); // FIX

          const circleSourceId = 'calc-circle'; // FIX
          if (map.getLayer('calc-circle-fill')) map.removeLayer('calc-circle-fill'); // FIX
          if (map.getLayer('calc-circle-line')) map.removeLayer('calc-circle-line'); // FIX
          if (map.getSource(circleSourceId)) map.removeSource(circleSourceId); // FIX

          map.addSource(circleSourceId, { type: 'geojson', data: circle }); // FIX
          map.addLayer({
            id: 'calc-circle-fill', // FIX
            type: 'fill', // FIX
            source: circleSourceId, // FIX
            paint: { 'fill-color': '#EF4444', 'fill-opacity': 0.1 }, // FIX
          }); // FIX
          map.addLayer({
            id: 'calc-circle-line', // FIX
            type: 'line', // FIX
            source: circleSourceId, // FIX
            paint: {
              'line-color': '#EF4444', // FIX
              'line-width': 2, // FIX
              'line-dasharray': [3, 3], // FIX
            },
          }); // FIX
        }
      }
    }; // FIX

    map.on('click', handleClick); // FIX
    return () => {
      map.off('click', handleClick); // FIX
    };
  }, [calcMode, areaRadius, isDrawingPolygon, inputMode]);

  // ── Run calculation ─────────────────────────────────────
  const runCalculation = useCallback(async () => {
    if (!backbonePoint || !targetPoint) {
      toast.error('Pilih titik backbone dan target terlebih dahulu'); // FIX
      return; // FIX
    } // FIX
    if (inputMode === 'polygon' && (!polygonAreaSqM || polygonAreaSqM <= 0)) {
      toast.error('Gambar polygon area terlebih dahulu'); // FIX
      return; // FIX
    } // FIX
    setCalculating(true); // FIX
    try {
      const tags = nearestBackbone?.tags; // FIX
      const result = await apiPost<FtthCalcApiResponse>('/map/calculate', {
        targetLat: targetPoint[1], // FIX
        targetLon: targetPoint[0], // FIX
        backboneLat: backbonePoint[1], // FIX
        backboneLon: backbonePoint[0], // FIX
        areaType, // FIX
        areaRadiusMeters: areaRadius, // FIX
        backboneOwner: tags?.operator || tags?.name || 'OSM Data', // FIX
        polygonAreaSqM: inputMode === 'polygon' ? polygonAreaSqM ?? undefined : undefined, // FIX
        polygonCentroidLat:
          inputMode === 'polygon' && polygonCentroid ? polygonCentroid[1] : undefined, // FIX
        polygonCentroidLon:
          inputMode === 'polygon' && polygonCentroid ? polygonCentroid[0] : undefined, // FIX
      }); // FIX
      setCalcResult(result); // FIX
      toast.success('✅ Kalkulasi selesai!'); // FIX
      if (backbonePoint && targetPoint) {
        await renderTopology(
          result, // FIX
          backbonePoint, // FIX
          targetPoint, // FIX
          inputMode === 'polygon' && polygonPoints.length >= 3 ? polygonPoints : null, // FIX
        ); // FIX
      } // FIX
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error'; // FIX
      toast.error(`Kalkulasi gagal: ${msg}`); // FIX
    } finally {
      setCalculating(false); // FIX
    } // FIX
  }, [
    backbonePoint, // FIX
    targetPoint, // FIX
    areaType, // FIX
    areaRadius, // FIX
    nearestBackbone, // FIX
    inputMode, // FIX
    polygonAreaSqM, // FIX
    polygonCentroid, // FIX
    polygonPoints, // FIX
    renderTopology, // FIX
  ]);

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 60px)',
      }}
    >
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .maplibregl-popup-content {
          border-radius: 10px !important;
          padding: 8px 12px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
        }
        .maplibregl-popup-close-button {
          font-size: 16px !important;
          padding: 2px 6px !important;
        }
        /* FIX: hide scale bar white background */
        .maplibregl-ctrl-scale {
          display: none !important;
        }
        /* FIX: hide white attribution bar at bottom */
        /* FIX: hide bottom bar completely */
        .maplibregl-ctrl-bottom-left,
        .maplibregl-ctrl-bottom-right {
          display: none !important;
        }
        .maplibregl-ctrl-attrib {
          display: none !important;
        }
        /* FIX: hide default maplibre logo bar */
        .maplibregl-ctrl-logo {
          display: none !important;
        }
        /* FIX: ensure map fills container with no white bar */
        .maplibregl-map {
          background: transparent !important;
        }
        .maplibregl-canvas-container,
        .maplibregl-canvas {
          display: block !important;
        }
      `}</style>

      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {topologyRendered && calcResult && (
        <div
          style={{
            position: 'absolute', // FIX
            bottom: 40, // FIX
            right: 12, // FIX
            zIndex: 10, // FIX
            background: 'white', // FIX
            borderRadius: 10, // FIX
            overflow: 'hidden', // FIX
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)', // FIX
            minWidth: 180, // FIX
          }}
        >
          <div
            style={{
              padding: '6px 12px', // FIX
              background: '#F9FAFB', // FIX
              borderBottom: '1px solid #E5E7EB', // FIX
              fontSize: 10, // FIX
              fontWeight: 700, // FIX
              color: '#374151', // FIX
              textTransform: 'uppercase', // FIX
              letterSpacing: '0.05em', // FIX
            }}
          >
            🔧 Equipment di Peta
          </div>
          {[
            { icon: '📡', label: 'OLT', value: '1 unit', color: '#1D4ED8' }, // FIX
            {
              icon: '🟣', // FIX
              label: 'ODC', // FIX
              value: `${calcResult.equipment.odc.count} unit`, // FIX
              color: '#7C3AED', // FIX
            },
            {
              icon: '🟢', // FIX
              label: 'ODP', // FIX
              value: `${calcResult.equipment.odp.count} unit`, // FIX
              color: '#16A34A', // FIX
            },
            {
              icon: '🟡', // FIX
              label: 'Closure', // FIX
              value: `${calcResult.equipment.closure.total} unit`, // FIX
              color: '#F59E0B', // FIX
            },
            {
              icon: '🏠', // FIX
              label: 'Homepass', // FIX
              value: `${calcResult.homepass.estimated} est.`, // FIX
              color: '#22C55E', // FIX
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                justifyContent: 'space-between', // FIX
                padding: '5px 12px', // FIX
                borderBottom: '1px solid #F3F4F6', // FIX
                fontSize: 11, // FIX
              }}
            >
              <span style={{ color: item.color, fontWeight: 600 }}>
                {item.icon} {item.label}
              </span>
              <span style={{ fontWeight: 700, color: '#111' }}>{item.value}</span>
            </div>
          ))}
          <div style={{ padding: '5px 12px' }}>
            <button
              type="button"
              onClick={() => setActivePanel('legend')}
              style={{
                width: '100%', // FIX
                padding: '4px', // FIX
                borderRadius: 5, // FIX
                border: '1px solid #E5E7EB', // FIX
                background: 'none', // FIX
                cursor: 'pointer', // FIX
                fontSize: 10, // FIX
                color: '#6B7280', // FIX
              }}
            >
              Lihat Legenda →
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          width: 340,
        }}
      >
        <div
          style={{
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
            overflow: 'visible',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>🔍</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearchDrop(true)}
              placeholder="Cari lokasi... (misal: GBK, Monas)"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: '#111',
                background: 'transparent',
              }}
            />
            {searchLoading && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  flexShrink: 0,
                  border: '2px solid #00D4B4',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }}
              />
            )}
            {searchQuery && !searchLoading && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setShowSearchDrop(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 16,
                  color: '#9CA3AF',
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>

          {showSearchDrop && searchResults.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'white',
                borderRadius: '0 0 10px 10px',
                boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                maxHeight: 280,
                overflowY: 'auto',
                zIndex: 100,
                marginTop: 2,
              }}
            >
              {searchResults.map((result, i) => (
                <div
                  key={`${result.lat}-${result.lon}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSearchSelect(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchSelect(result);
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom:
                      i < searchResults.length - 1 ? '1px solid #F3F4F6' : 'none',
                    cursor: 'pointer',
                    transition: 'background 150ms',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = '#F9FAFB';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'white';
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                    {result.type === 'city'
                      ? '🏙️'
                      : result.type === 'village'
                        ? '🏘️'
                        : result.type === 'suburb'
                          ? '🏘️'
                          : result.type === 'stadium'
                            ? '🏟️'
                            : result.type === 'park'
                              ? '🌳'
                              : result.class === 'highway'
                                ? '🛣️'
                                : result.class === 'building'
                                  ? '🏢'
                                  : '📍'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                        lineHeight: 1.4,
                      }}
                    >
                      {result.display_name.split(',')[0]}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginTop: 1,
                        lineHeight: 1.3,
                      }}
                    >
                      {result.display_name.split(',').slice(1, 3).join(',')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}
        >
          {(['osm', 'satellite'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => switchMapType(type)}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                border: 'none',
                background: mapType === type ? '#00D4B4' : 'transparent',
                color: mapType === type ? 'white' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 150ms',
              }}
            >
              {TILE_LAYERS[type].icon} {TILE_LAYERS[type].label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: 'white',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}
        >
          {[
            { key: 'legend' as const, label: '🏷️ Legenda' },
            { key: 'layers' as const, label: '📂 KMZ Layers' },
            { key: 'calc' as const, label: '🧮 Kalkulasi' },
          ].map((panel) => (
            <button
              key={panel.key}
              type="button"
              onClick={() =>
                setActivePanel(activePanel === panel.key ? null : panel.key)
              }
              style={{
                padding: '8px 14px',
                border: 'none',
                textAlign: 'left',
                background:
                  activePanel === panel.key ? '#00D4B410' : 'transparent',
                color: activePanel === panel.key ? '#00D4B4' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                borderLeft:
                  activePanel === panel.key
                    ? '3px solid #00D4B4'
                    : '3px solid transparent',
                transition: 'all 150ms',
              }}
            >
              {panel.label}
            </button>
          ))}
        </div>
      </div>

      {activePanel && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 200,
            width: 300,
            maxHeight: 'calc(100vh - 120px)',
            background: 'white',
            borderRadius: 14,
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #F3F4F6',
              background: '#F9FAFB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
              {activePanel === 'legend' && '🏷️ Legenda Peta'}
              {activePanel === 'layers' && '📂 KMZ Layers'}
              {activePanel === 'calc' && '🧮 Kalkulasi FTTH'}
            </span>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: 'none',
                background: '#E5E7EB',
                cursor: 'pointer',
                fontSize: 14,
                color: '#6B7280',
              }}
            >
              ×
            </button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {activePanel === 'legend' && (
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#6B7280',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Kategori Area
                  </div>
                  {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: cfg.bg,
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: cfg.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'white',
                        }}
                      >
                        {key}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: cfg.color,
                          }}
                        >
                          {cfg.label}
                        </div>
                        <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                          {cfg.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#6B7280',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Status Fase
                  </div>
                  {[
                    { color: '#3B82F6', label: 'Survey / Input' },
                    { color: '#8B5CF6', label: 'SIP Request' },
                    { color: '#F59E0B', label: 'HLD / LLD' },
                    { color: '#EF4444', label: 'PR/BR / SKOM' },
                    { color: '#22C55E', label: 'Permit Done (ISP Approved)' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 5,
                      }}
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: item.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12, color: '#374151' }}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#16A34A',
                      marginBottom: 8,
                    }}
                  >
                    📊 Statistik
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#374151',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div>
                      Total cluster: <strong>{clusters.length}</strong>
                    </div>
                    <div>
                      Punya koordinat:{' '}
                      <strong>
                        {
                          clusters.filter(
                            (c) => c.latitude != null && c.longitude != null,
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      Permit Done:{' '}
                      <strong>{clusters.filter((c) => c.isDone).length}</strong>{' '}
                      (green pin)
                    </div>
                    <div>
                      Layer KMZ: <strong>{layers.length}</strong>
                    </div>
                  </div>
                </div>

                {/* FIX: Topology legend (shown after calculation) */}
                {topologyRendered && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 11, // FIX
                        fontWeight: 700, // FIX
                        color: '#6B7280', // FIX
                        marginBottom: 8, // FIX
                        textTransform: 'uppercase' as const, // FIX
                        letterSpacing: '0.05em', // FIX
                      }}
                    >
                      Topologi FTTH
                    </div>
                    {[
                      { color: '#1D4ED8', size: 13, label: 'OLT / Backbone', type: 'circle' as const }, // FIX
                      { color: '#2563EB', size: 3, label: 'Kabel Feeder', type: 'line' as const }, // FIX
                      { color: '#7C3AED', size: 11, label: 'ODC (Kabinet)', type: 'circle' as const }, // FIX
                      { color: '#00D4B4', size: 2, label: 'Kabel Distribusi', type: 'line' as const }, // FIX
                      { color: '#16A34A', size: 8, label: 'ODP (Splitter)', type: 'circle' as const }, // FIX
                      { color: '#86EFAC', size: 1, label: 'Kabel Drop', type: 'line' as const }, // FIX
                      { color: '#22C55E', size: 5, label: 'Homepass', type: 'circle' as const }, // FIX
                      { color: '#F59E0B', size: 5, label: 'Closure', type: 'circle' as const }, // FIX
                      { color: '#9CA3AF', size: 3, label: 'Tiang', type: 'circle' as const }, // FIX
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: 'flex', // FIX
                          alignItems: 'center', // FIX
                          gap: 8, // FIX
                          marginBottom: 5, // FIX
                        }}
                      >
                        {item.type === 'circle' ? (
                          <div
                            style={{
                              width: item.size * 1.5, // FIX
                              height: item.size * 1.5, // FIX
                              borderRadius: '50%', // FIX
                              background: item.color, // FIX
                              flexShrink: 0, // FIX
                              border: '1.5px solid white', // FIX
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)', // FIX
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 20, // FIX
                              height: Math.max(2, item.size), // FIX
                              borderRadius: 1, // FIX
                              background: item.color, // FIX
                              flexShrink: 0, // FIX
                            }}
                          />
                        )}
                        <span style={{ fontSize: 11, color: '#374151' }}>{item.label}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => clearTopology()}
                      style={{
                        marginTop: 8, // FIX
                        width: '100%', // FIX
                        padding: '5px', // FIX
                        borderRadius: 6, // FIX
                        border: '1px solid #E5E7EB', // FIX
                        background: 'white', // FIX
                        cursor: 'pointer', // FIX
                        fontSize: 11, // FIX
                        color: '#6B7280', // FIX
                      }}
                    >
                      🗑️ Hapus Topologi
                    </button>
                  </div>
                )}
              </div>
            )}

            {activePanel === 'layers' && (
              <div style={{ padding: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: `2px dashed ${uploadingKmz ? '#00D4B4' : '#D1D5DB'}`,
                    cursor: uploadingKmz ? 'wait' : 'pointer',
                    background: uploadingKmz ? '#00D4B408' : '#F9FAFB',
                    marginBottom: 14,
                    transition: 'all 150ms',
                  }}
                >
                  <span style={{ fontSize: 28 }}>
                    {uploadingKmz ? '⏳' : '📂'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                      }}
                    >
                      {uploadingKmz ? 'Memproses KMZ...' : '+ Upload KMZ / KML'}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginTop: 2,
                      }}
                    >
                      Tidak menghapus layer existing
                    </div>
                  </div>
                  <input
                    type="file"
                    accept=".kmz,.kml"
                    disabled={uploadingKmz}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleKmzUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>

                {layers.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '20px 0',
                      fontSize: 13,
                      color: '#6B7280',
                    }}
                  >
                    Belum ada layer KMZ
                  </div>
                ) : (
                  layers.map((layer) => (
                    <div
                      key={layer.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: '#F9FAFB',
                        marginBottom: 6,
                        border: '1px solid #E5E7EB',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(e) =>
                            void handleColorChange(layer.id, e.target.value, layer.isVisible)
                          }
                          title="Ganti warna layer"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid rgba(0,0,0,0.15)',
                            cursor: 'pointer',
                            padding: 0,
                            background: layer.color,
                          }}
                        />
                      </div>

                      <span
                        style={{
                          flex: 1,
                          fontSize: 12,
                          color: '#111',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {layer.name}
                      </span>

                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 8,
                          background: '#E5E7EB',
                          color: '#6B7280',
                          flexShrink: 0,
                        }}
                      >
                        {layer.geoJson?.features?.length || 0} titik
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const newVis = !layer.isVisible;
                            try {
                              await apiPatch(`/map/layers/${layer.id}/visibility`, {
                                isVisible: newVis,
                              });
                              setLayers((prev) =>
                                prev.map((l) =>
                                  l.id === layer.id ? { ...l, isVisible: newVis } : l,
                                ),
                              );
                            } catch {
                              toast.error('Gagal update visibility');
                            }
                          })();
                        }}
                        title={layer.isVisible ? 'Sembunyikan' : 'Tampilkan'}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 5,
                          border: 'none',
                          background: layer.isVisible ? '#22C55E15' : '#F3F4F6',
                          color: layer.isVisible ? '#22C55E' : '#9CA3AF',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {layer.isVisible ? 'ON' : 'OFF'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeleteLayer(layer.id, layer.name)}
                        title="Hapus layer"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: 'none',
                          flexShrink: 0,
                          background: '#FEE2E2',
                          color: '#EF4444',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          transition: 'all 150ms',
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = '#EF4444';
                          el.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = '#FEE2E2';
                          el.style.color = '#EF4444';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {activePanel === 'calc' && (
              <div style={{ padding: 16 }}>
                {calcMode === 'idle' && !calcResult && (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: '#6B7280',
                        marginBottom: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      Gunakan kalkulasi untuk menghitung kebutuhan jaringan FTTH
                      pada area yang dipilih.
                    </p>

                    {/* FIX: Input mode toggle */}
                    <div style={{ marginBottom: 14 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--color-text-secondary)',
                          display: 'block',
                          marginBottom: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Mode Input Area
                      </label>
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          background: 'var(--color-background-secondary)',
                          padding: 4,
                          borderRadius: 10,
                        }}
                      >
                        {(
                          [
                            { key: 'radius' as const, label: '⭕ Radius' },
                            { key: 'polygon' as const, label: '🔷 Polygon' },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => {
                              setInputMode(m.key); // FIX
                              setPolygonPoints([]); // FIX
                              setPolygonAreaSqM(null); // FIX
                              setPolygonCentroid(null); // FIX
                              const mmap = mapRef.current; // FIX
                              if (mmap) clearPolygonFromMap(mmap); // FIX
                              polygonMarkersRef.current.forEach((mk) => mk.remove()); // FIX
                              polygonMarkersRef.current = []; // FIX
                            }}
                            style={{
                              flex: 1,
                              padding: '7px 8px',
                              borderRadius: 7,
                              border: 'none',
                              cursor: 'pointer',
                              background: inputMode === m.key ? 'white' : 'transparent',
                              color:
                                inputMode === m.key
                                  ? 'var(--color-text-primary)'
                                  : 'var(--color-text-secondary)',
                              fontWeight: inputMode === m.key ? 700 : 400,
                              fontSize: 12,
                              boxShadow:
                                inputMode === m.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                              transition: 'all 150ms',
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      {inputMode === 'polygon' && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#6B7280',
                            marginTop: 6,
                            lineHeight: 1.4,
                          }}
                        >
                          💡 Klik titik-titik di peta untuk menggambar area. Double-click untuk
                          menutup polygon.
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#6B7280',
                          display: 'block',
                          marginBottom: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Tipe Area
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['URBAN', 'SUBURBAN', 'RURAL'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setAreaType(t)}
                            style={{
                              flex: 1,
                              padding: '7px 4px',
                              borderRadius: 7,
                              border: `1.5px solid ${areaType === t ? '#00D4B4' : '#E5E7EB'}`,
                              background: areaType === t ? '#00D4B415' : 'white',
                              color: areaType === t ? '#00D4B4' : '#374151',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {t === 'URBAN' ? '🏙️' : t === 'SUBURBAN' ? '🏘️' : '🌳'}{' '}
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* FIX: show radius only in radius mode */}
                    {inputMode === 'radius' && (
                      <div style={{ marginBottom: 16 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#6B7280',
                            display: 'block',
                            marginBottom: 6,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Radius Area: {areaRadius}m
                        </label>
                        <input
                          type="range"
                          min={100}
                          max={1000}
                          step={50}
                          value={areaRadius}
                          onChange={(e) => setAreaRadius(Number(e.target.value))}
                          style={{ width: '100%' }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 10,
                            color: '#9CA3AF',
                          }}
                        >
                          <span>100m</span>
                          <span>500m</span>
                          <span>1km</span>
                        </div>
                      </div>
                    )}

                    {/* FIX: polygon area info */}
                    {inputMode === 'polygon' && polygonAreaSqM != null && polygonAreaSqM > 0 && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          marginBottom: 12,
                          background: '#F0FDF4',
                          border: '1px solid #BBF7D0',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#16A34A' }}>
                          ✅ Polygon tergambar:{' '}
                        </span>
                        <span style={{ color: '#374151' }}>
                          {polygonAreaSqM > 1_000_000
                            ? `${(polygonAreaSqM / 1_000_000).toFixed(3)} km²`
                            : `${Math.round(polygonAreaSqM).toLocaleString('id-ID')} m²`}
                          {' · '}
                          {polygonPoints.length} titik
                        </span>
                      </div>
                    )}
                    {inputMode === 'polygon' && (!polygonAreaSqM || polygonAreaSqM <= 0) && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          marginBottom: 12,
                          background: '#FFF7ED',
                          border: '1px solid #FED7AA',
                          fontSize: 11,
                          color: '#92400E',
                        }}
                      >
                        📍 Klik peta untuk tambah titik. Double-click untuk selesai.
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartCalc()}
                      style={{
                        width: '100%',
                        padding: '11px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'linear-gradient(135deg, #00D4B4, #00B89E)',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                        boxShadow: '0 4px 14px #00D4B440',
                      }}
                    >
                      🧮 Mulai Kalkulasi
                    </button>
                  </>
                )}

                {(calcMode === 'backbone' || calcMode === 'target') && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>
                      {calcMode === 'backbone' ? '📡' : '🎯'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                        marginBottom: 6,
                      }}
                    >
                      {calcMode === 'backbone'
                        ? 'Klik titik BACKBONE di peta'
                        : 'Klik area TARGET di peta'}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginBottom: 16,
                      }}
                    >
                      {calcMode === 'backbone'
                        ? 'Tandai lokasi backbone/OLT terdekat'
                        : 'Tandai area yang ingin dipasang FTTH'}
                    </div>
                    {backbonePoint && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: '#EFF6FF',
                          border: '1px solid #BFDBFE',
                          fontSize: 11,
                          color: '#1D4ED8',
                          marginBottom: 8,
                        }}
                      >
                        ✅ Backbone: {backbonePoint[1].toFixed(4)},{' '}
                        {backbonePoint[0].toFixed(4)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        clearTopology(); // FIX: remove topology layers
                        clearCalcGraphics();
                        setCalcMode('idle');
                      }}
                      style={{
                        padding: '7px 16px',
                        borderRadius: 8,
                        border: '1px solid #E5E7EB',
                        background: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#6B7280',
                      }}
                    >
                      ✕ Batalkan
                    </button>
                  </div>
                )}

                {calcMode === 'result' && !calcResult && (
                  <div style={{ padding: '12px 0' }}>
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                        marginBottom: 12,
                        fontSize: 12,
                      }}
                    >
                      ✅ Backbone + Target sudah dipilih
                    </div>
                    <button
                      type="button"
                      onClick={() => void runCalculation()}
                      disabled={calculating}
                      style={{
                        width: '100%',
                        padding: '11px',
                        borderRadius: 10,
                        border: 'none',
                        background: calculating
                          ? '#E5E7EB'
                          : 'linear-gradient(135deg, #00D4B4, #00B89E)',
                        color: calculating ? '#9CA3AF' : 'white',
                        cursor: calculating ? 'not-allowed' : 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {calculating ? '⏳ Menghitung...' : '🧮 Hitung Sekarang'}
                    </button>
                  </div>
                )}

                {/* FIX: Enhanced calculation results */}
                {calcResult && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* FIX: Category banner */}
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background:
                          calcResult.summary.areaCategory === 'A'
                            ? '#EF444415'
                            : calcResult.summary.areaCategory === 'B'
                              ? '#F59E0B15'
                              : '#22C55E15',
                        border: `1px solid ${
                          calcResult.summary.areaCategory === 'A'
                            ? '#EF444440'
                            : calcResult.summary.areaCategory === 'B'
                              ? '#F59E0B40'
                              : '#22C55E40'
                        }`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 17,
                          fontWeight: 800,
                          color:
                            calcResult.summary.areaCategory === 'A'
                              ? '#EF4444'
                              : calcResult.summary.areaCategory === 'B'
                                ? '#F59E0B'
                                : '#22C55E',
                        }}
                      >
                        {calcResult.summary.areaCategory === 'A'
                          ? '🔴'
                          : calcResult.summary.areaCategory === 'B'
                            ? '🟡'
                            : '🟢'}{' '}
                        Kategori {calcResult.summary.areaCategory}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6B7280',
                          marginTop: 3,
                          lineHeight: 1.4,
                        }}
                      >
                        {calcResult.summary.categoryReason}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                        📡 {calcResult.summary.backboneOwner} ·{' '}
                        {calcResult.summary.backboneDistanceM}m · {calcResult.summary.areaType}
                      </div>
                    </div>

                    {/* FIX: Export buttons — show after calculation */}
                    {calcResult && topologyRendered && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 10,
                          background: '#F9FAFB',
                          border: '0.5px solid var(--color-border-tertiary)',
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#374151',
                            marginBottom: 8,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          📥 Export Hasil
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(
                            [
                              { key: 'image' as const, icon: '🖼️', label: 'Screenshot Peta (PNG)' },
                              { key: 'pdf-map' as const, icon: '📄', label: 'PDF — Peta Saja' },
                              { key: 'pdf-full' as const, icon: '📊', label: 'PDF — Lengkap + ROI' },
                              {
                                key: 'kmz' as const,
                                icon: '📍',
                                label: 'Export KMZ (Google Earth)',
                              },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              disabled={exporting}
                              onClick={() => {
                                void (async () => {
                                  setExporting(true); // FIX
                                  try {
                                    const fname = `permatrax-ftth-${
                                      calcResult.summary?.areaType || 'calc'
                                    }-${Date.now()}`; // FIX

                                    if (opt.key === 'image') {
                                      await exportMapImage(mapRef, `${fname}.png`); // FIX
                                      toast.success('✅ Screenshot diunduh'); // FIX
                                    } else if (opt.key === 'pdf-map' || opt.key === 'pdf-full') {
                                      await exportPdf(opt.key, mapRef, calcResult); // FIX
                                      toast.success('✅ PDF diunduh'); // FIX
                                    } else if (opt.key === 'kmz') {
                                      await exportKmz(
                                        {
                                          backbone: backbonePoint ?? undefined, // FIX
                                          odcPoint: targetPoint ?? undefined, // FIX
                                          odpPositions: topoExportData?.odpPositions || [], // FIX
                                          homepassPoints: topoExportData?.homepassPoints || [], // FIX
                                        },
                                        fname,
                                      ); // FIX
                                      toast.success('✅ KMZ diunduh'); // FIX
                                    } // FIX
                                  } catch (err: unknown) {
                                    const m = err instanceof Error ? err.message : 'Error'; // FIX
                                    toast.error(`Export gagal: ${m}`); // FIX
                                  } finally {
                                    setExporting(false); // FIX
                                  } // FIX
                                })(); // FIX
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: exporting
                                  ? 'var(--color-background-secondary)'
                                  : 'var(--color-background-primary)',
                                cursor: exporting ? 'not-allowed' : 'pointer',
                                fontSize: 12,
                                fontWeight: 500,
                                color: exporting ? '#9CA3AF' : 'var(--color-text-primary)',
                                border: '0.5px solid var(--color-border-tertiary)',
                                textAlign: 'left',
                              }}
                            >
                              <span>{opt.icon}</span>
                              <span>{opt.label}</span>
                              {exporting && (
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF' }}>
                                  ⏳
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* FIX: Selected topology card */}
                    {calcResult?.topology?.selected && (
                      <div
                        style={{
                          borderRadius: 10, // FIX
                          overflow: 'hidden', // FIX
                          border: '1.5px solid #BFDBFE', // FIX
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            background: '#EFF6FF', // FIX
                            borderBottom: '1px solid #BFDBFE', // FIX
                            display: 'flex', // FIX
                            justifyContent: 'space-between', // FIX
                            alignItems: 'center', // FIX
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11, // FIX
                              fontWeight: 700, // FIX
                              color: '#1D4ED8', // FIX
                              textTransform: 'uppercase', // FIX
                              letterSpacing: '0.05em', // FIX
                            }}
                          >
                            🌐 Topologi Terpilih
                          </span>
                          <span
                            style={{
                              padding: '2px 8px', // FIX
                              borderRadius: 10, // FIX
                              background: '#DBEAFE', // FIX
                              color: '#1D4ED8', // FIX
                              fontSize: 10, // FIX
                              fontWeight: 700, // FIX
                            }}
                          >
                            {calcResult.topology.selected.suitability}% cocok
                          </span>
                        </div>
                        <div style={{ padding: '10px 14px', background: 'white' }}>
                          <div
                            style={{
                              fontSize: 14, // FIX
                              fontWeight: 700, // FIX
                              color: '#111', // FIX
                              marginBottom: 4, // FIX
                            }}
                          >
                            {calcResult.topology.selected.label}
                          </div>
                          <div
                            style={{
                              fontSize: 11, // FIX
                              color: '#374151', // FIX
                              lineHeight: 1.5, // FIX
                              marginBottom: 8, // FIX
                            }}
                          >
                            {calcResult.topology.selected.description}
                          </div>
                          <div
                            style={{
                              display: 'grid', // FIX
                              gridTemplateColumns: '1fr 1fr', // FIX
                              gap: 6, // FIX
                            }}
                          >
                            <div
                              style={{
                                padding: '6px 8px', // FIX
                                borderRadius: 6, // FIX
                                background: '#F0FDF4', // FIX
                                border: '1px solid #BBF7D0', // FIX
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 9, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#16A34A', // FIX
                                  marginBottom: 3, // FIX
                                  textTransform: 'uppercase', // FIX
                                }}
                              >
                                Kelebihan
                              </div>
                              {calcResult.topology.selected.pros.slice(0, 3).map((p: string, i: number) => (
                                <div
                                  key={i}
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#166534', // FIX
                                    display: 'flex', // FIX
                                    gap: 4, // FIX
                                    marginBottom: 2, // FIX
                                  }}
                                >
                                  <span>✓</span>
                                  <span>{p}</span>
                                </div>
                              ))}
                            </div>
                            <div
                              style={{
                                padding: '6px 8px', // FIX
                                borderRadius: 6, // FIX
                                background: '#FEF2F2', // FIX
                                border: '1px solid #FECACA', // FIX
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 9, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#DC2626', // FIX
                                  marginBottom: 3, // FIX
                                  textTransform: 'uppercase', // FIX
                                }}
                              >
                                Kekurangan
                              </div>
                              {calcResult.topology.selected.cons.slice(0, 2).map((c: string, i: number) => (
                                <div
                                  key={i}
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#991B1B', // FIX
                                    display: 'flex', // FIX
                                    gap: 4, // FIX
                                    marginBottom: 2, // FIX
                                  }}
                                >
                                  <span>!</span>
                                  <span>{c}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* FIX: Key metrics row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        {
                          icon: '🏠',
                          label: 'Homepass',
                          value: `~${calcResult.homepass.estimated}`,
                          sub: `${calcResult.homepass.active} aktif (70%)`,
                        },
                        {
                          icon: '📏',
                          label: 'Total Route',
                          value: `${(calcResult.route.totalM / 1000).toFixed(2)} km`,
                          sub: 'feeder + distribusi',
                        },
                        {
                          icon: '🔌',
                          label: 'Total Kabel',
                          value: `${(calcResult.cable.totalM / 1000).toFixed(2)} km`,
                          sub: 'incl. buffer 15%',
                        },
                        {
                          icon: '📦',
                          label: `ODP ${calcResult.equipment.odp.capacity}P`,
                          value: `${calcResult.equipment.odp.count} unit`,
                          sub: `splitter ${calcResult.equipment.splitter.ratio}`,
                        },
                      ].map((m) => (
                        <div
                          key={m.label}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#F9FAFB',
                            border: '1px solid #E5E7EB',
                          }}
                        >
                          <div style={{ fontSize: 18, marginBottom: 3 }}>{m.icon}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>
                            {m.value}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#374151',
                              marginTop: 1,
                            }}
                          >
                            {m.label}
                          </div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                            {m.sub}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* FIX: Topology */}
                    <div
                      style={{
                        background: '#F0F9FF',
                        borderRadius: 10,
                        border: '1px solid #BAE6FD',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #BAE6FD',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#0369A1',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🌐 Topologi Jaringan — {calcResult.topology.description}
                      </div>
                      {calcResult.topology.segments.map((seg, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 12px',
                            borderBottom:
                              i < calcResult.topology.segments.length - 1
                                ? '1px solid #E0F2FE'
                                : 'none',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#0369A1',
                              marginBottom: 3,
                            }}
                          >
                            {seg.name}
                          </div>
                          <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>
                            <span style={{ color: '#0284C7' }}>{seg.from}</span>
                            {' → '}
                            <span style={{ color: '#0284C7' }}>{seg.to}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                            📏 {seg.distance} · 🔌 {seg.cable}
                          </div>
                          {seg.notes && (
                            <div
                              style={{
                                fontSize: 10,
                                color: '#9CA3AF',
                                marginTop: 2,
                                fontStyle: 'italic',
                              }}
                            >
                              {seg.notes}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* FIX: Cable breakdown */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        📊 Rincian Kabel
                      </div>
                      <div style={{ padding: '8px 12px' }}>
                        {[
                          {
                            label: 'Feeder (OLT→ODC)',
                            m: calcResult.cable.breakdown.feederM,
                            type: calcResult.cable.feederCableType,
                          },
                          {
                            label: 'Distribusi (ODC→ODP)',
                            m: calcResult.cable.breakdown.distributionM,
                            type: calcResult.cable.distCableType,
                          },
                          {
                            label: 'Drop (ODP→ONT)',
                            m: calcResult.cable.breakdown.dropM,
                            type: calcResult.cable.dropCableType,
                          },
                        ].map((row, i) => (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>
                                {row.label}
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>
                                {row.m >= 1000
                                  ? `${(row.m / 1000).toFixed(2)} km`
                                  : `${row.m} m`}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                              {row.type}
                            </div>
                            {/* FIX: progress bar (guard totalM === 0) */}
                            <div
                              style={{
                                height: 3,
                                background: '#E5E7EB',
                                borderRadius: 2,
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  borderRadius: 2,
                                  background:
                                    i === 0 ? '#3B82F6' : i === 1 ? '#00D4B4' : '#F59E0B',
                                  width: `${calcResult.cable.totalM > 0 ? ((row.m / calcResult.cable.totalM) * 100).toFixed(0) : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            paddingTop: 8,
                            borderTop: '1px solid #E5E7EB',
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          <span>TOTAL (incl. 15% buffer)</span>
                          <span style={{ color: '#00D4B4' }}>
                            {(calcResult.cable.totalM / 1000).toFixed(2)} km
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* FIX: Equipment table */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🔧 Kebutuhan Perangkat
                      </div>
                      <div style={{ padding: '4px 12px' }}>
                        {[
                          {
                            icon: '📡',
                            label: 'OLT',
                            value: `1 unit (${calcResult.equipment.olt.portsNeeded} port)`,
                            sub: calcResult.equipment.olt.recommendation,
                          },
                          {
                            icon: '🏗️',
                            label: 'ODC',
                            value: `${calcResult.equipment.odc.count} unit`,
                            sub: calcResult.equipment.odc.capacity,
                          },
                          {
                            icon: '📦',
                            label: `ODP ${calcResult.equipment.odp.capacity}P`,
                            value: `${calcResult.equipment.odp.count} unit`,
                            sub: `spacing ~${calcResult.equipment.odp.spacingM}m`,
                          },
                          {
                            icon: '🔀',
                            label: `Splitter ${calcResult.equipment.splitter.ratio}`,
                            value: `${calcResult.equipment.splitter.count} unit`,
                            sub: 'passive optical splitter',
                          },
                          {
                            icon: '🔗',
                            label: 'Closure',
                            value: `${calcResult.equipment.closure.total} unit`,
                            sub: `${calcResult.equipment.closure.inline} inline`,
                          },
                          {
                            icon: '🪝',
                            label: 'Tiang',
                            value: `${calcResult.equipment.pole.total} total (${calcResult.equipment.pole.newBuild} baru)`, // FIX
                            sub: calcResult.equipment.pole.note, // FIX
                          },
                          {
                            icon: '🔧',
                            label: 'Splice',
                            value: `${calcResult.equipment.splice.total} titik`,
                            sub: 'fusion splice',
                          },
                          {
                            icon: '📡',
                            label: 'Connector SC/APC',
                            value: `${calcResult.equipment.connector.count} unit`,
                            sub: '',
                          },
                          {
                            icon: '🏠',
                            label: 'ONT/CPE',
                            value: `${calcResult.equipment.ont.count} unit`,
                            sub: calcResult.equipment.ont.type,
                          },
                          ...(calcResult.equipment.hdpeConduit.meters > 0
                            ? [
                                {
                                  icon: '🕳️',
                                  label: 'HDPE Conduit 32mm',
                                  value: `${calcResult.equipment.hdpeConduit.meters}m`,
                                  sub: 'underground route',
                                },
                              ]
                            : []),
                        ].map((eq, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              padding: '7px 0',
                              borderBottom: '1px solid #F3F4F6',
                            }}
                          >
                            <div>
                              <span style={{ fontSize: 12, color: '#374151' }}>
                                {eq.icon} {eq.label}
                              </span>
                              {eq.sub && (
                                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                                  {eq.sub}
                                </div>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#111',
                                flexShrink: 0,
                                marginLeft: 8,
                              }}
                            >
                              {eq.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* FIX: Topology rendering status */}
                    {topologyRendered && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: '#F0FDF4',
                          border: '1px solid #BBF7D0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontSize: 18 }}>🗺️</span>
                        <div>
                          <span style={{ fontWeight: 700, color: '#16A34A' }}>
                            Topologi ditampilkan di peta
                          </span>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                            🔵 OLT → 🟣 ODC → 🟢 ODP (mengikuti jalan) · 🟡 Closure
                          </div>
                        </div>
                      </div>
                    )}

                    {renderingTopology && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: '#EFF6FF',
                          border: '1px solid #BFDBFE',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            border: '2px solid #3B82F6',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: '#1D4ED8' }}>Mengambil rute jalan via OSRM...</span>
                      </div>
                    )}

                    {/* FIX: Optical Power Budget — separate card */}
                    <div
                      style={{
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: `1.5px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 14px',
                          background: calcResult.powerBudget.isOk ? '#F0FDF4' : '#FEF2F2',
                          borderBottom: `1px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                          fontSize: 11,
                          fontWeight: 700,
                          color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        ⚡ {calcResult.powerBudget.gponClass}
                      </div>
                      <div style={{ padding: '10px 14px', background: 'white' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 10,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: calcResult.powerBudget.isOk ? '#F0FDF4' : '#FEF2F2',
                            border: `1px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                              }}
                            >
                              {calcResult.powerBudget.isOk ? '✅' : '⚠️'} Cadangan Daya (Link Margin)
                            </div>
                            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                              {calcResult.powerBudget.isOk
                                ? 'Cukup — minimum 3 dB diperlukan'
                                : 'Kurang — tingkatkan ke Class C+ atau kurangi split ratio'}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 20,
                              fontWeight: 800,
                              color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                            }}
                          >
                            {calcResult.powerBudget.linkMarginDB} dB
                          </span>
                        </div>

                        {[
                          {
                            label: 'Total Rugi Optik',
                            value: calcResult.powerBudget.totalLossDB,
                            bold: true,
                          },
                          {
                            label: 'Splitter',
                            value: calcResult.powerBudget.breakdown.splitterDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Feeder',
                            value: calcResult.powerBudget.breakdown.seratFeederDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Distribusi',
                            value: calcResult.powerBudget.breakdown.seratDistDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Drop',
                            value: calcResult.powerBudget.breakdown.seratDropDB,
                            bold: false,
                          },
                          {
                            label: 'Konektor',
                            value: calcResult.powerBudget.breakdown.konektorDB,
                            bold: false,
                          },
                          {
                            label: 'Sambungan (Splice)',
                            value: calcResult.powerBudget.breakdown.sambunganDB,
                            bold: false,
                          },
                        ].map((row, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '5px 0',
                              borderBottom: '1px solid #F3F4F6',
                              fontSize: row.bold ? 12 : 11,
                            }}
                          >
                            <span
                              style={{
                                color: row.bold ? '#111' : '#374151',
                                fontWeight: row.bold ? 700 : 400,
                              }}
                            >
                              {row.label}
                            </span>
                            <span
                              style={{
                                fontWeight: row.bold ? 800 : 600,
                                color: row.bold ? '#111' : '#374151',
                              }}
                            >
                              {row.value} dB
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* FIX: Cost Estimation — vertical layout */}
                    {calcResult.costEstimation && (
                      <div
                        style={{
                          borderRadius: 10, // FIX
                          overflow: 'hidden', // FIX
                          border: '1.5px solid #FDE68A', // FIX
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', // FIX
                            borderBottom: '1px solid #FDE68A', // FIX
                            display: 'flex', // FIX
                            justifyContent: 'space-between', // FIX
                            alignItems: 'center', // FIX
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11, // FIX
                              fontWeight: 700, // FIX
                              color: '#92400E', // FIX
                              textTransform: 'uppercase' as const, // FIX
                              letterSpacing: '0.05em', // FIX
                            }}
                          >
                            💰 Estimasi Biaya Proyek
                          </span>
                          <span
                            style={{
                              fontSize: 9, // FIX
                              color: '#B45309', // FIX
                              fontStyle: 'italic', // FIX
                            }}
                          >
                            {calcResult.costEstimation.note}
                          </span>
                        </div>

                        <div
                          style={{
                            padding: '10px 14px', // FIX
                            background: '#FFFBEB', // FIX
                            borderBottom: '1px solid #FDE68A', // FIX
                          }}
                        >
                          <div
                            style={{
                              display: 'flex', // FIX
                              justifyContent: 'space-between', // FIX
                              alignItems: 'flex-start', // FIX
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 12, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#92400E', // FIX
                                }}
                              >
                                Total Estimasi Proyek
                              </div>
                              <div style={{ fontSize: 10, color: '#B45309', marginTop: 2 }}>
                                Per homepass: Rp{' '}
                                {calcResult.costEstimation.costPerHomepass.toLocaleString('id-ID')}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' as const }}>
                              <div
                                style={{
                                  fontSize: 18, // FIX
                                  fontWeight: 800, // FIX
                                  color: '#92400E', // FIX
                                }}
                              >
                                Rp {(calcResult.costEstimation.totalProject / 1e6).toFixed(1)}M
                              </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ background: 'white', padding: '4px 0' }}>
                          {calcResult.costEstimation.breakdown.map((row: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex', // FIX
                                justifyContent: 'space-between', // FIX
                                alignItems: 'center', // FIX
                                padding: '6px 14px', // FIX
                                borderBottom:
                                  i < calcResult.costEstimation.breakdown.length - 1
                                    ? '1px solid #F9FAFB'
                                    : 'none', // FIX
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <span
                                  style={{
                                    fontSize: 12, // FIX
                                    color: '#374151', // FIX
                                    fontWeight: 500, // FIX
                                  }}
                                >
                                  {row.item}
                                </span>
                                <span
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#9CA3AF', // FIX
                                    marginLeft: 6, // FIX
                                  }}
                                >
                                  ({row.qty})
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: 12, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#111', // FIX
                                  flexShrink: 0, // FIX
                                }}
                              >
                                Rp {(row.idr / 1e6).toFixed(1)}M
                              </span>
                            </div>
                          ))}
                        </div>

                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            borderTop: '2px solid #FDE68A', // FIX
                            background: '#FFFBEB', // FIX
                          }}
                        >
                          {[
                            { label: 'Material', value: calcResult.costEstimation.totalMaterial },
                            { label: 'Instalasi', value: calcResult.costEstimation.totalInstall },
                          ].map((row, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex', // FIX
                                justifyContent: 'space-between', // FIX
                                fontSize: 12, // FIX
                                padding: '3px 0', // FIX
                                borderBottom: '1px solid #FDE68A', // FIX
                              }}
                            >
                              <span style={{ color: '#374151' }}>{row.label}</span>
                              <span style={{ fontWeight: 600, color: '#374151' }}>
                                Rp {(row.value / 1e6).toFixed(1)}M
                              </span>
                            </div>
                          ))}
                          <div
                            style={{
                              display: 'flex', // FIX
                              justifyContent: 'space-between', // FIX
                              fontSize: 13, // FIX
                              fontWeight: 800, // FIX
                              padding: '6px 0 2px', // FIX
                              color: '#92400E', // FIX
                            }}
                          >
                            <span>TOTAL</span>
                            <span>
                              Rp {calcResult.costEstimation.totalProject.toLocaleString('id-ID')}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* FIX: ROI 3-tier — cleaner layout */}
                    {calcResult?.roi?.tiers && (
                      <div
                        style={{
                          marginTop: 10, // FIX
                                borderRadius: 12, // FIX
                                overflow: 'hidden', // FIX
                                border: '1px solid #FDE68A', // FIX
                              }}
                            >
                              <div
                                style={{
                                  padding: '10px 14px', // FIX
                                  background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', // FIX
                                  borderBottom: '1px solid #FDE68A', // FIX
                                  display: 'flex', // FIX
                                  justifyContent: 'space-between', // FIX
                                  alignItems: 'center', // FIX
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 12, // FIX
                                    fontWeight: 700, // FIX
                                    color: '#92400E', // FIX
                                  }}
                                >
                                  📈 Estimasi ROI — 3 Segmen Pasar
                                </span>
                                <span style={{ fontSize: 10, color: '#B45309' }}>
                                  {calcResult.roi.totalTakeRatePct}% total take rate
                                </span>
                              </div>

                              <div
                                style={{
                                  padding: '8px 14px', // FIX
                                  background: '#FFFBEB', // FIX
                                  borderBottom: '1px solid #FDE68A', // FIX
                                  display: 'flex', // FIX
                                  alignItems: 'center', // FIX
                                  justifyContent: 'space-between', // FIX
                                  gap: 8, // FIX
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex', // FIX
                                    gap: 16, // FIX
                                    alignItems: 'center', // FIX
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Overall BEP
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 20, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      {calcResult.roi.overallBepMonths}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        bln
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      width: 1, // FIX
                                      height: 32, // FIX
                                      background: '#FDE68A', // FIX
                                    }}
                                  />
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Revenue/bulan
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 16, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      Rp {(calcResult.roi.totalMonthlyRevenue / 1e6).toFixed(1)}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        M
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      width: 1, // FIX
                                      height: 32, // FIX
                                      background: '#FDE68A', // FIX
                                    }}
                                  />
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Active HP
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 16, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      {calcResult.roi.totalActiveHomepass}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        unit
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div
                                  style={{
                                    padding: '4px 10px', // FIX
                                    borderRadius: 8, // FIX
                                    background: '#FEF3C7', // FIX
                                    fontSize: 10, // FIX
                                    color: '#92400E', // FIX
                                    fontWeight: 600, // FIX
                                    border: '1px solid #FDE68A', // FIX
                                    whiteSpace: 'nowrap' as const, // FIX
                                  }}
                                >
                                  {calcResult.roi.overallBepYears} tahun
                                </div>
                              </div>

                              <div style={{ background: 'white' }}>
                                {calcResult.roi.tiers.map((tier: any, i: number) => {
                                  const colors: Record<
                                    string,
                                    { main: string; bg: string; border: string }
                                  > = {
                                    Basic: { main: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' }, // FIX
                                    Standard: { main: '#00D4B4', bg: '#F0FDFA', border: '#99F6E4' }, // FIX
                                    Premium: { main: '#8B5CF6', bg: '#F5F3FF', border: '#DDD6FE' }, // FIX
                                  }; // FIX
                                  const c = colors[tier.name] || colors.Standard; // FIX

                                  return (
                                    <div
                                      key={tier.name}
                                      style={{
                                        padding: '10px 14px', // FIX
                                        borderBottom: i < 2 ? '1px solid #F3F4F6' : 'none', // FIX
                                        display: 'flex', // FIX
                                        gap: 10, // FIX
                                        alignItems: 'center', // FIX
                                      }}
                                    >
                                      <div
                                        style={{
                                          minWidth: 72, // FIX
                                          padding: '4px 8px', // FIX
                                          borderRadius: 8, // FIX
                                          textAlign: 'center' as const, // FIX
                                          background: c.bg, // FIX
                                          border: `1px solid ${c.border}`, // FIX
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 11, // FIX
                                            fontWeight: 700, // FIX
                                            color: c.main, // FIX
                                          }}
                                        >
                                          {tier.name}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 9, // FIX
                                            color: c.main, // FIX
                                            opacity: 0.8, // FIX
                                          }}
                                        >
                                          Rp {(tier.arpu / 1000).toFixed(0)}k/bln
                                        </div>
                                      </div>

                                      <div
                                        style={{
                                          flex: 1, // FIX
                                          display: 'grid', // FIX
                                          gridTemplateColumns: '1fr 1fr 1fr 1fr', // FIX
                                          gap: 4, // FIX
                                        }}
                                      >
                                        {[
                                          { label: 'Take Rate', value: `${tier.takeRatePct}%` }, // FIX
                                          { label: 'Active HP', value: `${tier.activeHomepass}` }, // FIX
                                          {
                                            label: 'Rev/bln', // FIX
                                            value: `Rp ${(tier.monthlyRevenue / 1e6).toFixed(1)}M`, // FIX
                                          }, // FIX
                                          { label: 'BEP', value: `${tier.breakEvenMonths} bln` }, // FIX
                                        ].map((m) => (
                                          <div key={m.label} style={{ textAlign: 'center' as const }}>
                                            <div
                                              style={{
                                                fontSize: 12, // FIX
                                                fontWeight: 700, // FIX
                                                color: c.main, // FIX
                                              }}
                                            >
                                              {m.value}
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 9, // FIX
                                                color: '#9CA3AF', // FIX
                                                marginTop: 1, // FIX
                                              }}
                                            >
                                              {m.label}
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <div
                                        style={{
                                          padding: '3px 7px', // FIX
                                          borderRadius: 6, // FIX
                                          background: tier.isViable ? '#F0FDF4' : '#FEF2F2', // FIX
                                          border: `1px solid ${tier.isViable ? '#BBF7D0' : '#FECACA'}`, // FIX
                                          fontSize: 9, // FIX
                                          fontWeight: 600, // FIX
                                          color: tier.isViable ? '#16A34A' : '#EF4444', // FIX
                                          flexShrink: 0, // FIX
                                          whiteSpace: 'nowrap' as const, // FIX
                                        }}
                                      >
                                        {tier.isViable ? '✅ Viable' : '⚠️ Review'}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div
                                style={{
                                  padding: '8px 14px', // FIX
                                  background: '#F0FDF4', // FIX
                                  borderTop: '1px solid #BBF7D0', // FIX
                                  display: 'flex', // FIX
                                  justifyContent: 'space-between', // FIX
                                  alignItems: 'center', // FIX
                                }}
                              >
                                <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>
                                  Total Revenue / Tahun (semua tier)
                                </span>
                                <span style={{ fontSize: 14, fontWeight: 800, color: '#16A34A' }}>
                                  Rp{' '}
                                  {((calcResult.roi.totalAnnualRevenue ?? 0) / 1e6).toFixed(0)}M
                                </span>
                              </div>
                            </div>
                          )}

                    {/* FIX: Installation sequence */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🏗️ Urutan Instalasi — Est. {calcResult.installation.totalDuration}
                      </div>
                      {calcResult.installation.sequence.map((step) => (
                        <div
                          key={step.step}
                          style={{
                            padding: '8px 12px',
                            borderBottom:
                              step.step < calcResult.installation.sequence.length
                                ? '1px solid #F3F4F6'
                                : 'none',
                            display: 'flex',
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              background: '#00D4B415',
                              border: '1.5px solid #00D4B440',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#00D4B4',
                            }}
                          >
                            {step.step}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#111',
                                marginBottom: 3,
                              }}
                            >
                              {step.title}
                              <span
                                style={{
                                  fontSize: 10,
                                  color: '#9CA3AF',
                                  fontWeight: 400,
                                  marginLeft: 6,
                                }}
                              >
                                ⏱ {step.duration}
                              </span>
                            </div>
                            {step.tasks.map((task, ti) => (
                              <div
                                key={ti}
                                style={{
                                  fontSize: 10,
                                  color: '#6B7280',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 4,
                                  marginBottom: 2,
                                }}
                              >
                                <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
                                {task}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* FIX: Standards */}
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#1D4ED8',
                          marginBottom: 5,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        📋 Standar yang Digunakan
                      </div>
                      {calcResult.topology.standards.map((s, si) => (
                        <div key={si} style={{ fontSize: 10, color: '#1E40AF', marginBottom: 2 }}>
                          • {s}
                        </div>
                      ))}
                    </div>

                    {/* FIX: Enhanced recommendations — structured */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 14px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        💡 Rekomendasi Detail
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 10,
                        }}
                      >
                        {calcResult.recommendations.map((r, i) => {
                          const colors = {
                            success: { bg: '#F0FDF4', border: '#BBF7D0', titleColor: '#16A34A' },
                            warning: { bg: '#FFFBEB', border: '#FDE68A', titleColor: '#92400E' },
                            error: { bg: '#FEF2F2', border: '#FECACA', titleColor: '#DC2626' },
                            info: { bg: '#EFF6FF', border: '#BFDBFE', titleColor: '#1D4ED8' },
                          }; // FIX
                          const c = colors[r.severity] || colors.info; // FIX
                          return (
                            <div
                              key={i}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: c.bg,
                                border: `1px solid ${c.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: c.titleColor,
                                  marginBottom: 4,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <span>{r.icon}</span>
                                <span>{r.title}</span>
                              </div>
                              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                                {r.detail}
                              </div>
                            </div>
                          ); // FIX
                        })}
                      </div>
                    </div>

                    {/* FIX: Reset */}
                    <button
                      type="button"
                      onClick={() => {
                        clearTopology(); // FIX: remove topology layers
                        clearCalcGraphics();
                        setCalcMode('idle');
                        setCalcResult(null);
                        setBackbonePoint(null);
                        setTargetPoint(null);
                        setNearestBackbone(null);
                      }}
                      style={{
                        width: '100%',
                        padding: '9px',
                        borderRadius: 8,
                        border: '1px solid #E5E7EB',
                        background: 'white',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#6B7280',
                      }}
                    >
                      🔄 Hitung Ulang
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
              Memuat Peta GIS...
            </div>
          </div>
        </div>
      )}

      {calcMode !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}
        >
          {calcMode === 'backbone' && '📡 Klik untuk pilih titik BACKBONE'}
          {calcMode === 'target' && '🎯 Klik untuk pilih area TARGET'}
          {calcMode === 'result' && '✅ Siap dihitung — klik Hitung Sekarang'}
        </div>
      )}
    </div>
  );
}
