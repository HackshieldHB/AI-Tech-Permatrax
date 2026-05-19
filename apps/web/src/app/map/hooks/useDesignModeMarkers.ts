import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { applyCommand } from '../commands/core';
import type { MoveNodeCommand, DeleteNodeCommand, AddEdgeCommand } from '../commands/types';
import { useCommandStore } from '../../../store/useCommandStore';
import { useDesignStore } from '../../../store/useDesignStore';
import { finalizeEdgeDrawing } from '../edgeLogic';

const HIDE_ON_EDIT_ON = [
  'topo-backbone-circle',
  'topo-backbone-label',
  'topo-odc-circle',
  'topo-odc-label',
  'topo-odp-circle',
  'topo-odp-label',
  'topo-feeder-line',
  'topo-dist-line',
  'topo-drop-line',
  'topo-closure-circle',
  'topo-closure-label',
  'topo-tiang-circle',
  'topo-tiang-label',
] as const;

const NODE_COLORS: Record<string, string> = {
  OLT: '#1D4ED8',
  ODC: '#7C3AED',
  ODP: '#16A34A',
  SPLITTER: '#EC4899',
  SPLICE: '#F97316',
  POLE: '#4B5563',
  CONNECTOR: '#14B8A6',
};

function createDraggableMarker(
  map: maplibregl.Map,
  refId: string,
  coordinates: [number, number],
  nodeType: string,
  dragStartCoordsRef: MutableRefObject<Record<string, [number, number]>>
) {
  const markerEl = document.createElement('div');
  markerEl.style.width = '14px';
  markerEl.style.height = '14px';
  markerEl.style.borderRadius = '50%';
  
  markerEl.style.background = NODE_COLORS[nodeType] ?? '#16A34A';

  markerEl.style.border = '2px solid #ffffff';
  markerEl.style.boxShadow = '0 1px 8px rgba(0,0,0,0.3)';
  markerEl.style.cursor = 'pointer';

  const marker = new maplibregl.Marker({ element: markerEl, draggable: true })
    .setLngLat(coordinates)
    .addTo(map);

  marker.on('dragstart', () => {
    const currentNode = useDesignStore.getState().nodes[refId];
    if (!currentNode) return;
    dragStartCoordsRef.current[refId] = [currentNode.coordinates[0], currentNode.coordinates[1]];
  });

  marker.on('drag', () => {
    const currentNode = useDesignStore.getState().nodes[refId];
    if (!currentNode) return;
    const ll = marker.getLngLat();
    const cmd: MoveNodeCommand = {
      type: 'MoveNode',
      refId,
      fromCoords: [currentNode.coordinates[0], currentNode.coordinates[1]],
      toCoords: [ll.lng, ll.lat],
    };
    const { nodes: curNodes, edges: curEdges } = useDesignStore.getState();
    const next = applyCommand({ nodes: curNodes, edges: curEdges }, cmd);
    useDesignStore.setState({ nodes: next.nodes, edges: next.edges });
  });

  marker.on('dragend', () => {
    const start = dragStartCoordsRef.current[refId];
    const currentNode = useDesignStore.getState().nodes[refId];
    if (!start || !currentNode) return;
    const end: [number, number] = [currentNode.coordinates[0], currentNode.coordinates[1]];
    const changed = start[0] !== end[0] || start[1] !== end[1];
    if (!changed) return;

    const finalCmd: MoveNodeCommand = {
      type: 'MoveNode',
      refId,
      fromCoords: [start[0], start[1]],
      toCoords: [end[0], end[1]],
    };
    useCommandStore.getState().dispatch(finalCmd);
  });

  markerEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const state = useDesignStore.getState();
    const activeTool = state.activeTool;
    
    if (activeTool === 'delete') {
      const node = state.nodes[refId];
      if (!node) return;
      
      const connectedEdges = Object.values(state.edges).filter(
        edge => edge.fromRef === refId || edge.toRef === refId
      );
      
      if (connectedEdges.length > 0) {
        const confirmed = window.confirm(
          `Hapus ${node.type} dan ${connectedEdges.length} jalur terhubung?`
        );
        if (!confirmed) return;
      }
      
      const cmd: DeleteNodeCommand = {
        type: 'DeleteNode',
        refId,
        removedNode: node,
        removedEdges: connectedEdges,
      };
      useCommandStore.getState().dispatch(cmd);
      return;
    }

    if (activeTool && activeTool.startsWith('add-edge-')) {
      const edgeTypeRaw = activeTool.split('add-edge-')[1]?.toUpperCase();
      if (!edgeTypeRaw) return;
      const edgeType = edgeTypeRaw as 'FEEDER' | 'DISTRIBUTION' | 'DROP';

      if (!state.drawingEdgeStartRef) {
        state.setDrawingEdgeStartRef(refId);
        return;
      }

      if (state.drawingEdgeStartRef === refId) {
        state.setDrawingEdgeStartRef(null);
        return;
      }

      const startNode = state.nodes[state.drawingEdgeStartRef];
      const currentNode = state.nodes[refId];
      if (!startNode || !currentNode) {
        state.setDrawingEdgeStartRef(null);
        return;
      }

      const startRef = state.drawingEdgeStartRef;

      // FIX: If the user clicks the EXACT SAME node they started from, cancel the drawing!
      if (startRef === refId) {
        useDesignStore.setState({ drawingEdgeStartRef: null, drawingEdgeCoords: [] });
        return; // Stop execution, do NOT dispatch AddEdgeCommand
      }

      const newEdgeRefId = `edge-${Date.now()}`;
      const cmd: AddEdgeCommand = {
        type: 'AddEdge',
        refId: newEdgeRefId,
        fromRef: startNode.refId,
        toRef: currentNode.refId,
        edgeType,
        coordinates: [
          [startNode.coordinates[0], startNode.coordinates[1]],
          ...state.drawingEdgeCoords,
          [currentNode.coordinates[0], currentNode.coordinates[1]]
        ],
      };
      
      // FIX: Prevent accidental zero-length or self-loop edges
      if (cmd.fromRef === cmd.toRef) return;

      useCommandStore.getState().dispatch(cmd);
      
      const node = state.nodes[refId];
      // If the clicked node is a routing infrastructure (POLE or SPLICE), anchor the line to it!
      if (node?.type === 'POLE' || node?.type === 'SPLICE') {
        useDesignStore.setState({ 
          drawingEdgeStartRef: refId, 
          drawingEdgeCoords: [] 
        });
      } else {
        // If it's an end-point (OLT, ODC, ODP), finish the drawing.
        useDesignStore.setState({ 
          drawingEdgeStartRef: null, 
          drawingEdgeCoords: [] 
        });
      }
      return;
    }

    // Pilih/Geser mode — select node for properties panel
    if (activeTool === null) {
      state.setSelectedFeatureRef(refId);
      return;
    }
  });

  return marker;
}

export function useDesignModeMarkers(params: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  editMode: boolean;
}): void {
  const { mapRef, editMode } = params;
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const dragStartCoordsRef = useRef<Record<string, [number, number]>>({});

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    HIDE_ON_EDIT_ON.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, 'visibility', editMode ? 'none' : 'visible');
    });

    if (!editMode) {
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      dragStartCoordsRef.current = {};
      return;
    }

    const nodes = useDesignStore.getState().nodes;
    const nextMarkers: Record<string, maplibregl.Marker> = {};

    for (const [refId, node] of Object.entries(nodes)) {
      nextMarkers[refId] = createDraggableMarker(map, refId, node.coordinates, node.type, dragStartCoordsRef);
    }

    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = nextMarkers;

    const handleHomepassClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const state = useDesignStore.getState();
      if (state.sketchMode) return;
      if (!state.editMode || state.activeTool !== 'add-edge-drop') return;

      e.preventDefault(); // Stop propagation to background map

      const startRef = state.drawingEdgeStartRef;
      if (!startRef) {
        toast.error('Kabel Drop harus ditarik dari ODP/POLE ke Homepass');
        return;
      }

      const startNode = state.nodes[startRef];
      const homepassFeature = e.features?.[0];
      const homepassId = homepassFeature?.properties?.id || homepassFeature?.id?.toString();

      if (!startNode || !homepassId) return;

      const homepassCoords = [e.lngLat.lng, e.lngLat.lat] as [number, number];

      const cmd: AddEdgeCommand = {
        type: 'AddEdge',
        refId: `edge-${Date.now()}`,
        fromRef: startRef,
        toRef: homepassId,
        edgeType: 'DROP',
        coordinates: [
          [startNode.coordinates[0], startNode.coordinates[1]],
          ...state.drawingEdgeCoords,
          homepassCoords
        ]
      };
      
      useCommandStore.getState().dispatch(cmd);
      
      // Finish the drawing action
      useDesignStore.setState({
        drawingEdgeStartRef: null,
        drawingEdgeCoords: []
      });
    };

    map.on('click', 'topo-homepass', handleHomepassClick);

    return () => {
      map.off('click', 'topo-homepass', handleHomepassClick);
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      dragStartCoordsRef.current = {};
    };
  }, [editMode, mapRef]);

  useEffect(() => {
    if (!editMode) return;
    const map = mapRef.current;
    if (!map) return;

    const unsubscribe = useDesignStore.subscribe((state, prev) => {
      if (
        state.nodes === prev.nodes &&
        state.drawingEdgeStartRef === prev.drawingEdgeStartRef &&
        state.selectedFeatureRef === prev.selectedFeatureRef &&
        state.activeTool === prev.activeTool
      ) return;

      if (state.activeTool !== prev.activeTool) {
        if (map.getLayer('ghost-edge-layer')) {
          const color = state.activeTool === 'add-edge-feeder' ? '#EF4444' :
                        state.activeTool === 'add-edge-distribution' ? '#3B82F6' : '#111827';
          map.setPaintProperty('ghost-edge-layer', 'line-color', color);
        }
      }
      
      // ADD: nodes in state but not in markersRef
      for (const [refId, node] of Object.entries(state.nodes)) {
        if (markersRef.current[refId]) continue;
        markersRef.current[refId] = createDraggableMarker(map, refId, node.coordinates, node.type, dragStartCoordsRef);
      }
      
      // REMOVE: markers without corresponding node
      for (const refId of Object.keys(markersRef.current)) {
        if (!state.nodes[refId]) {
          markersRef.current[refId]!.remove();
          delete markersRef.current[refId];
        }
      }

      // UPDATE: position drift on existing markers
      for (const [refId, marker] of Object.entries(markersRef.current)) {
        const node = state.nodes[refId];
        if (!node) continue;
        const ll = marker.getLngLat();
        // Guard prevents drag-loop churn by only syncing changed coordinates.
        if (ll.lng !== node.coordinates[0] || ll.lat !== node.coordinates[1]) {
          marker.setLngLat(node.coordinates);
        }
        
        // UPDATE: visual cues (selection > edge-drawing > default)
        const markerEl = marker.getElement();
        if (state.selectedFeatureRef === refId) {
          markerEl.style.border = '2px solid #3B82F6';
          markerEl.style.boxShadow = '0 0 0 4px rgba(59, 130, 246, 0.35)';
        } else if (state.drawingEdgeStartRef === refId) {
          markerEl.style.border = '2px solid #FCD34D';
          markerEl.style.boxShadow = '0 0 0 4px rgba(252, 211, 77, 0.4)';
        } else {
          markerEl.style.border = '2px solid #ffffff';
          markerEl.style.boxShadow = '0 1px 8px rgba(0,0,0,0.3)';
        }
      }

      // CLEAR GHOST LINE if cancelled
      if (state.drawingEdgeStartRef === null && prev.drawingEdgeStartRef !== null) {
        const source = map.getSource('ghost-edge-source') as maplibregl.GeoJSONSource;
        if (source) {
          source.setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [] },
            properties: {},
          });
        }
      }
    });

    const edgeLayers = ['topo-feeder-line', 'topo-dist-line', 'topo-drop-line'];
    
    const onEdgeClick = (e: maplibregl.MapMouseEvent) => {
      const state = useDesignStore.getState();
      if (state.sketchMode) return;

      const features = map.queryRenderedFeatures(e.point, { layers: edgeLayers });
      if (!features.length) return;

      const feature = features[0];
      const refId = feature?.properties?.refId;
      if (!refId) return;

      const edge = state.edges[refId];
      if (!edge) return;

      // Delete tool — delete the edge
      if (state.activeTool === 'delete') {
        e.preventDefault();

        const confirmed = window.confirm(`Hapus jalur ${edge.type}?`);
        if (!confirmed) return;

        const cmd: import('../commands/types').DeleteEdgeCommand = {
          type: 'DeleteEdge',
          refId,
          removedEdge: edge,
        };
        useCommandStore.getState().dispatch(cmd);
        return;
      }

      // Pilih/Geser mode — select the edge
      if (state.activeTool === null) {
        e.preventDefault();
        state.setSelectedFeatureRef(refId);
        return;
      }
    };

    edgeLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.on('click', layerId, onEdgeClick);
      }
    });

    return () => {
      unsubscribe();
      edgeLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          map.off('click', layerId, onEdgeClick);
        }
      });
    };
  }, [editMode, mapRef]);

  useEffect(() => {
    if (!editMode) return;
    const map = mapRef.current;
    if (!map) return;

    const GHOST_SOURCE_ID = 'ghost-edge-source';
    const GHOST_LAYER_ID = 'ghost-edge-layer';
    const DRAFT_SOURCE_ID = 'draft-edges-source';
    const DRAFT_LAYER_ID = 'draft-edges-layer';

    if (!map.getSource(GHOST_SOURCE_ID)) {
      map.addSource(GHOST_SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [] },
          properties: {},
        },
      });
    }
    if (!map.getLayer(GHOST_LAYER_ID)) {
      const state = useDesignStore.getState();
      const color = state.activeTool === 'add-edge-feeder' ? '#EF4444' :
                    state.activeTool === 'add-edge-distribution' ? '#3B82F6' : '#111827';
      map.addLayer({
        id: GHOST_LAYER_ID,
        type: 'line',
        source: GHOST_SOURCE_ID,
        paint: {
          'line-color': color,
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      });
    }

    if (!map.getSource(DRAFT_SOURCE_ID)) {
      map.addSource(DRAFT_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    if (!map.getLayer(DRAFT_LAYER_ID)) {
      map.addLayer({
        id: DRAFT_LAYER_ID,
        type: 'line',
        source: DRAFT_SOURCE_ID,
        paint: {
          'line-color': [
            'match',
            ['get', 'type'],
            'FEEDER', '#EF4444',
            'DISTRIBUTION', '#3B82F6',
            'DROP', '#111827',
            '#000000'
          ],
          'line-width': 2.5,
          'line-opacity': 0.8
        }
      });
    }

    const unsubscribeEdges = useDesignStore.subscribe((state, prev) => {
      if (state.edges === prev.edges) return;
      const source = map.getSource(DRAFT_SOURCE_ID) as maplibregl.GeoJSONSource;
      if (!source) return;

      const features = Object.values(state.edges).map(edge => ({
        type: 'Feature' as const,
        properties: { id: edge.refId, type: edge.type, ...edge.properties },
        geometry: {
          type: 'LineString' as const,
          coordinates: edge.coordinates
        }
      }));

      source.setData({ type: 'FeatureCollection', features });
    });

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const state = useDesignStore.getState();
      const startRef = state.drawingEdgeStartRef;
      if (!startRef) return;
      
      const startNode = state.nodes[startRef];
      if (!startNode) return;
      
      const startCoords = startNode.coordinates;
      const endCoords = [e.lngLat.lng, e.lngLat.lat];
      
      const source = map.getSource(GHOST_SOURCE_ID) as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({
          type: 'Feature',
          geometry: { 
            type: 'LineString', 
            coordinates: [startCoords, ...state.drawingEdgeCoords, endCoords] 
          },
          properties: {},
        });
      }
    };

    map.on('mousemove', onMouseMove);

    // ── DBLCLICK handler: finalize edge drawing ──────────────────
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      const state = useDesignStore.getState();
      // Only intercept when an edge tool is active and we're mid-drawing
      if (!state.activeTool || !state.activeTool.startsWith('add-edge-')) return;
      if (!state.drawingEdgeStartRef) return;

      // Prevent default map doubleClickZoom
      e.preventDefault();

      const cmd = finalizeEdgeDrawing(state);
      if (cmd) {
        useCommandStore.getState().dispatch(cmd);
      }
      // Always clear drawing state on dblclick, even if cmd was null (e.g. 0 waypoints)
      useDesignStore.setState({ drawingEdgeStartRef: null, drawingEdgeCoords: [] });
    };

    // Disable map doubleClickZoom so our handler fires cleanly
    map.doubleClickZoom.disable();
    map.on('dblclick', onDblClick);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('dblclick', onDblClick);
      map.doubleClickZoom.enable();
      unsubscribeEdges();
      if (map.getLayer(GHOST_LAYER_ID)) map.removeLayer(GHOST_LAYER_ID);
      if (map.getSource(GHOST_SOURCE_ID)) map.removeSource(GHOST_SOURCE_ID);
      if (map.getLayer(DRAFT_LAYER_ID)) map.removeLayer(DRAFT_LAYER_ID);
      if (map.getSource(DRAFT_SOURCE_ID)) map.removeSource(DRAFT_SOURCE_ID);
    };
  }, [editMode, mapRef]);
}
