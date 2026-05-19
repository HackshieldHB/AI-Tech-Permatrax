/**
 * Restores apps/web/src/app/map/page.tsx after accidental overwrite, using
 * persisted slice fragments under this folder (_generated_map_page_fragments/).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

const FRAG = path.join(__dirname, '_generated_map_page_fragments');
const PAGE = path.join(ROOT, 'apps/web/src/app/map/page.tsx');

const read = (f) => fs.readFileSync(path.join(FRAG, f), 'utf8');

const FLY_HEADER = fs.readFileSync(
  path.join(__dirname, '_extract_fragments_map/fragment_panelFlyoutShellHeader.txt'),
  'utf8',
);

const out = `'use client';

import { useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { apiPatch } from '../../lib/api';
import {
  exportKmz,
  exportMapImage,
  exportPdf,
  useExports,
} from './hooks/useExports';
import { useClusters } from './hooks/useClusters';
import { clearPolygonFromMap, useCalculation } from './hooks/useCalculation';
import { useKmzLayers } from './hooks/useKmzLayers';
import { useMapInstance } from './hooks/useMapInstance';
import { useTopologyRender } from './hooks/useTopologyRender';
import { toast } from 'sonner'; // FIX: user feedback (panel actions)

export default function GisMapPage() {
  const mapRef = useRef<maplibregl.Map | null>(null);

  /** Shared explicitly with useTopologyRender (no implicit cross-hook refs). */
  const [inputMode, setInputMode] = useState<'radius' | 'polygon'>('radius');
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  const [polygonAreaSqM, setPolygonAreaSqM] = useState<number | null>(null);
  const [polygonCentroid, setPolygonCentroid] = useState<[number, number] | null>(null);

  const [activePanel, setActivePanel] = useState<'layers' | 'calc' | 'legend' | null>('legend');

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

  const { renderingTopology, topologyRendered, topoExportData, clearTopology, renderTopology } =
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

  // ── RENDER ─────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 60px)',
      }}
    >
STYLE_PLACEHOLDER
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

${read('_generated_equipmentHud.txt')}
${read('_generated_searchBar.txt')}
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
${read('_generated_basemapRow.txt')}
${read('_generated_panelButtons.txt')}
      </div>
${FLY_HEADER}
${read('_generated_flyoutScrollOpen.txt')}
          </div>
        </div>
      )}
${read('_generated_loadingOverlay.txt')}
${read('_generated_calcGhostBar.txt')}
    </div>
  );
}
`;

fs.writeFileSync(PAGE, out.replace('STYLE_PLACEHOLDER', read('_generated_mapStylesInner.txt')));
console.log('Restored', PAGE);
