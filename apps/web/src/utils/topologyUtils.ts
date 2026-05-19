import type { FtthCalcApiResponse } from '../app/map/hooks/types';

export type TopologyHomepassPoint = {
  coords: [number, number];
  odpIdx: number;
  id?: string;
  [key: string]: unknown;
};

function normalizeHomepassPoint(value: unknown): TopologyHomepassPoint | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const coords = record.coords;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  const odpIdx = typeof record.odpIdx === 'number' ? record.odpIdx : 0;
  return {
    coords: [lng, lat],
    odpIdx,
    id: typeof record.id === 'string' ? record.id : undefined,
  };
}

const formatCoords = (point: TopologyHomepassPoint) => `${point.coords[0]},${point.coords[1]}`;

export function mergeCalculationWithHomepasses(
  previousTopology: unknown,
  nextCalcResult: FtthCalcApiResponse,
): FtthCalcApiResponse & { homepassPoints?: TopologyHomepassPoint[] } {
  const previous = previousTopology as { homepassPoints?: unknown[] } | null | undefined;
  const previousPoints = Array.isArray(previous?.homepassPoints)
    ? previous.homepassPoints.map(normalizeHomepassPoint).filter((p): p is TopologyHomepassPoint => p !== null)
    : [];

  if (previousPoints.length === 0) {
    return nextCalcResult as FtthCalcApiResponse & { homepassPoints?: TopologyHomepassPoint[] };
  }

  const currentPoints = Array.isArray((nextCalcResult as any).homepassPoints)
    ? (nextCalcResult as any).homepassPoints.map(normalizeHomepassPoint).filter((p): p is TopologyHomepassPoint => p !== null)
    : [];

  const merged: TopologyHomepassPoint[] = [...currentPoints];
  const seen = new Set(currentPoints.map(formatCoords));

  previousPoints.forEach((point) => {
    const key = formatCoords(point);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(point);
    }
  });

  return {
    ...nextCalcResult,
    homepassPoints: merged,
  };
}
