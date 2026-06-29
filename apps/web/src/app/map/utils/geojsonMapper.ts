import type { Feature, FeatureCollection, Geometry } from 'geojson';

export function parseJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isPointCoordinates(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

export function parsePoint(value: unknown): [number, number] | null {
  const raw = parseJsonValue(value);
  if (isPointCoordinates(raw)) return raw;

  if (Array.isArray(raw) && raw.length === 2) {
    const lng = parseNumber(raw[0]);
    const lat = parseNumber(raw[1]);
    if (lng !== null && lat !== null) return [lng, lat];
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const coords = parseJsonValue(record.coords ?? record.coordinates);
    if (isPointCoordinates(coords)) return coords;

    const lng = typeof record.lng === 'number' ? record.lng : typeof record.lon === 'number' ? record.lon : undefined;
    const lat = typeof record.lat === 'number' ? record.lat : undefined;
    if (typeof lng === 'number' && typeof lat === 'number') return [lng, lat];
  }

  return null;
}

export function parseLineStringCoordinates(value: unknown): [number, number][] {
  const raw = parseJsonValue(value);
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => parsePoint(parseJsonValue(item)))
    .filter((coords): coords is [number, number] => coords !== null);
}

export function edgeToFeature(edge: unknown): Feature | null {
  if (!edge || typeof edge !== 'object') return null;
  const data = edge as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : undefined;
  const refId = typeof data.refId === 'string' ? data.refId : typeof data.id === 'string' ? data.id : undefined;
  if (!refId || !type) return null;

  const coords = parseLineStringCoordinates(
    data.coordinates ?? (data.geometry as any)?.coordinates ?? (data.properties as any)?.coordinates,
  );
  if (coords.length < 2) return null;

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
    properties: { refId, type },
  };
}

export function edgesToFeatureCollections(edges: Record<string, unknown>) {
  const edgeList = Object.values(edges);

  const feederFeatures: Feature[] = [];
  const distributionFeatures: Feature[] = [];

  for (const edge of edgeList) {
    const feature = edgeToFeature(edge);
    if (!feature) continue;
    if (feature.properties?.type === 'FEEDER') {
      feederFeatures.push(feature);
    } else if (feature.properties?.type === 'DISTRIBUTION') {
      distributionFeatures.push(feature);
    }
  }

  return {
    feederFeatures,
    distributionFeatures,
  };
}

function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    value &&
    typeof value === 'object' &&
    (value as FeatureCollection).type === 'FeatureCollection' &&
    Array.isArray((value as FeatureCollection).features)
  );
}

export function extractHomepassPoints(baseTopology: unknown, calcInputs?: unknown): [number, number][] {
  const candidates: unknown[] = [];
  const topo = baseTopology as Record<string, unknown> | null | undefined;
  const calc = calcInputs as Record<string, unknown> | null | undefined;

  if (topo) {
    candidates.push(topo.homepassPoints, topo.homepass, (topo.topology as any)?.homepassPoints, (topo.topology as any)?.homepass);
  }
  if (calc) {
    candidates.push(calc.homepassPoints, calc.homepass);
  }

  const points: [number, number][] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    for (const item of candidate) {
      const point = parsePoint(item);
      if (point) points.push(point);
    }

    if (points.length > 0) {
      break;
    }
  }

  return Array.from(new Map(points.map((coords) => [coords.join(','), coords])).values());
}

export function homepassPointsToFeatureCollection(points: [number, number][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((coords, idx) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: coords },
      properties: { kind: 'homepass', refId: `hp-${idx + 1}` },
    })),
  };
}

// ── JLM Issue 4/5: shared network-object classification + symbology ──────────
export type NetworkObjType = 'OLT' | 'ODC' | 'ODP' | 'Closure' | 'Homepass' | 'Kabel';

// Distinct colour per object type (used by KMZ import styling + legend swatches)
export const NETWORK_OBJECT_COLORS: Record<NetworkObjType, string> = {
  OLT: '#1D4ED8',
  ODC: '#7C3AED',
  ODP: '#16A34A',
  Closure: '#F59E0B',
  Homepass: '#22C55E',
  Kabel: '#3B82F6',
};

// Per-type circle radius so object hierarchy reads at a glance
export const NETWORK_OBJECT_RADIUS: Record<NetworkObjType, number> = {
  OLT: 12,
  ODC: 10,
  ODP: 8,
  Closure: 6,
  Homepass: 4.5,
  Kabel: 5,
};

/** Classify a KML/GeoJSON feature into an FTTH network object type by props + geometry. */
export function classifyNetworkObject(
  props: Record<string, unknown> | null | undefined,
  geomType?: string,
): NetworkObjType | null {
  const hay = `${String(props?.type ?? props?.kind ?? (props as Record<string, unknown>)?.Type ?? '')} ${String(
    props?.name ?? (props as Record<string, unknown>)?.Name ?? '',
  )}`.toLowerCase();
  if (/\bolt\b|backbone/.test(hay)) return 'OLT';
  if (/\bodc\b/.test(hay)) return 'ODC';
  if (/\bodp\b/.test(hay)) return 'ODP';
  if (/closure|joint/.test(hay)) return 'Closure';
  if (/homepass|\bhp\b|house|tercover/.test(hay)) return 'Homepass';
  if (/feeder|distribu|cable|kabel|drop/.test(hay)) return 'Kabel';
  if (geomType === 'LineString' || geomType === 'MultiLineString') return 'Kabel';
  return null;
}
