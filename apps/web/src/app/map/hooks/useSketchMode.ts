import maplibregl from 'maplibre-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useEffect, useRef } from 'react';
import { useDesignStore } from '../../../store/useDesignStore';
import * as turf from '@turf/turf';
import { toast } from 'sonner';

export function useSketchMode(map: maplibregl.Map | null) {
  const drawRef = useRef<MapboxDraw | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const { sketchMode, sketchTopology, setSketchTopology, sketchOpacity, nodes, sketchTrashTick } = useDesignStore();

  const updateMeasurements = (fc: any) => {
    if (!map || !fc.features.length) {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      return;
    }

    const lastFeature = fc.features[fc.features.length - 1];
    if (!lastFeature) return;

    let measurement = '';
    let coords: [number, number] | null = null;

    if (lastFeature.geometry.type === 'LineString') {
      const length = turf.length(lastFeature, { units: 'meters' });
      measurement = `Length: ${length.toFixed(2)} meters`;
      // Use midpoint
      const line = turf.lineString(lastFeature.geometry.coordinates);
      const midpoint = turf.along(line, length / 2, { units: 'meters' });
      coords = midpoint.geometry.coordinates as [number, number];
    } else if (lastFeature.geometry.type === 'Polygon') {
      const area = turf.area(lastFeature);
      measurement = `Area: ${area.toFixed(2)} sqm`;
      // Use centroid
      const centroid = turf.centroid(lastFeature);
      coords = centroid.geometry.coordinates as [number, number];
    }

    if (measurement && coords) {
      if (popupRef.current) {
        popupRef.current.remove();
      }
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
        .setLngLat(coords)
        .setHTML(`<div style="background: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">${measurement}</div>`)
        .addTo(map);
    }
  };

  useEffect(() => {
    if (!map) return;

    if (sketchMode) {
      if (!drawRef.current) {
        drawRef.current = new MapboxDraw({
          displayControlsDefault: false,
          controls: {
            polygon: true,
            line_string: true,
            point: true,
            trash: true
          },
          defaultMode: 'draw_line_string',
          styles: [
            // Line (Proposed Trenching): Solid Green
            {
              id: 'gl-draw-line',
              type: 'line',
              filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#10B981', 'line-width': 3, 'line-opacity': sketchOpacity }
            },
            // Polygon Fill (Coverage Area): Purple with 20% opacity
            {
              id: 'gl-draw-polygon-fill',
              type: 'fill',
              filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
              paint: { 'fill-color': '#8B5CF6', 'fill-opacity': 0.2 * sketchOpacity }
            },
            // Polygon Stroke
            {
              id: 'gl-draw-polygon-stroke',
              type: 'line',
              filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#8B5CF6', 'line-width': 2, 'line-opacity': sketchOpacity }
            },
            // Point (Mark/Note): Red Circle
            {
              id: 'gl-draw-point',
              type: 'circle',
              filter: ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
              paint: { 'circle-radius': 6, 'circle-color': '#EF4444', 'circle-opacity': sketchOpacity }
            },
            // Active/Selected state: Cyan dashed
            {
              id: 'gl-draw-line-active',
              type: 'line',
              filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
              layout: { 'line-cap': 'round', 'line-join': 'round', 'line-dasharray': [2, 2] },
              paint: { 'line-color': '#22D3EE', 'line-width': 3, 'line-opacity': sketchOpacity }
            },
            {
              id: 'gl-draw-polygon-fill-active',
              type: 'fill',
              filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
              paint: { 'fill-color': '#22D3EE', 'fill-opacity': 0.2 * sketchOpacity }
            },
            {
              id: 'gl-draw-polygon-stroke-active',
              type: 'line',
              filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
              layout: { 'line-cap': 'round', 'line-join': 'round', 'line-dasharray': [2, 2] },
              paint: { 'line-color': '#22D3EE', 'line-width': 2, 'line-opacity': sketchOpacity }
            },
            {
              id: 'gl-draw-point-active',
              type: 'circle',
              filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true']],
              paint: { 'circle-radius': 8, 'circle-color': '#22D3EE', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': sketchOpacity }
            }
          ]
        });
        // @ts-ignore - MapboxDraw types sometimes conflict with Maplibre, ignore it for now
        map.addControl(drawRef.current, 'top-right');
        
        // Load existing sketch data if any
        if (sketchTopology?.features?.length > 0) {
          drawRef.current.add(sketchTopology);
        }
      }

      // Event listeners to save data to Zustand
      const updateStore = () => {
        if (drawRef.current) {
          const fc = drawRef.current.getAll();
          // Snap points to nearby nodes
          fc.features.forEach((feature: any) => {
            if (feature.geometry.type === 'Point') {
              const point = turf.point(feature.geometry.coordinates);
              let closestNode: any = null;
              let minDist = 5; // meters
              Object.values(nodes).forEach((node: any) => {
                const nodePoint = turf.point([node.coordinates[0], node.coordinates[1]]);
                const dist = turf.distance(point, nodePoint, { units: 'meters' });
                if (dist < minDist) {
                  minDist = dist;
                  closestNode = node;
                }
              });
              if (closestNode) {
                feature.geometry.coordinates = [closestNode.coordinates[0], closestNode.coordinates[1]];
              }
            }
          });
          setSketchTopology(fc);
          updateMeasurements(fc);
        }
      };
      
      map.on('draw.create', updateStore);
      map.on('draw.delete', updateStore);
      map.on('draw.update', updateStore);

      // GIS Issue 1/8: cleanup with the SAME handler reference — the old code
      // called map.off with a fresh arrow fn (no-op), leaving stale listeners
      // whose closures re-added deleted features to the store.
      return () => {
        map.off('draw.create', updateStore);
        map.off('draw.delete', updateStore);
        map.off('draw.update', updateStore);
      };
    } else {
      // Teardown when exiting Sketch Mode
      if (drawRef.current) {
        // GIS Issue 1/8: persist the CURRENT draw state before removing the
        // control, so deletions done via trash are never resurrected when
        // sketch mode is re-entered.
        try {
          setSketchTopology(drawRef.current.getAll());
        } catch {
          /* control already detached */
        }
        // @ts-ignore
        map.removeControl(drawRef.current);
        drawRef.current = null;
      }
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    }

    return undefined;
  }, [sketchMode, map]);

  // JLM Issue 1/2: when sketch mode is off but topology exists, show a read-only
  // overlay so Gambar Manual remains visible/selectable during Backbone/Target pick.
  useEffect(() => {
    if (!map) return;
    const SRC = 'sketch-static';
    const LAYERS = ['sketch-static-fill', 'sketch-static-line', 'sketch-static-point'] as const;

    const removeStatic = () => {
      for (const id of LAYERS) {
        try {
          if (map.getLayer(id)) map.removeLayer(id);
        } catch {
          /* ignore */
        }
      }
      try {
        if (map.getSource(SRC)) map.removeSource(SRC);
      } catch {
        /* ignore */
      }
    };

    if (sketchMode) {
      removeStatic();
      return;
    }

    const fc = sketchTopology?.features?.length
      ? sketchTopology
      : { type: 'FeatureCollection', features: [] };
    if (!fc.features.length) {
      removeStatic();
      return;
    }

    const data = fc as GeoJSON.FeatureCollection;
    if (map.getSource(SRC)) {
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(data);
    } else {
      map.addSource(SRC, { type: 'geojson', data });
      map.addLayer({
        id: 'sketch-static-fill',
        type: 'fill',
        source: SRC,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#8B5CF6', 'fill-opacity': 0.15 * sketchOpacity },
      });
      map.addLayer({
        id: 'sketch-static-line',
        type: 'line',
        source: SRC,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']],
        paint: { 'line-color': '#10B981', 'line-width': 3, 'line-opacity': sketchOpacity },
      });
      map.addLayer({
        id: 'sketch-static-point',
        type: 'circle',
        source: SRC,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 7,
          'circle-color': '#EF4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': sketchOpacity,
        },
      });
    }

    return () => {
      // Keep overlay across re-renders; full cleanup when features empty / sketch on
    };
  }, [map, sketchMode, sketchTopology, sketchOpacity]);

  // JLM Phase 2 Issue 2: Hapus toolbar → trash selected sketch feature(s)
  useEffect(() => {
    if (!sketchMode || !drawRef.current || sketchTrashTick === 0) return;
    try {
      const selected = drawRef.current.getSelectedIds?.() ?? [];
      if (!selected.length) {
        // Select mode so user can click a feature, then Hapus again
        drawRef.current.changeMode('simple_select');
        toast.info('Pilih objek sketch dulu, lalu klik Hapus lagi');
        return;
      }
      drawRef.current.trash();
      const fc = drawRef.current.getAll();
      setSketchTopology(fc);
      updateMeasurements(fc);
      toast.success('Objek sketch dihapus');
    } catch {
      /* draw control may be mid-teardown */
    }
  }, [sketchTrashTick, sketchMode, setSketchTopology]);

  // Update opacity dynamically
  useEffect(() => {
    if (map && drawRef.current) {
      // Update line opacity
      map.setPaintProperty('gl-draw-line', 'line-opacity', sketchOpacity);
      map.setPaintProperty('gl-draw-line-active', 'line-opacity', sketchOpacity);
      // Update polygon fill opacity
      map.setPaintProperty('gl-draw-polygon-fill', 'fill-opacity', 0.2 * sketchOpacity);
      map.setPaintProperty('gl-draw-polygon-fill-active', 'fill-opacity', 0.2 * sketchOpacity);
      // Update polygon stroke opacity
      map.setPaintProperty('gl-draw-polygon-stroke', 'line-opacity', sketchOpacity);
      map.setPaintProperty('gl-draw-polygon-stroke-active', 'line-opacity', sketchOpacity);
      // Update point opacity
      map.setPaintProperty('gl-draw-point', 'circle-opacity', sketchOpacity);
      map.setPaintProperty('gl-draw-point-active', 'circle-opacity', sketchOpacity);
    }
  }, [sketchOpacity, map]);

  // Reactive hydration: Update draw when sketchTopology changes from outside (e.g., Load)
  useEffect(() => {
    if (drawRef.current && sketchTopology?.features) {
      // Only update if the drawn features differ from the state (prevents infinite loops during drawing)
      const currentDraw = drawRef.current.getAll();
      if (JSON.stringify(currentDraw.features) !== JSON.stringify(sketchTopology.features)) {
        drawRef.current.deleteAll();
        if (sketchTopology.features.length > 0) {
          // Snap loaded points
          const snappedFc = { ...sketchTopology };
          snappedFc.features = sketchTopology.features.map((feature: any) => {
            if (feature.geometry.type === 'Point') {
              const point = turf.point(feature.geometry.coordinates);
              let closestNode: any = null;
              let minDist = 5;
              Object.values(nodes).forEach((node: any) => {
                const nodePoint = turf.point([node.coordinates[0], node.coordinates[1]]);
                const dist = turf.distance(point, nodePoint, { units: 'meters' });
                if (dist < minDist) {
                  minDist = dist;
                  closestNode = node;
                }
              });
              if (closestNode) {
                return {
                  ...feature,
                  geometry: {
                    ...feature.geometry,
                    coordinates: [closestNode.coordinates[0], closestNode.coordinates[1]]
                  }
                };
              }
            }
            return feature;
          });
          drawRef.current.add(snappedFc);
        }
        updateMeasurements(sketchTopology);
      }
    }
  }, [sketchTopology, nodes]); 
}