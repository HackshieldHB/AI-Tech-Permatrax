/**
 * Phase A — extract map page JSX into apps/web/src/app/map/components/
 * Rewrites apps/web/src/app/map/page.tsx to a thin hook + composition wrapper.
 *
 * Prerequisite: `page.tsx` must be the **monolithic** GIS page (line numbers in this script match that file).
 * If you only have the thin page, run `restore-map-page-from-fragments.mjs` first.
 *
 * Run: node scripts/migrations/design-mode-extraction/compose-map-view-phase-a.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MAP_DIR = path.join(ROOT, 'apps/web/src/app/map');
const PAGE_SRC = path.join(MAP_DIR, 'page.tsx');
const COMP_DIR = path.join(MAP_DIR, 'components');

const SRC = fs.readFileSync(PAGE_SRC, 'utf8').split(/\r?\n/);
const SL = (a, b) => SRC.slice(a - 1, b).join('\n');

const EXPORT_FIX_COMMENT = SL(1385, 1385);
const exportInnerMarkup = SL(1387, 1486);

const legendInner = SL(548, 785).replace(/\bCATEGORY_CONFIG\b/g, 'categoryConfig');
const layerInner = SL(789, 985);
const calcBeforeExport = SL(990, 1384);
const calcAfterExport = SL(1489, 2878);

const mapStyleCss = SL(113, 150);

const styleBlockTsx = `      <style>{\`\n${mapStyleCss}\n      \`}</style>`;

const leftColOpen = SL(411, 421);
const basemapMarkup = SL(422, 452);
const panelButtonsMarkup = SL(453, 495);
const leftColClose = SL(496, 496);

const flyHead = SL(497, 546);
const flyClosing = SL(2881, 2883);

const equipmentHud = SL(154, 245);
const searchMarkup = SL(246, 410);
const loadingMarkup = SL(2884, 2904);
const calcGhostMarkup = SL(2905, 2926);

const WRITE = (name, content) =>
  fs.writeFileSync(path.join(COMP_DIR, name), `${content.replace(/\r\n/g, '\n').trimEnd()}\n`, 'utf8');

WRITE(
  'LegendPanel.tsx',
  `'use client';

import type { MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';

import type { ClusterPin, GisLayer } from '../hooks/types';

export type LegendCategoryConfig = Record<
  string,
  { label: string; color: string; bg: string; desc: string }
>;

export type LegendPanelProps = {
  clusters: ClusterPin[];
  layers: GisLayer[];
  topologyRendered: boolean;
  categoryConfig: LegendCategoryConfig;
  clearTopology: () => void;
  mapRef: MutableRefObject<maplibregl.Map | null>;
};

export function LegendPanel(props: LegendPanelProps) {
  const {
    clusters,
    layers,
    topologyRendered,
    categoryConfig,
    clearTopology,
    mapRef,
  } = props;
  void mapRef;

  return (
${legendInner}
  );
}
`,
);

WRITE(
  'LayerPanel.tsx',
  `'use client';

import type { Dispatch, SetStateAction } from 'react';

import { apiPatch } from '../../../lib/api';
import { toast } from 'sonner';
import type { GisLayer } from '../hooks/types';

export type LayerPanelProps = {
  layers: GisLayer[];
  setLayers: Dispatch<SetStateAction<GisLayer[]>>;
  uploadingKmz: boolean;
  handleKmzUpload: (file: File) => Promise<void>;
  handleDeleteLayer: (layerId: string, layerName: string) => Promise<void>;
  handleColorChange: (
    layerId: string,
    hex: string,
    isVisible: boolean,
  ) => Promise<void>;
};

export function LayerPanel(props: LayerPanelProps) {
  const {
    layers,
    setLayers,
    uploadingKmz,
    handleKmzUpload,
    handleDeleteLayer,
    handleColorChange,
  } = props;

  return (
${layerInner}
  );
}
`,
);

WRITE(
  'ExportMenu.tsx',
  `'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';
import { toast } from 'sonner'; // FIX: user feedback (panel actions)

import type { FtthCalcApiResponse, TopoExportData } from '../hooks/types';
import { exportKmz, exportMapImage, exportPdf } from '../hooks/useExports';

export type ExportMenuProps = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  calcResult: FtthCalcApiResponse | null;
  topologyRendered: boolean;
  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  backbonePoint: [number, number] | null;
  targetPoint: [number, number] | null;
  topoExportData: TopoExportData | null;
};

export function ExportMenu({
  mapRef,
  calcResult,
  topologyRendered,
  exporting,
  setExporting,
  backbonePoint,
  targetPoint,
  topoExportData,
}: ExportMenuProps) {
  if (!calcResult || !topologyRendered) return null;
  return (
    <>
${EXPORT_FIX_COMMENT}
${exportInnerMarkup}
    </>
  );
}
`,
);

WRITE(
  'CalcPanel.tsx',
  `'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';

import { clearPolygonFromMap } from '../hooks/useCalculation';
import type { FtthCalcApiResponse, OsmElement, TopoExportData } from '../hooks/types';

import { ExportMenu } from './ExportMenu';

export type CalcPanelProps = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  polygonMarkersRef: MutableRefObject<maplibregl.Marker[]>;

  calcMode: 'idle' | 'backbone' | 'target' | 'result';
  setCalcMode: Dispatch<SetStateAction<'idle' | 'backbone' | 'target' | 'result'>>;

  backbonePoint: [number, number] | null;
  setBackbonePoint: Dispatch<SetStateAction<[number, number] | null>>;
  targetPoint: [number, number] | null;
  setTargetPoint: Dispatch<SetStateAction<[number, number] | null>>;

  areaType: string;
  setAreaType: Dispatch<SetStateAction<string>>;
  areaRadius: number;
  setAreaRadius: Dispatch<SetStateAction<number>>;

  nearestBackbone: OsmElement | null;
  setNearestBackbone: Dispatch<SetStateAction<OsmElement | null>>;

  calculating: boolean;
  runCalculation: () => Promise<void>;
  calcResult: FtthCalcApiResponse | null;
  setCalcResult: Dispatch<SetStateAction<FtthCalcApiResponse | null>>;

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

  clearCalcGraphics: () => void;

  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  topologyRendered: boolean;
  renderingTopology: boolean;
  topoExportData: TopoExportData | null;

  clearTopology: () => void;
  renderTopology: (
    result: FtthCalcApiResponse,
    backbone: [number, number],
    target: [number, number],
    drawnPolygon?: [number, number][] | null,
  ) => Promise<void>;
  handleStartCalc: () => void;
};

export function CalcPanel(props: CalcPanelProps) {
  const {
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
  } = props;

  return (
              <div style={{ padding: 16 }}>
${calcBeforeExport}

                <ExportMenu
                  mapRef={mapRef}
                  calcResult={calcResult}
                  topologyRendered={topologyRendered}
                  exporting={exporting}
                  setExporting={setExporting}
                  backbonePoint={backbonePoint}
                  targetPoint={targetPoint}
                  topoExportData={topoExportData}
                />

${calcAfterExport}
              </div>
            );
}
`,
);

WRITE(
  'SearchBar.tsx',
  `'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { NominatimResult } from '../hooks/types';

export type SearchBarProps = {
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchLoading: boolean;
  searchResults: NominatimResult[];
  setSearchResults: Dispatch<SetStateAction<NominatimResult[]>>;
  showSearchDrop: boolean;
  setShowSearchDrop: Dispatch<SetStateAction<boolean>>;
  handleSearchInput: (q: string) => void;
  handleSearchSelect: (result: NominatimResult) => void;
};

export function SearchBar(props: SearchBarProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchLoading,
    searchResults,
    setSearchResults,
    showSearchDrop,
    setShowSearchDrop,
    handleSearchInput,
    handleSearchSelect,
  } = props;

  return (
${searchMarkup}
  );
}
`,
);

WRITE(
  'MapOverlays.tsx',
  `'use client';

import type { Dispatch, SetStateAction } from 'react';

import type { MapTileLayerBundle } from '../hooks/useMapInstance';
import type { FtthCalcApiResponse } from '../hooks/types';

export type BasemapToggleProps = {
  mapType: 'osm' | 'satellite';
  switchMapType: (t: 'osm' | 'satellite') => void;
  TILE_LAYERS: MapTileLayerBundle;
};

export function BasemapToggle({
  mapType,
  switchMapType,
  TILE_LAYERS,
}: BasemapToggleProps) {
  return (
${basemapMarkup}
  );
}

export type MapOverlaysProps = {
  topologyRendered: boolean;
  calcResult: FtthCalcApiResponse | null;
  loading: boolean;
  calcMode: 'idle' | 'backbone' | 'target' | 'result';
  setActivePanel: Dispatch<
    SetStateAction<'layers' | 'calc' | 'legend' | null>
  >;
};

export function MapOverlays({
  topologyRendered,
  calcResult,
  loading,
  calcMode,
  setActivePanel,
}: MapOverlaysProps) {
  return (
    <>
${equipmentHud}
${loadingMarkup}
${calcGhostMarkup}
    </>
  );
}
`,
);

WRITE(
  'LeftSidebar.tsx',
  `'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';

import { BasemapToggle } from './MapOverlays';
import type { MapTileLayerBundle } from '../hooks/useMapInstance';
import { CalcPanel, type CalcPanelProps } from './CalcPanel';
import { LayerPanel, type LayerPanelProps } from './LayerPanel';
import { LegendPanel, type LegendCategoryConfig } from './LegendPanel';

export type LeftSidebarPanels = {
  legend: {
    clusters: import('../hooks/types').ClusterPin[];
    layers: import('../hooks/types').GisLayer[];
    topologyRendered: boolean;
    categoryConfig: LegendCategoryConfig;
    clearTopology: () => void;
    mapRef: MutableRefObject<maplibregl.Map | null>;
  };
  layers: LayerPanelProps;
  calc: CalcPanelProps;
};

export type LeftSidebarProps = {
  activePanel: 'layers' | 'calc' | 'legend' | null;
  setActivePanel: Dispatch<SetStateAction<'layers' | 'calc' | 'legend' | null>>;
  mapType: 'osm' | 'satellite';
  switchMapType: (t: 'osm' | 'satellite') => void;
  TILE_LAYERS: MapTileLayerBundle;
  panels: LeftSidebarPanels;
};

export function LeftSidebar({
  activePanel,
  setActivePanel,
  mapType,
  switchMapType,
  TILE_LAYERS,
  panels,
}: LeftSidebarProps) {
  const { legend: legendProps, layers: layerProps, calc: calcProps } = panels;

  return (
    <>
${leftColOpen}
        <BasemapToggle
          mapType={mapType}
          switchMapType={switchMapType}
          TILE_LAYERS={TILE_LAYERS}
        />
${panelButtonsMarkup}
${leftColClose}
${flyHead}
            {activePanel === 'legend' && (
              <LegendPanel
                clusters={legendProps.clusters}
                layers={legendProps.layers}
                topologyRendered={legendProps.topologyRendered}
                categoryConfig={legendProps.categoryConfig}
                clearTopology={legendProps.clearTopology}
                mapRef={legendProps.mapRef}
              />
            )}
            {activePanel === 'layers' && (
              <LayerPanel
                layers={layerProps.layers}
                setLayers={layerProps.setLayers}
                uploadingKmz={layerProps.uploadingKmz}
                handleKmzUpload={layerProps.handleKmzUpload}
                handleDeleteLayer={layerProps.handleDeleteLayer}
                handleColorChange={layerProps.handleColorChange}
              />
            )}
            {activePanel === 'calc' && <CalcPanel {...calcProps} />}
${flyClosing}
    </>
  );
}
`,
);

const NEW_PAGE = `'use client';

import { useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useExports } from './hooks/useExports';
import { useClusters } from './hooks/useClusters';
import { useCalculation } from './hooks/useCalculation';
import { useKmzLayers } from './hooks/useKmzLayers';
import { useMapInstance } from './hooks/useMapInstance';
import { useTopologyRender } from './hooks/useTopologyRender';

import { LeftSidebar } from './components/LeftSidebar';
import { MapOverlays } from './components/MapOverlays';
import { SearchBar } from './components/SearchBar';

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
${styleBlockTsx}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      <MapOverlays
        topologyRendered={topologyRendered}
        calcResult={calcResult}
        loading={loading}
        calcMode={calcMode}
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
          },
        }}
      />
    </div>
  );
}
`;

fs.writeFileSync(PAGE_SRC, `${NEW_PAGE.replace(/\r\n/g, '\n').trimEnd()}\n`, 'utf8');

console.log('Wrote components to', COMP_DIR);
console.log('Rewrote', PAGE_SRC);
