import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

import type { NominatimResult } from './types';

// ── TILE LAYERS ─────────────────────────────────────────
const TILE_LAYERS = {
  osm: {
    label: 'OpenStreetMap', // FIX
    icon: '🗺️', // FIX
    style: {
      version: 8 as const, // FIX
      sources: {
        osm: {
          type: 'raster' as const, // FIX
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], // FIX
          tileSize: 256, // FIX
          attribution: '© OpenStreetMap contributors', // FIX
          maxzoom: 19, // FIX
        },
      },
      layers: [
        {
          id: 'osm', // FIX
          type: 'raster' as const, // FIX
          source: 'osm', // FIX
        },
      ],
    },
  },
  satellite: {
    label: 'Satelit', // FIX
    icon: '🛰️', // FIX
    style: {
      version: 8 as const, // FIX
      sources: {
        satellite: {
          type: 'raster' as const, // FIX
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ], // FIX
          tileSize: 256, // FIX
          attribution: '© Esri World Imagery', // FIX
          maxzoom: 18, // FIX
        },
      },
      layers: [
        {
          id: 'satellite', // FIX
          type: 'raster' as const, // FIX
          source: 'satellite', // FIX
        },
      ],
    },
  },
};

export type MapTileLayerBundle = typeof TILE_LAYERS;

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

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return; // FIX

    const map = new maplibregl.Map({
      container: mapContainerRef.current, // FIX
      style: TILE_LAYERS.osm.style, // FIX
      center: [106.8456, -6.2088], // FIX: Jakarta default
      zoom: 11, // FIX
      maxZoom: 19, // FIX
      preserveDrawingBuffer: true, // FIX: required for canvas.toDataURL() to work
    }); // FIX

    map.addControl(new maplibregl.NavigationControl(), 'top-right'); // FIX
    // FIX: remove ScaleControl — causes white bar at bottom
    map.addControl(
      new maplibregl.GeolocateControl({ trackUserLocation: true }), // FIX
      'top-right',
    ); // FIX

    mapRef.current = map; // FIX

    const onMoveEnd = () => {
      if (clusterReloadTimerRef.current) clearTimeout(clusterReloadTimerRef.current);
      clusterReloadTimerRef.current = setTimeout(() => {
        clusterReloadTimerRef.current = null;
        void loadData(map);
      }, 300);
    };

    map.on('load', () => {
      void loadData(map);
    });
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('moveend', onMoveEnd);
      if (clusterReloadTimerRef.current) clearTimeout(clusterReloadTimerRef.current);
      map.remove(); // FIX
      mapRef.current = null; // FIX
    };
  }, [loadData]);

  const handleSearchInput = useCallback((val: string) => {
    setSearchQuery(val); // FIX
    setShowSearchDrop(true); // FIX
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); // FIX
    if (!val.trim() || val.length < 2) {
      setSearchResults([]); // FIX
      return; // FIX
    }
    searchTimeoutRef.current = setTimeout(() => {
      void (async () => {
        setSearchLoading(true); // FIX
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=6&addressdetails=1`,
            {
              headers: {
                'Accept-Language': 'id,en', // FIX
                'User-Agent': 'PermaTrax-GIS/1.0 (internal; contact: support@permatrax.local)', // FIX: Nominatim policy
              },
            },
          ); // FIX
          const data = (await res.json()) as NominatimResult[]; // FIX
          setSearchResults(Array.isArray(data) ? data : []); // FIX
        } catch {
          setSearchResults([]); // FIX
        } finally {
          setSearchLoading(false); // FIX
        }
      })();
    }, 500); // FIX: 500ms debounce
  }, []);

  // FIX: fly to selected Nominatim result
  const handleSearchSelect = useCallback((result: NominatimResult) => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    const lat = parseFloat(result.lat); // FIX
    const lon = parseFloat(result.lon); // FIX
    map.flyTo({
      center: [lon, lat], // FIX
      zoom: 15, // FIX
      duration: 1200, // FIX
      essential: true, // FIX
    }); // FIX
    setSearchQuery(result.display_name.split(',').slice(0, 2).join(',')); // FIX
    setShowSearchDrop(false); // FIX
    setSearchResults([]); // FIX
  }, []);

  // ── Switch map type ─────────────────────────────────────
  const switchMapType = useCallback((type: 'osm' | 'satellite') => {
    const map = mapRef.current; // FIX
    if (!map) return; // FIX
    setMapType(type); // FIX
    map.setStyle(TILE_LAYERS[type].style); // FIX
    map.once('style.load', () => {
      // FIX: bump styleEpoch to trigger ALL layer useEffects
      setStyleEpoch((prev) => prev + 1); // FIX
      // FIX: small delay to ensure style fully loaded
      setTimeout(() => {
        setStyleEpoch((prev) => prev + 1); // FIX
      }, 200); // FIX
    }); // FIX
  }, []);

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
