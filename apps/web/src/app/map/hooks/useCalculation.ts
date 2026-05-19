import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { apiGet, apiPost } from '../../../lib/api';
import { useDesignStore } from '../../../store/useDesignStore';
import { useCommandStore } from '../../../store/useCommandStore';
import { mergeCalculationWithHomepasses } from '../../../utils/topologyUtils';
import { toast } from 'sonner';
import type { FtthCalcApiResponse, OsmElement } from './types';

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
export function clearPolygonFromMap(map: maplibregl.Map) {
  ['poly-line', 'poly-fill', 'poly-points'].forEach((id) => {
    if (map.getLayer(id)) map.removeLayer(id); // FIX: layers before sources
  }); // FIX
  ['poly-fill', 'poly-points'].forEach((id) => {
    if (map.getSource(id)) map.removeSource(id); // FIX
  }); // FIX
} // FIX

export function useCalculation(args: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  clearTopology: () => void;
  renderTopology: (
    result: FtthCalcApiResponse,
    backbone: [number, number],
    target: [number, number],
    drawnPolygon?: [number, number][] | null,
  ) => Promise<void>;
  /** Lifted so useTopologyRender can subscribe before calculation runs (explicit wiring, no globals). */
  inputMode: 'radius' | 'polygon';
  setInputMode: Dispatch<SetStateAction<'radius' | 'polygon'>>;
  polygonPoints: [number, number][];
  setPolygonPoints: Dispatch<SetStateAction<[number, number][]>>;
  isDrawingPolygon: boolean;
  setIsDrawingPolygon: Dispatch<SetStateAction<boolean>>;
  polygonAreaSqM: number | null;
  setPolygonAreaSqM: Dispatch<SetStateAction<number | null>>;
  polygonCentroid: [number, number] | null;
  setPolygonCentroid: Dispatch<SetStateAction<[number, number] | null>>;
}) {
  const {
    mapRef,
    clearTopology,
    renderTopology,
    inputMode,
    setInputMode,
    polygonPoints,
    setPolygonPoints,
    isDrawingPolygon,
    setIsDrawingPolygon,
    polygonAreaSqM,
    setPolygonAreaSqM,
    polygonCentroid,
    setPolygonCentroid,
  } = args;
  const backboneMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);
  const polygonMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [calcMode, setCalcMode] = useState<'idle' | 'backbone' | 'target' | 'result'>('idle');
  const [backbonePoint, setBackbonePoint] = useState<[number, number] | null>(null);
  const [targetPoint, setTargetPoint] = useState<[number, number] | null>(null);
  const [areaType, setAreaType] = useState<'URBAN' | 'SUBURBAN' | 'RURAL'>('URBAN');
  const [areaRadius, setAreaRadius] = useState(300);
  const [calcResult, setCalcResult] = useState<FtthCalcApiResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [nearestBackbone, setNearestBackbone] = useState<OsmElement | null>(null);

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
      const { editMode, activeTool } = useDesignStore.getState();
      
      if (editMode) {
        if (activeTool && activeTool.startsWith('add-')) {
          if (activeTool.startsWith('add-edge-') && useDesignStore.getState().drawingEdgeStartRef !== null) {
            const state = useDesignStore.getState();
            state.setDrawingEdgeCoords([...state.drawingEdgeCoords, [e.lngLat.lng, e.lngLat.lat]]);
            return;
          }

          if (!activeTool.startsWith('add-edge-')) {
            const nodeType = activeTool.replace('add-', '').toUpperCase();
            const cmd = {
              type: 'AddNode' as const,
              refId: crypto.randomUUID(),
              nodeType: nodeType as import('../../map/commands/types').CommandNodeType,
              coordinates: [e.lngLat.lng, e.lngLat.lat] as [number, number],
            };
            useCommandStore.getState().dispatch(cmd);
            return;
          }
        }
        
        // Pilih/Geser mode — clicking empty map deselects the feature
        if (activeTool === null) {
          useDesignStore.getState().setSelectedFeatureRef(null);
        }
        return;
      }

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
      const mergedResult = mergeCalculationWithHomepasses(useDesignStore.getState().baseTopology, result); // FIX
      setCalcResult(mergedResult); // FIX
      useDesignStore.getState().setCalcData({
        areaType,
        areaRadiusMeters: areaRadius,
        polygonAreaSqM: inputMode === 'polygon' ? polygonAreaSqM ?? undefined : undefined,
        backbonePoint,
        targetPoint,
        polygonCentroid: inputMode === 'polygon' && polygonCentroid ? polygonCentroid : undefined,
      }, mergedResult);
      toast.success('✅ Kalkulasi selesai!'); // FIX
      if (backbonePoint && targetPoint) {
        await renderTopology(
          mergedResult, // FIX
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

  return {
    polygonMarkersRef,
    calcMode,
    setCalcMode,
    backbonePoint,
    setBackbonePoint,
    targetPoint,
    setTargetPoint,
    areaType,
    setAreaType,
    areaRadius,
    setAreaRadius,
    calcResult,
    setCalcResult,
    calculating,
    nearestBackbone,
    setNearestBackbone,
    runCalculation,
    handleStartCalc,
    startCalculation,
    clearCalcGraphics,
  };
}
