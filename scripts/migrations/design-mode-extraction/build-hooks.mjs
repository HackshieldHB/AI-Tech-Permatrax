import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sd = path.join(__dirname, '_slices');
const read = (f) => fs.readFileSync(path.join(sd, f), 'utf8');

const helpers = read('helpers-pre-export.txt').split(/\n/);
const topoHelpers = [...helpers.slice(25, 380), ...helpers.slice(425)].join('\n');

const topoIds = read('topo-ids.txt');
const clearTopology = read('clearTopology.txt');
const renderTopology = read('renderTopology.txt');

const buildDesignGeometryBlock = `
/** Phase 2: constructs GeoJSON for POST /api/design (topology contract — nodes/edges with refIds). */
export function buildDesignGeometry(args: {
  backbone: [number, number];
  odcPoint: [number, number];
  odpPositions: [number, number][];
  feederCoords: [number, number][];
  distRoutes: [number, number][][];
}): GeoJSON.FeatureCollection {
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
  const feats: GeoJSON.Feature[] = [];

  feats.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: args.backbone },
    properties: { kind: 'node' satisfies NodeKind, type: 'OLT', refId: 'olt-1' },
  });
  feats.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: args.odcPoint },
    properties: { kind: 'node' satisfies NodeKind, type: 'ODC', refId: 'odc-1' },
  });
  args.odpPositions.forEach((coords, i) => {
    feats.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coords },
      properties: { kind: 'node' satisfies NodeKind, type: 'ODP', refId: \`odp-\${i + 1}\` },
    });
  });

  feats.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: args.feederCoords },
    properties: {
      kind: 'edge' satisfies EdgeKind,
      type: 'FEEDER',
      fromRef: 'olt-1',
      toRef: 'odc-1',
      length_m: routeLenM(args.feederCoords),
      route_source: 'osrm',
    },
  });

  args.distRoutes.forEach((routeCoords, segIdx) => {
    const fromRef = segIdx === 0 ? 'odc-1' : \`odp-\${segIdx}\`;
    const toRef = \`odp-\${segIdx + 1}\`;
    feats.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: routeCoords },
      properties: {
        kind: 'edge' satisfies EdgeKind,
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
`;

const useTopologyRender = `import type { MutableRefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import type * as GeoJSON from 'geojson';
import { toast } from 'sonner';
import { API_BASE } from '../../../lib/api';
import { useAuthStore } from '../../../store/authStore';
import type { FtthCalcApiResponse, TopoExportData } from './types';

// ── Topology layer ids (verbatim from page.tsx) ───────────────────────────────
${topoIds}

// ── Topology helpers colocated here (omit getAllCoordinates → useKmzLayers) ──
${topoHelpers}
${buildDesignGeometryBlock}

/**
 * Phase 1: topoExportData is owned here and passed into export handlers via the page/useExports wiring.
 */
export function useTopologyRender(args: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  /** Explicit shared calc input — avoid implicit cross-hook refs (see GIS map refactor notes). */
  inputMode: 'radius' | 'polygon';
  polygonPoints: [number, number][];
}) {
  const { mapRef, inputMode, polygonPoints } = args;
  const [renderingTopology, setRenderingTopology] = useState(false);
  const [topologyRendered, setTopologyRendered] = useState(false);
  const [topoExportData, setTopoExportData] = useState<TopoExportData | null>(null);
  const topoHandlersRef = useRef<
    Array<{
      layerId: string;
      ev: 'click' | 'mouseenter' | 'mouseleave';
      fn: (e: maplibregl.MapLayerMouseEvent) => void;
    }>
  >([]);

${clearTopology}

${renderTopology}

  /** Phase 2: wire to POST /api/design — stub for Phase 1. */
  const saveDesignAsDraft = useCallback(async () => {
    await Promise.resolve(undefined);
  }, []);

  return {
    renderingTopology,
    topologyRendered,
    topoExportData,
    topoHandlersRef,
    clearTopology,
    renderTopology,
    saveDesignAsDraft,
  };
}
`;

fs.writeFileSync(path.join(__dirname, 'useTopologyRender.ts'), useTopologyRender, 'utf8');
console.log('wrote useTopologyRender.ts');
