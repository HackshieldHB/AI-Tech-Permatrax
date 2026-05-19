import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, 'page.tsx');

const HEAD = `'use client';

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

`;

const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/);
const RENDER_LINE = lines.findIndex((l) => l.includes('// ── RENDER ──'));
if (RENDER_LINE < 0) throw new Error('RENDER marker not found');
let tail = lines.slice(RENDER_LINE).join('\n');
tail = tail.replace(/ref=\{mapContainer\}/g, 'ref={mapContainerRef}');

const backupPath = path.join(__dirname, 'page.pre-refactor.tsx');
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(pagePath, backupPath);
}

fs.writeFileSync(pagePath, HEAD + tail + '\n', 'utf8');
console.log('page.tsx spliced; backup', backupPath);
