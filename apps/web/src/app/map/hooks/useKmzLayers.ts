import type { MutableRefObject } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { FeatureCollection, Geometry } from 'geojson'; // FIX
import JSZip from 'jszip'; // FIX
import toGeoJSON from 'togeojson'; // FIX
import maplibregl from 'maplibre-gl'; // FIX
import { toast } from 'sonner'; // FIX
import { apiPost, apiPatch, apiDelete } from '../../../lib/api'; // FIX
import type { GisLayer } from './types'; // FIX

// FIX: extract every [lng, lat] from any GeoJSON geometry (module scope — not inside component)
function getAllCoordinates(geometry: Geometry | null | undefined): [number, number][] {
  if (!geometry) return []; // FIX
  const coords: [number, number][] = []; // FIX
  const extract = (c: unknown): void => {
    if (c == null) return; // FIX
    if (
      Array.isArray(c) &&
      c.length >= 2 &&
      typeof c[0] === 'number' &&
      typeof c[1] === 'number'
    ) {
      coords.push([c[0], c[1]]); // FIX: coordinate pair
      return; // FIX
    }
    if (Array.isArray(c)) {
      c.forEach((x) => extract(x)); // FIX: recurse nested rings / lines
    }
  }; // FIX
  if ('coordinates' in geometry && geometry.coordinates !== undefined) {
    extract(geometry.coordinates); // FIX
  }
  return coords; // FIX
}


export function useKmzLayers(params: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  layers: GisLayer[];
  setLayers: Dispatch<SetStateAction<GisLayer[]>>;
  styleEpoch: number;
}) {
  const { mapRef, layers, setLayers, styleEpoch } = params;
  const [uploadingKmz, setUploadingKmz] = useState(false); // FIX

  // FIX: update layer color (API may reject extra fields — then update locally only)
  const handleColorChange = useCallback(async (layerId: string, newColor: string, isVisible: boolean) => {
    try {
      await apiPatch(`/map/layers/${layerId}/visibility`, {
        isVisible, // FIX
        color: newColor, // FIX: backend may ignore — ValidationPipe may error
      }); // FIX
    } catch {
      // FIX: expected if backend only allows isVisible
    }
    setLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, color: newColor } : l))); // FIX: always refresh map paint
  }, []);

  // FIX: delete KMZ layer via API + remove map layers/sources
  const handleDeleteLayer = useCallback(async (layerId: string, layerName: string) => {
    if (!confirm(`Hapus layer "${layerName}"?`)) return; // FIX
    try {
      await apiDelete(`/map/layers/${layerId}`); // FIX
      const map = mapRef.current; // FIX
      if (map) {
        const ids = [
          `kmz-line-${layerId}`, // FIX
          `kmz-fill-${layerId}`, // FIX
          `kmz-fill-${layerId}-outline`, // FIX
          `kmz-circle-${layerId}`, // FIX
          `kmz-symbol-${layerId}`, // FIX
        ]; // FIX
        ids.forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id); // FIX
        }); // FIX
        const src = `kmz-${layerId}`; // FIX
        if (map.getSource(src)) map.removeSource(src); // FIX
      }
      setLayers((prev) => prev.filter((l) => l.id !== layerId)); // FIX
      toast.success(`Layer "${layerName}" dihapus`); // FIX
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error'; // FIX
      toast.error(`Gagal hapus: ${msg}`); // FIX
    }
  }, []);

  // ── Render KMZ layers (line + fill + outline + circle + symbol) ──
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map || !map.isStyleLoaded()) return; // FIX

    const pointFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['Point', 'MultiPoint'],
      true,
      false,
    ]; // FIX

    const lineFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['LineString', 'MultiLineString'],
      true,
      false,
    ]; // FIX

    const polyFilter: maplibregl.ExpressionSpecification = [
      'match',
      ['geometry-type'],
      ['Polygon', 'MultiPolygon'],
      true,
      false,
    ]; // FIX

    type KmzHandlers = {
      circleId: string; // FIX
      onClick: (e: maplibregl.MapLayerMouseEvent) => void; // FIX
      onEnter: () => void; // FIX
      onLeave: () => void; // FIX
    }; // FIX
    const kmzHandlers: KmzHandlers[] = []; // FIX

    layers.forEach((layer) => {
      const sourceId = `kmz-${layer.id}`; // FIX
      const lineId = `kmz-line-${layer.id}`; // FIX
      const fillId = `kmz-fill-${layer.id}`; // FIX
      const fillOutlineId = `${fillId}-outline`; // FIX
      const circleId = `kmz-circle-${layer.id}`; // FIX
      const symbolId = `kmz-symbol-${layer.id}`; // FIX

      ;[lineId, fillId, fillOutlineId, circleId, symbolId].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id); // FIX
      }); // FIX
      if (map.getSource(sourceId)) map.removeSource(sourceId); // FIX

      if (!layer.isVisible || !layer.geoJson) return; // FIX

      map.addSource(sourceId, {
        type: 'geojson', // FIX
        data: layer.geoJson as FeatureCollection, // FIX
      }); // FIX

      const features = layer.geoJson.features || []; // FIX
      const hasPoint = features.some(
        (f) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint',
      ); // FIX
      const hasLine = features.some(
        (f) =>
          f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
      ); // FIX
      const hasPolygon = features.some(
        (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
      ); // FIX

      if (hasPoint) {
        map.addLayer({
          id: circleId, // FIX
          type: 'circle', // FIX
          source: sourceId, // FIX
          filter: pointFilter, // FIX
          paint: {
            'circle-radius': 7, // FIX
            'circle-color': layer.color, // FIX
            'circle-stroke-color': 'white', // FIX
            'circle-stroke-width': 2, // FIX
            'circle-opacity': 0.9, // FIX
          },
        }); // FIX

        map.addLayer({
          id: symbolId, // FIX
          type: 'symbol', // FIX
          source: sourceId, // FIX
          filter: pointFilter, // FIX
          layout: {
            'text-field': [
              'coalesce',
              ['get', 'name'],
              ['get', 'Name'],
              ['get', 'description'],
              '',
            ] as maplibregl.ExpressionSpecification, // FIX: KML props
            'text-size': 11, // FIX
            'text-offset': [0, 1.5], // FIX
            'text-anchor': 'top', // FIX
            'text-optional': true, // FIX
          },
          paint: {
            'text-color': '#111', // FIX
            'text-halo-color': 'white', // FIX
            'text-halo-width': 1.5, // FIX
          },
        }); // FIX

        const onClick = (e: maplibregl.MapLayerMouseEvent) => {
          if (!e.features?.length) return; // FIX
          const props = (e.features[0].properties || {}) as Record<string, unknown>; // FIX
          const nameRaw = props.name ?? props.Name ?? props.description ?? 'KMZ Point'; // FIX
          const name = String(nameRaw); // FIX
          const descRaw = props.description; // FIX
          const desc = descRaw != null ? String(descRaw) : ''; // FIX
          new maplibregl.Popup() // FIX
            .setLngLat(e.lngLat) // FIX
            .setHTML(`
          <div style="font-family:sans-serif;padding:4px">
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:4px">
              ${name}
            </div>
            ${
              desc && desc !== name
                ? `<div style="font-size:11px;color:#6B7280">${desc}</div>`
                : ''
            }
            <div style="font-size:10px;color:#9CA3AF;margin-top:4px">
              Layer: ${layer.name}
            </div>
          </div>
        `) // FIX
            .addTo(map); // FIX
        }; // FIX
        const onEnter = () => {
          map.getCanvas().style.cursor = 'pointer'; // FIX
        }; // FIX
        const onLeave = () => {
          map.getCanvas().style.cursor = ''; // FIX
        }; // FIX
        map.on('click', circleId, onClick); // FIX
        map.on('mouseenter', circleId, onEnter); // FIX
        map.on('mouseleave', circleId, onLeave); // FIX
        kmzHandlers.push({ circleId, onClick, onEnter, onLeave }); // FIX
      }

      if (hasLine) {
        map.addLayer({
          id: lineId, // FIX
          type: 'line', // FIX
          source: sourceId, // FIX
          filter: lineFilter, // FIX
          paint: {
            'line-color': layer.color, // FIX
            'line-width': 2.5, // FIX
            'line-opacity': 0.85, // FIX
          },
        }); // FIX
      }

      if (hasPolygon) {
        map.addLayer({
          id: fillId, // FIX
          type: 'fill', // FIX
          source: sourceId, // FIX
          filter: polyFilter, // FIX
          paint: {
            'fill-color': layer.color, // FIX
            'fill-opacity': 0.18, // FIX
          },
        }); // FIX

        map.addLayer({
          id: fillOutlineId, // FIX
          type: 'line', // FIX
          source: sourceId, // FIX
          filter: polyFilter, // FIX
          paint: {
            'line-color': layer.color, // FIX
            'line-width': 1.5, // FIX
            'line-opacity': 0.7, // FIX
          },
        }); // FIX
      }
    });

    return () => {
      kmzHandlers.forEach(({ circleId, onClick, onEnter, onLeave }) => {
        map.off('click', circleId, onClick); // FIX
        map.off('mouseenter', circleId, onEnter); // FIX
        map.off('mouseleave', circleId, onLeave); // FIX
      }); // FIX
    }; // FIX
  }, [layers, styleEpoch]); // FIX: re-render when style changes

  // ── KMZ Upload handler ─────────────────────────────────
  const handleKmzUpload = useCallback(async (file: File) => {
    if (!file.name.match(/\.(kmz|kml)$/i)) {
      toast.error('Hanya file .kmz atau .kml yang didukung'); // FIX
      return; // FIX
    }
    setUploadingKmz(true); // FIX
    try {
      let kmlText: string; // FIX

      if (file.name.toLowerCase().endsWith('.kmz')) {
        const zip = await JSZip.loadAsync(file); // FIX
        const kmlFile = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.kml')); // FIX
        if (!kmlFile) throw new Error('KMZ tidak mengandung file KML'); // FIX
        kmlText = await kmlFile.async('text'); // FIX
      } else {
        kmlText = await file.text(); // FIX
      }

      const parser = new DOMParser(); // FIX
      const kmlDom = parser.parseFromString(kmlText, 'text/xml'); // FIX
      const geoJson = toGeoJSON.kml(kmlDom) as FeatureCollection; // FIX

      if (!geoJson.features?.length) {
        throw new Error('KMZ tidak mengandung data yang dapat ditampilkan'); // FIX
      }

      const colors = ['#FF6B00', '#9B59B6', '#2980B9', '#27AE60', '#E74C3C']; // FIX
      const color = colors[Math.floor(Math.random() * colors.length)]; // FIX

      const saved = await apiPost<GisLayer>('/map/layers', {
        name: file.name.replace(/\.(kmz|kml)$/i, ''), // FIX
        fileUrl: '', // FIX: optional file storage later
        geoJson, // FIX
        color, // FIX
      }); // FIX

      setLayers((prev) => [...prev, { ...saved, isVisible: saved.isVisible !== false }]); // FIX
      toast.success(`✅ ${file.name} berhasil diupload (${geoJson.features.length} fitur)`); // FIX

      if (geoJson.features?.length > 0) {
        try {
          let minLng = 180; // FIX
          let maxLng = -180; // FIX
          let minLat = 90; // FIX
          let maxLat = -90; // FIX
          geoJson.features.forEach((feature) => {
            const coords = getAllCoordinates(feature.geometry as Geometry | null | undefined); // FIX
            coords.forEach(([lng, lat]) => {
              minLng = Math.min(minLng, lng); // FIX
              maxLng = Math.max(maxLng, lng); // FIX
              minLat = Math.min(minLat, lat); // FIX
              maxLat = Math.max(maxLat, lat); // FIX
            }); // FIX
          }); // FIX
          if (minLng < 180 && mapRef.current) {
            mapRef.current.fitBounds(
              [
                [minLng, minLat],
                [maxLng, maxLat],
              ], // FIX
              { padding: 60, duration: 1000, maxZoom: 16 }, // FIX
            ); // FIX
          }
        } catch {
          // FIX: silently fail if bounds calc fails
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'; // FIX
      toast.error(`Upload gagal: ${msg}`); // FIX
    } finally {
      setUploadingKmz(false); // FIX
    }
  }, []);
  return {
    uploadingKmz,
    handleColorChange,
    handleDeleteLayer,
    handleKmzUpload,
  };
}
