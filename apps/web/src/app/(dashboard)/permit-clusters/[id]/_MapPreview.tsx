'use client';

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export function MapPreview({ data }: { data: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [106.8456, -6.2088],
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      try {
        const geo = data as any;
        if (!geo || typeof geo !== 'object') return;
        map.addSource('route', { type: 'geojson', data: geo as any });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#00D4B4', 'line-width': 4 },
        });
        const bounds = new maplibregl.LngLatBounds();
        const collect = (coords: any) => {
          if (typeof coords[0] === 'number') bounds.extend(coords as [number, number]);
          else coords.forEach(collect);
        };
        if ((geo as any).type === 'FeatureCollection') {
          (geo as any).features.forEach((f: any) => {
            const g = f.geometry;
            if (g?.coordinates) collect(g.coordinates);
          });
        } else if ((geo as any).coordinates) {
          collect((geo as any).coordinates);
        }
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
      } catch {
        /* ignore malformed GIS JSON */
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  return <div ref={ref} className="h-56 w-full rounded-xl overflow-hidden border border-slate-200" />;
}
