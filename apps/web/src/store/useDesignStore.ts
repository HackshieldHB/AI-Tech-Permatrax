import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Feature, FeatureCollection } from 'geojson';
import { parseLineStringCoordinates, parsePoint } from '../app/map/utils/geojsonMapper';

type DesignNodeType = 'OLT' | 'ODC' | 'ODP' | 'SPLITTER' | 'SPLICE' | 'POLE' | 'CONNECTOR';
type DesignEdgeType = 'FEEDER' | 'DISTRIBUTION' | 'DROP';
type DesignOrigin = 'AUTO' | 'MANUAL' | 'MODIFIED';

const VALID_NODE_TYPES = ['OLT', 'ODC', 'ODP', 'SPLITTER', 'SPLICE', 'POLE', 'CONNECTOR'] as const;
const VALID_EDGE_TYPES = ['FEEDER', 'DISTRIBUTION', 'DROP'] as const;
const VALID_ORIGINS = ['AUTO', 'MANUAL', 'MODIFIED'] as const;

function isValidNodeType(value: unknown): value is DesignNodeType {
  return typeof value === 'string' && (VALID_NODE_TYPES as readonly string[]).includes(value);
}

function isValidEdgeType(value: unknown): value is DesignEdgeType {
  return typeof value === 'string' && (VALID_EDGE_TYPES as readonly string[]).includes(value);
}

function isValidOrigin(value: unknown): value is DesignOrigin {
  return typeof value === 'string' && (VALID_ORIGINS as readonly string[]).includes(value);
}

function isPointCoordinates(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isLineStringCoordinates(value: unknown): value is [number, number][] {
  return (
    Array.isArray(value) &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number',
    )
  );
}

function safeProperties(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractFeatureCollection(payload: unknown): FeatureCollection {
  if (
    payload &&
    typeof payload === 'object' &&
    (payload as FeatureCollection).type === 'FeatureCollection' &&
    Array.isArray((payload as FeatureCollection).features)
  ) {
    return payload as FeatureCollection;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).geometry === 'object'
  ) {
    const geometry = (payload as Record<string, unknown>).geometry as unknown;
    if (
      geometry &&
      typeof geometry === 'object' &&
      (geometry as FeatureCollection).type === 'FeatureCollection' &&
      Array.isArray((geometry as FeatureCollection).features)
    ) {
      return geometry as FeatureCollection;
    }
  }

  return { type: 'FeatureCollection', features: [] };
}

function normalizeNodePayload(node: unknown): DesignStoreNode | null {
  if (typeof node !== 'object' || node === null) return null;
  const entry = node as Record<string, unknown>;
  const refId =
    typeof entry.refId === 'string'
      ? entry.refId
      : typeof entry.id === 'string'
      ? entry.id
      : undefined;
  const typeRaw = entry.type;
  if (!isValidNodeType(typeRaw)) return null;
  const coordinates = parsePoint(entry.coordinates ?? (entry.geometry as any)?.coordinates);
  if (!coordinates) return null;
  const origin = isValidOrigin(entry.origin) ? entry.origin : 'AUTO';

  return {
    refId,
    type: typeRaw,
    origin,
    coordinates,
    properties: safeProperties(entry.properties),
  };
}

function normalizeEdgePayload(edge: unknown): DesignStoreEdge | null {
  if (typeof edge !== 'object' || edge === null) return null;
  const entry = edge as Record<string, unknown>;
  const refId =
    typeof entry.refId === 'string'
      ? entry.refId
      : typeof entry.id === 'string'
      ? entry.id
      : undefined;
  const typeRaw = entry.type;
  if (!isValidEdgeType(typeRaw)) return null;
  const fromRef = typeof entry.fromRef === 'string' ? entry.fromRef : undefined;
  const toRef = typeof entry.toRef === 'string' ? entry.toRef : undefined;
  const coordinates = parseLineStringCoordinates(entry.coordinates ?? (entry.geometry as any)?.coordinates ?? (entry.properties as any)?.coordinates);
  if (coordinates.length < 2) return null;
  const origin = isValidOrigin(entry.origin) ? entry.origin : 'AUTO';

  return {
    refId,
    fromRef,
    toRef,
    type: typeRaw,
    origin,
    coordinates,
    properties: safeProperties(entry.properties),
  };
}

function normalizeNodesFromArray(nodes: unknown): Record<string, DesignStoreNode> {
  if (!Array.isArray(nodes)) return {};
  return nodes.reduce<Record<string, DesignStoreNode>>((acc, node) => {
    const normalized = normalizeNodePayload(node);
    if (normalized) acc[normalized.refId] = normalized;
    return acc;
  }, {});
}

function normalizeEdgesFromArray(edges: unknown): Record<string, DesignStoreEdge> {
  if (!Array.isArray(edges)) return {};
  return edges.reduce<Record<string, DesignStoreEdge>>((acc, edge) => {
    const normalized = normalizeEdgePayload(edge);
    if (normalized) acc[normalized.refId] = normalized;
    return acc;
  }, {});
}

function nodesFromFeatureCollection(geometry: FeatureCollection): Record<string, DesignStoreNode> {
  const allFeatures = Array.isArray(geometry.features) ? geometry.features : [];
  return allFeatures.reduce<Record<string, DesignStoreNode>>((acc, feature) => {
    if (
      feature?.type !== 'Feature' ||
      feature.geometry?.type !== 'Point' ||
      (feature.properties as Record<string, unknown> | undefined)?.kind !== 'node'
    ) {
      return acc;
    }

    const props = ((feature.properties as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const refIdRaw = props.refId;
    const typeRaw = props.type;
    const originRaw = props.origin;
    const coords = (feature.geometry as unknown as { coordinates?: [number, number] } | undefined)?.coordinates;

    if (typeof refIdRaw !== 'string' || !isPointCoordinates(coords)) return acc;
    if (!isValidNodeType(typeRaw)) return acc;

    acc[refIdRaw] = {
      refId: refIdRaw,
      type: typeRaw,
      origin: isValidOrigin(originRaw) ? originRaw : 'AUTO',
      coordinates: coords,
      properties: props,
    };
    return acc;
  }, {});
}

function edgesFromFeatureCollection(geometry: FeatureCollection): Record<string, DesignStoreEdge> {
  const allFeatures = Array.isArray(geometry.features) ? geometry.features : [];
  return allFeatures.reduce<Record<string, DesignStoreEdge>>((acc, feature, index) => {
    if (
      feature?.type !== 'Feature' ||
      feature.geometry?.type !== 'LineString' ||
      (feature.properties as Record<string, unknown> | undefined)?.kind !== 'edge'
    ) {
      return acc;
    }

    const props = ((feature.properties as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const typeRaw = props.type;
    const fromRefRaw = props.fromRef;
    const toRefRaw = props.toRef;
    const refIdRaw = props.refId;
    const coords = (feature.geometry as unknown as { coordinates?: [number, number][] } | undefined)?.coordinates ?? [];

    if (!isValidEdgeType(typeRaw)) return acc;
    if (typeof fromRefRaw !== 'string' || typeof toRefRaw !== 'string' || coords.length < 2) return acc;

    const edgeRefId = typeof refIdRaw === 'string' && refIdRaw.length > 0 ? refIdRaw : `edge-${index + 1}`;
    const originRaw = props.origin;

    acc[edgeRefId] = {
      refId: edgeRefId,
      fromRef: fromRefRaw,
      toRef: toRefRaw,
      type: typeRaw,
      origin: isValidOrigin(originRaw) ? originRaw : 'AUTO',
      coordinates: coords,
      properties: props,
    };
    return acc;
  }, {});
}

export type DesignStoreNode = {
  refId: string;
  type: DesignNodeType;
  origin: DesignOrigin;
  coordinates: [number, number];
  properties: Record<string, unknown>;
};

export type DesignStoreEdge = {
  refId: string;
  fromRef: string;
  toRef: string;
  type: DesignEdgeType;
  origin: DesignOrigin;
  coordinates: [number, number][];
  properties: Record<string, unknown>;
};

export type ActiveTool =
  | 'add-olt' | 'add-odc' | 'add-odp'
  | 'add-splitter' | 'add-splice' | 'add-pole' | 'add-connector'
  | 'add-edge-feeder' | 'add-edge-distribution' | 'add-edge-drop'
  | 'delete'
  | null;

export interface DesignStoreState {
  designId: string | null;
  editMode: boolean;
  activeTool: ActiveTool;
  drawingEdgeStartRef: string | null;
  drawingEdgeCoords: [number, number][];
  selectedFeatureRef: string | null;
  nodes: Record<string, DesignStoreNode>;
  edges: Record<string, DesignStoreEdge>;
  projectId: string | null;
  calcInputs: Record<string, unknown> | null;
  baseTopology: Record<string, unknown> | null;
  sketchMode: boolean;
  sketchTopology: any;
  sketchOpacity: number;
  /** Incremented to ask MapboxDraw to trash the currently selected sketch feature(s). */
  sketchTrashTick: number;
  requestSketchTrash: () => void;
  hydrate: (
    designId: string,
    payload: any,
    calcInputs?: Record<string, unknown> | null,
    baseTopology?: Record<string, unknown> | null,
    sketchTopology?: any,
  ) => void;
  clear: () => void;
  setEditMode: (next: boolean) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setDrawingEdgeStartRef: (ref: string | null) => void;
  setDrawingEdgeCoords: (coords: [number, number][]) => void;
  setSelectedFeatureRef: (ref: string | null) => void;
  setProjectId: (id: string | null) => void;
  setCalcData: (inputs: Record<string, unknown>, topology: Record<string, unknown>) => void;
  setSketchMode: (mode: boolean) => void;
  setSketchTopology: (fc: any) => void;
  setSketchOpacity: (opacity: number) => void;
  getNode: (refId: string) => DesignStoreNode | undefined;
  getEdgesForNode: (refId: string) => DesignStoreEdge[];
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}

export const useDesignStore = create<DesignStoreState>()(
  persist(
    (set, get) => ({
  designId: null,
  projectId: null,
  calcInputs: null,
  baseTopology: null,
  sketchMode: false,
  sketchTopology: { type: 'FeatureCollection', features: [] },
  sketchOpacity: 1,
  sketchTrashTick: 0,
  requestSketchTrash: () => set((s) => ({ sketchTrashTick: s.sketchTrashTick + 1 })),
  editMode: false,
  activeTool: null,
  drawingEdgeStartRef: null,
  drawingEdgeCoords: [],
  selectedFeatureRef: null,
  nodes: {},
  edges: {},
  selectedNodeIds: new Set<string>(),
  selectedEdgeIds: new Set<string>(),

  setProjectId: (id) => set({ projectId: id }),
  setCalcData: (calcInputs, baseTopology) => set({ calcInputs, baseTopology }),
  setSketchMode: (sketchMode) => set({ sketchMode }),
  setSketchTopology: (sketchTopology) => set({ sketchTopology }),
  setSketchOpacity: (sketchOpacity) => set({ sketchOpacity }),

  hydrate: (
    designId: string,
    payload: any,
    calcInputs?: Record<string, unknown> | null,
    baseTopology?: Record<string, unknown> | null,
    sketchTopology?: any,
  ) => {
    const normalizedGeometry = extractFeatureCollection(payload);

    const nodesFromApi = normalizeNodesFromArray(
      payload?.nodes ?? payload?.geometry?.nodes,
    );
    const edgesFromApi = normalizeEdgesFromArray(
      payload?.edges ?? payload?.geometry?.edges,
    );

    const nextNodes =
      Object.keys(nodesFromApi).length > 0
        ? nodesFromApi
        : nodesFromFeatureCollection(normalizedGeometry);
    const nextEdges =
      Object.keys(edgesFromApi).length > 0
        ? edgesFromApi
        : edgesFromFeatureCollection(normalizedGeometry);

    const maybeProjectId =
      payload && typeof payload === 'object' && payload.projectId && typeof payload.projectId === 'string'
        ? payload.projectId
        : get().projectId;

    set({
      designId,
      projectId: maybeProjectId,
      editMode: false,
      activeTool: null,
      drawingEdgeStartRef: null,
      nodes: nextNodes,
      edges: nextEdges,
      calcInputs: calcInputs ?? get().calcInputs,
      baseTopology: baseTopology ?? get().baseTopology,
      sketchTopology: sketchTopology || { type: 'FeatureCollection', features: [] },
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
    });
  },

  clear: () =>
    set({
      designId: null,
      projectId: null,
      calcInputs: null,
      baseTopology: null,
      sketchMode: false,
      sketchTopology: { type: 'FeatureCollection', features: [] },
      sketchOpacity: 1,
      editMode: false,
      activeTool: null,
      drawingEdgeStartRef: null,
      nodes: {},
      edges: {},
      selectedNodeIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
    }),

  setEditMode: (next) => set((s) => ({ editMode: next, activeTool: next ? s.activeTool : null, drawingEdgeStartRef: next ? s.drawingEdgeStartRef : null, drawingEdgeCoords: next ? s.drawingEdgeCoords : [] })),

  setActiveTool: (tool) => set((s) => ({
    activeTool: tool,
    drawingEdgeStartRef: null,
    drawingEdgeCoords: [],
    selectedFeatureRef: tool !== null ? null : s.selectedFeatureRef,
  })),

  setDrawingEdgeStartRef: (ref) => set({ drawingEdgeStartRef: ref, drawingEdgeCoords: [] }),

  setDrawingEdgeCoords: (coords) => set({ drawingEdgeCoords: coords }),

  setSelectedFeatureRef: (ref) => set({ selectedFeatureRef: ref }),

  getNode: (refId) => get().nodes[refId],

  getEdgesForNode: (refId) =>
    Object.values(get().edges).filter((edge) => edge.fromRef === refId || edge.toRef === refId),
}),
    {
      name: 'permatrack-design-store',
      // FIX: Do NOT persist projectId - it changes per project
      // Persist only user preferences, not active working state
      partialize: () => ({}),
    }
  )
);
