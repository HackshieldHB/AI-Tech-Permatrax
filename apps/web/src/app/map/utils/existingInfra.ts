import type { FeatureCollection } from 'geojson';
import { classifyNetworkObject } from './geojsonMapper';
import type { GisLayer } from '../hooks/types';

export type ExistingInfra = {
  olt: [number, number][];
  odc: [number, number][];
  odp: [number, number][];
  cables: [number, number][][];
};

function emptyInfra(): ExistingInfra {
  return { olt: [], odc: [], odp: [], cables: [] };
}

function pushPoint(bucket: [number, number][], coords: unknown) {
  if (!Array.isArray(coords) || coords.length < 2) return;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  bucket.push([lng, lat]);
}

/** Extract OLT/ODC/ODP/cables from KMZ layers marked as existing network. */
export function extractExistingFromKmzLayers(layers: GisLayer[]): ExistingInfra {
  const out = emptyInfra();
  for (const layer of layers) {
    if (!layer.useAsExistingNetwork) continue;
    const features = layer.geoJson?.features ?? [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const tagged = (props.__objType as string | undefined) || null;
      const kind =
        (tagged as ReturnType<typeof classifyNetworkObject>) ||
        classifyNetworkObject(props, g.type);

      if (g.type === 'Point') {
        if (kind === 'OLT') pushPoint(out.olt, g.coordinates);
        else if (kind === 'ODC') pushPoint(out.odc, g.coordinates);
        else if (kind === 'ODP') pushPoint(out.odp, g.coordinates);
      } else if (g.type === 'MultiPoint') {
        for (const c of g.coordinates ?? []) {
          if (kind === 'OLT') pushPoint(out.olt, c);
          else if (kind === 'ODC') pushPoint(out.odc, c);
          else if (kind === 'ODP') pushPoint(out.odp, c);
        }
      } else if (g.type === 'LineString' && (kind === 'Kabel' || !kind)) {
        const coords = (g.coordinates ?? []).filter(
          (c): c is [number, number] => Array.isArray(c) && c.length >= 2,
        ) as [number, number][];
        if (coords.length >= 2) out.cables.push(coords);
      } else if (g.type === 'MultiLineString') {
        for (const line of g.coordinates ?? []) {
          const coords = (line ?? []).filter(
            (c): c is [number, number] => Array.isArray(c) && c.length >= 2,
          ) as [number, number][];
          if (coords.length >= 2) out.cables.push(coords);
        }
      }
    }
  }
  return out;
}

/** Extract OLT/ODC/ODP from design-mode nodes in the store. */
export function extractExistingFromDesignNodes(
  nodes: Record<string, { type: string; coordinates: [number, number] }>,
): ExistingInfra {
  const out = emptyInfra();
  for (const node of Object.values(nodes)) {
    const t = String(node.type || '').toUpperCase();
    if (t === 'OLT') pushPoint(out.olt, node.coordinates);
    else if (t === 'ODC') pushPoint(out.odc, node.coordinates);
    else if (t === 'ODP') pushPoint(out.odp, node.coordinates);
  }
  return out;
}

/** Sketch Point features as generic candidates (used for pick-snap; ODP seed if tagged). */
export function extractPointsFromSketch(sketchTopology: FeatureCollection | null | undefined): [number, number][] {
  const pts: [number, number][] = [];
  for (const f of sketchTopology?.features ?? []) {
    if (f.geometry?.type === 'Point') pushPoint(pts, f.geometry.coordinates);
  }
  return pts;
}

export function mergeExistingInfra(...parts: ExistingInfra[]): ExistingInfra {
  const out = emptyInfra();
  const key = (p: [number, number]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const seen = { olt: new Set<string>(), odc: new Set<string>(), odp: new Set<string>() };
  for (const part of parts) {
    for (const p of part.olt) {
      const k = key(p);
      if (!seen.olt.has(k)) {
        seen.olt.add(k);
        out.olt.push(p);
      }
    }
    for (const p of part.odc) {
      const k = key(p);
      if (!seen.odc.has(k)) {
        seen.odc.add(k);
        out.odc.push(p);
      }
    }
    for (const p of part.odp) {
      const k = key(p);
      if (!seen.odp.has(k)) {
        seen.odp.add(k);
        out.odp.push(p);
      }
    }
    out.cables.push(...part.cables);
  }
  return out;
}

/** Haversine distance in meters. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Snap click to nearest candidate within maxM; returns null if none. */
export function snapToNearest(
  lng: number,
  lat: number,
  candidates: [number, number][],
  maxM = 20,
): { point: [number, number]; distanceM: number } | null {
  let best: { point: [number, number]; distanceM: number } | null = null;
  for (const c of candidates) {
    const d = haversineMeters(lat, lng, c[1], c[0]);
    if (d <= maxM && (!best || d < best.distanceM)) {
      best = { point: c, distanceM: d };
    }
  }
  return best;
}

export function isPointInPolygonRing(
  lng: number,
  lat: number,
  ring: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
