'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

import { useExports } from './hooks/useExports';
import { useClusters } from './hooks/useClusters';
import { useCalculation } from './hooks/useCalculation';
import { useKmzLayers } from './hooks/useKmzLayers';
import { useMapInstance } from './hooks/useMapInstance';
import { useDesign } from './hooks/useDesign';
import { useTopologyRender } from './hooks/useTopologyRender';
import { useDesignModeMarkers } from './hooks/useDesignModeMarkers';
import { useDesignModeSync } from './hooks/useDesignModeSync';
import { useSketchMode } from './hooks/useSketchMode';
import { runCommandSoakTest } from './test/commandSoakTest';
import { runCommandStoreCheck } from './test/commandStoreCheck';

import { LeftSidebar } from './components/LeftSidebar';
import { MapOverlays } from './components/MapOverlays';
import { MapTourOverlay } from './components/MapTourOverlay';
import { SearchBar } from './components/SearchBar';
import { useCommandStore } from '../../store/useCommandStore';
import { useDesignStore } from '../../store/useDesignStore';
import {
  extractExistingFromDesignNodes,
  extractExistingFromKmzLayers,
  mergeExistingInfra,
} from './utils/existingInfra';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function GisMapPage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const searchParams = useSearchParams();

  /** Shared explicitly with useTopologyRender (no implicit cross-hook refs). */
  const [inputMode, setInputMode] = useState<'radius' | 'polygon'>('radius');
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [polygonAreaSqM, setPolygonAreaSqM] = useState<number | null>(null);
  const [polygonCentroid, setPolygonCentroid] = useState<[number, number] | null>(null);

  const [activePanel, setActivePanel] = useState<'layers' | 'calc' | 'legend' | 'design' | null>('legend');

  const { exporting, setExporting } = useExports();

  /** Cluster markers + KMZ both key off map style reload (see TILE_LAYERS switch). */
  const [styleEpoch, setStyleEpoch] = useState(0);

  const { clusters, layers, setLayers, loading, loadData, getPhaseColor, CATEGORY_CONFIG } =
    useClusters(mapRef, styleEpoch);

  const {
    mapContainerRef,
    mapType,
    switchMapType,
    TILE_LAYERS,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchLoading,
    showSearchDrop,
    setShowSearchDrop,
    handleSearchInput,
    handleSearchSelect,
  } = useMapInstance({ mapRef, loadData, styleEpoch, setStyleEpoch });

  const { uploadingKmz, handleKmzUpload, handleDeleteLayer, handleColorChange } = useKmzLayers({
    mapRef,
    layers,
    setLayers,
    styleEpoch,
  });

  // GIS Issue 5: Point features dari layer KMZ yang ditandai "Titik Pelanggan"
  // dipakai sebagai homepass pada kalkulasi topologi (menggantikan bangunan OSM)
  const kmzCustomerPoints = useMemo(() => {
    const pts: [number, number][] = [];
    layers.forEach((l) => {
      if (!l.useAsCustomers) return;
      (l.geoJson?.features ?? []).forEach((f) => {
        const g = f.geometry;
        if (g?.type === 'Point' && Array.isArray(g.coordinates)) {
          pts.push([g.coordinates[0] as number, g.coordinates[1] as number]);
        } else if (g?.type === 'MultiPoint') {
          (g.coordinates ?? []).forEach((c) => pts.push([c[0] as number, c[1] as number]));
        }
      });
    });
    return pts;
  }, [layers]);

  const designNodes = useDesignStore((s) => s.nodes);

  // JLM Issue 5 + Extra D: KMZ existing + Gambar Manual / design nodes
  const existingNetwork = useMemo(
    () =>
      mergeExistingInfra(
        extractExistingFromKmzLayers(layers),
        extractExistingFromDesignNodes(designNodes),
      ),
    [layers, designNodes],
  );

  const {
    renderingTopology,
    topologyRendered,
    topoExportData,
    lastRenderedGeometry,
    clearTopology,
    renderTopology,
    renderStoredDesign,
    buildDesignGeometry,
  } =
    useTopologyRender({
      mapRef,
      inputMode,
      polygonPoints,
      customerPoints: kmzCustomerPoints,
      existingNetwork: {
        olt: existingNetwork.olt,
        odc: existingNetwork.odc,
        odp: existingNetwork.odp,
      },
    });

  const {
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
    odpPortCapacity,
    setOdpPortCapacity,
    poleSpacing,
    setPoleSpacing,
    calcResult,
    setCalcResult,
    calculating,
    nearestBackbone,
    setNearestBackbone,
    runCalculation,
    handleStartCalc,
    clearCalcGraphics,
    abortCalculation,
    remapBackbone,
    remapTarget,
  } = useCalculation({
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
  });

  const {
    saveDesignAsDraft,
    listDesigns,
    loadDesign,
    loadedDesignId,
    designsList,
    listLoading,
    listError,
    detailLoading,
    detailError,
    saveLoading,
    saveError,
  } = useDesign({
    buildDesignGeometry,
    renderStoredDesign,
    setCalcResult,
    setCalcMode,
    setBackbonePoint,
    setTargetPoint,
  });

  const editMode = useDesignStore((s) => s.editMode);
  const setEditMode = useDesignStore((s) => s.setEditMode);
  const setProjectId = useDesignStore((s) => s.setProjectId);

  useEffect(() => {
    const q = searchParams.get('projectId')?.trim();
    if (!q) return;
    const cur = useDesignStore.getState().projectId?.trim();
    if (!cur) setProjectId(q);
  }, [searchParams, setProjectId]);

  const handleSetEditMode = async (next: boolean) => {
    const wasEditing = useDesignStore.getState().editMode;
    if (!next && wasEditing) {
      await useCommandStore.getState().flush({ interaction: 'edit-mode-exit' });
      useCommandStore.getState().clearStacks();
    }
    setEditMode(next);
  };

  // Extra A: keep MANUAL design nodes visible during calc pick / when leaving edit mode
  useDesignModeMarkers({
    mapRef,
    editMode,
    forceShowMarkers: !editMode && Object.keys(designNodes).length > 0,
  });
  useDesignModeSync({ mapRef, editMode });
  useSketchMode(mapRef.current);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editMode) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useCommandStore.getState().undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        useCommandStore.getState().redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode]);

  if (typeof window !== 'undefined') (window as typeof window & { __commandSoakTest__?: () => unknown }).__commandSoakTest__ = runCommandSoakTest;
  if (typeof window !== 'undefined') (window as typeof window & { __commandStoreCheck__?: () => Promise<unknown> }).__commandStoreCheck__ = runCommandStoreCheck;

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
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* GIS Issue 1: panduan onboarding untuk user baru */}
      <MapTourOverlay />

      <MapOverlays
        topologyRendered={topologyRendered}
        calcResult={calcResult}
        loading={loading}
        calcMode={calcMode}
        editMode={editMode}
        setEditMode={handleSetEditMode}
        setActivePanel={setActivePanel}
      />

      <SearchBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchLoading={searchLoading}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
        showSearchDrop={showSearchDrop}
        setShowSearchDrop={setShowSearchDrop}
        handleSearchInput={handleSearchInput}
        handleSearchSelect={handleSearchSelect}
      />

      <LeftSidebar
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        mapType={mapType}
        switchMapType={switchMapType}
        TILE_LAYERS={TILE_LAYERS}
        panels={{
          legend: {
            clusters,
            layers,
            topologyRendered,
            topoExportData,
            categoryConfig: CATEGORY_CONFIG,
            clearTopology,
            mapRef,
          },
          layers: {
            layers,
            setLayers,
            uploadingKmz,
            handleKmzUpload,
            handleDeleteLayer,
            handleColorChange,
            mapRef,
          },
          calc: {
            mapRef,
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
            odpPortCapacity,
            setOdpPortCapacity,
            poleSpacing,
            setPoleSpacing,
            nearestBackbone,
            setNearestBackbone,
            calculating,
            runCalculation,
            calcResult,
            setCalcResult,
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
            clearCalcGraphics,
            exporting,
            setExporting,
            topologyRendered,
            renderingTopology,
            topoExportData,
            clearTopology,
            renderTopology,
            handleStartCalc,
            abortCalculation,
            remapBackbone,
            remapTarget,
            setActivePanel,
          },
          design: {
            saveDesignAsDraft,
            listDesigns,
            loadDesign,
            loadedDesignId,
            designsList,
            listLoading,
            listError,
            detailLoading,
            detailError,
            saveLoading,
            saveError,
            calcResult,
            topologyRendered,
            lastRenderedGeometry,
            areaType,
            areaRadius,
            polygonAreaSqM,
            polygonCentroid,
            backbonePoint,
            targetPoint,
          },
        }}
      />
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <GisMapPage />
    </Suspense>
  );
}
