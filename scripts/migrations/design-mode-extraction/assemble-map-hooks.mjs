import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sd = path.join(__dirname, '_slices');
const read = (f) => fs.readFileSync(path.join(sd, f), 'utf8');
const tileLines = read('tile-category-phase.txt').split(/\n/);
const TILE_ONLY = tileLines.slice(0, 52).join('\n');
const CATEGORY_BLOCK = tileLines.slice(53, 89).join('\n');
const geoFirst = read('helpers-pre-export.txt').split(/\n/).slice(0, 25).join('\n');

const initMap = read('initMap.txt').replaceAll('mapContainer.current', 'mapContainerRef.current');

const useClusters = `import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { apiGet } from '../../../lib/api';
import type { ClusterPin, GisLayer } from './types';

${CATEGORY_BLOCK}

/** styleEpoch lifted to page level so clusters can rerun marker paint when basemap/style reloads */
export function useClusters(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  styleEpoch: number,
) {
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [clusters, setClusters] = useState<ClusterPin[]>([]);
  const [layers, setLayers] = useState<GisLayer[]>([]);
  const [loading, setLoading] = useState(true);

${read('loadData.txt')}

${read('clusterMarkersEffect.txt')}

  return {
    clusters,
    layers,
    setLayers,
    loading,
    loadData,
    markersRef,
    getPhaseColor,
    CATEGORY_CONFIG,
  };
}
`;

const useMapInstance = `import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

import type { NominatimResult } from './types';

${TILE_ONLY}

export function useMapInstance(params: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  loadData: (mapInstance?: maplibregl.Map | null) => Promise<void>;
  /** Style bump counter after raster basemap reload — lifts cluster marker repaint */
  styleEpoch: number;
  setStyleEpoch: Dispatch<SetStateAction<number>>;
}) {
  const { mapRef, loadData, styleEpoch, setStyleEpoch } = params;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const clusterReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mapType, setMapType] = useState<'osm' | 'satellite'>('osm');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchDrop, setShowSearchDrop] = useState(false);

${initMap}

${read('searchHandlers.txt')}

${read('switchMapType.txt')}

  return {
    mapContainerRef,
    mapType,
    switchMapType,
    TILE_LAYERS,
    clusterReloadTimerRef,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searchLoading,
    showSearchDrop,
    setShowSearchDrop,
    handleSearchInput,
    handleSearchSelect,
  };
}
`;

const useKmzLayers = `import type { MutableRefObject } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { FeatureCollection, Geometry } from 'geojson'; // FIX
import JSZip from 'jszip'; // FIX
import toGeoJSON from 'togeojson'; // FIX
import maplibregl from 'maplibre-gl'; // FIX
import { toast } from 'sonner'; // FIX
import { apiPost, apiPatch, apiDelete } from '../../../lib/api'; // FIX
import type { GisLayer } from './types'; // FIX

${geoFirst}

export function useKmzLayers(params: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  layers: GisLayer[];
  setLayers: Dispatch<SetStateAction<GisLayer[]>>;
  styleEpoch: number;
}) {
  const { mapRef, layers, setLayers, styleEpoch } = params;
  const [uploadingKmz, setUploadingKmz] = useState(false); // FIX

${read('layerMutationHandlers.txt')}

${read('kmzEffect.txt')}

${read('kmzUpload.txt')}
  return {
    uploadingKmz,
    handleColorChange,
    handleDeleteLayer,
    handleKmzUpload,
  };
}
`;

fs.writeFileSync(path.join(__dirname, 'useClusters.ts'), useClusters, 'utf8');
fs.writeFileSync(path.join(__dirname, 'useMapInstance.ts'), useMapInstance, 'utf8');
fs.writeFileSync(path.join(__dirname, 'useKmzLayers.ts'), useKmzLayers, 'utf8');

console.log('assembled map hooks');
