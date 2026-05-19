'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
import { SearchBar } from './components/SearchBar';
import { useCommandStore } from '../../store/useCommandStore';
import { useDesignStore } from '../../store/useDesignStore';

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
    useTopologyRender({ mapRef, inputMode, polygonPoints });

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
    calcResult,
    setCalcResult,
    calculating,
    nearestBackbone,
    setNearestBackbone,
    runCalculation,
    handleStartCalc,
    clearCalcGraphics,
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

  useDesignModeMarkers({ mapRef, editMode });
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
