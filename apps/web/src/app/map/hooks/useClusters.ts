import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { apiGet } from '../../../lib/api';
import type { ClusterPin, GisLayer } from './types';

const CATEGORY_CONFIG = {
  A: {
    label: 'Kategori A', // FIX
    color: '#EF4444', // FIX
    bg: '#EF444420', // FIX
    desc: 'High Priority (>200 homepass, backbone <500m)', // FIX
  },
  B: {
    label: 'Kategori B', // FIX
    color: '#F59E0B', // FIX
    bg: '#F59E0B20', // FIX
    desc: 'Medium Priority (80-200 homepass)', // FIX
  },
  C: {
    label: 'Kategori C', // FIX
    color: '#22C55E', // FIX
    bg: '#22C55E20', // FIX
    desc: 'Low Priority (<80 homepass)', // FIX
  },
};

// ── PHASE COLOR MAP ─────────────────────────────────────
const getPhaseColor = (phase: string, isDone: boolean): string => {
  if (isDone) return '#22C55E'; // FIX: hijau untuk DONE
  const colors: Record<string, string> = {
    SITE_VISIT: '#3B82F6', // FIX
    SURVEY_INPUT: '#3B82F6', // FIX
    SIP_REQUEST: '#8B5CF6', // FIX
    HLD_SUBMISSION: '#F59E0B', // FIX
    LLD_SUBMISSION: '#F59E0B', // FIX
    PR_BR_ISSUANCE: '#EF4444', // FIX
    SKOM_BUDGET: '#EF4444', // FIX
    PERMIT_DONE: '#22C55E', // FIX
  };
  return colors[phase] || '#6B7280'; // FIX
};

/** styleEpoch lifted to page level so clusters can rerun marker paint when basemap/style reloads */
export function useClusters(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  styleEpoch: number,
) {
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [clusters, setClusters] = useState<ClusterPin[]>([]);
  const [layers, setLayers] = useState<GisLayer[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (mapInstance?: maplibregl.Map | null) => {
    try {
      const m = mapInstance ?? mapRef.current;
      let clustersPath = '/map/clusters?limit=200';
      if (m) {
        const b = m.getBounds();
        clustersPath = `/map/clusters?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&limit=200`;
      }
      const [clustersData, layersData] = await Promise.all([
        apiGet<ClusterPin[]>(clustersPath),
        apiGet<GisLayer[]>('/map/layers?limit=200'),
      ]);
      setClusters(clustersData || []); // FIX
      setLayers(
        (layersData || []).map((L) => ({
          ...L,
          isVisible: L.isVisible !== false, // FIX
        })),
      ); // FIX
    } catch {
      // FIX: map tetap bisa dipakai tanpa API
    } finally {
      setLoading(false); // FIX
    }
  }, []);

  // ── Render cluster markers ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current; // FIX
    if (!map || !map.isStyleLoaded()) return; // FIX

    markersRef.current.forEach((m) => m.remove()); // FIX
    markersRef.current = []; // FIX

    clusters
      .filter(
        (c) =>
          c.latitude != null &&
          c.longitude != null &&
          !Number.isNaN(c.latitude) &&
          !Number.isNaN(c.longitude),
      ) // FIX: hanya pin valid
      .forEach((cluster) => {
        const color = getPhaseColor(cluster.phase, cluster.isDone); // FIX
        const category = cluster.areaCategory || 'C'; // FIX
        const catCfg =
          CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.C; // FIX

        const el = document.createElement('div'); // FIX
        el.style.cssText = `
          width: 32px; height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: ${color};
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          cursor: pointer;
          position: relative;
        `; // FIX

        const badge = document.createElement('div'); // FIX
        badge.style.cssText = `
          position: absolute;
          top: -2px; right: -2px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: ${catCfg.color};
          color: white;
          font-size: 8px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(45deg);
          border: 1px solid white;
        `; // FIX
        badge.textContent = category; // FIX
        el.appendChild(badge); // FIX

        const popup = new maplibregl.Popup({
          offset: 25, // FIX
          maxWidth: '280px', // FIX
        }).setHTML(`
          <div style="font-family:sans-serif;padding:4px">
            <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:4px">
              ${cluster.clusterCode}
            </div>
            <div style="font-size:12px;color:#666;margin-bottom:8px">
              ${cluster.siteName || cluster.rwName || ''}
              ${cluster.ispCustomer ? `· ${cluster.ispCustomer}` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                font-weight:600;background:${color}20;color:${color}">
                ${cluster.phase?.replace(/_/g, ' ')}
              </span>
              <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                font-weight:600;background:${catCfg.bg};color:${catCfg.color}">
                ${catCfg.label}
              </span>
              ${
                cluster.isDone
                  ? `
                <span style="padding:2px 8px;border-radius:10px;font-size:10px;
                  font-weight:600;background:#22C55E20;color:#22C55E">
                  🟢 DONE (ISP Approved)
                </span>
              `
                  : ''
              }
            </div>
            <div style="font-size:11px;color:#888">
              📡 ${cluster.fiberType} · 🏠 ${cluster.homepasCount ?? '?'} homepass
            </div>
            ${cluster.doneAt ? `<div style="font-size:10px;color:#6B7280;margin-top:4px">Selesai: ${new Date(cluster.doneAt).toLocaleDateString('id-ID')}</div>` : ''}
            ${
              cluster.latitude != null
                ? `
              <div style="font-size:10px;color:#aaa;margin-top:4px">
                ${cluster.latitude.toFixed(5)}, ${cluster.longitude?.toFixed(5)}
              </div>
            `
                : ''
            }
            ${cluster.isDone ? `<a href="/document-list/${cluster.id}" style="display:inline-block;margin-top:8px;padding:6px 10px;border-radius:8px;background:#22C55E15;color:#16A34A;font-size:11px;font-weight:700;text-decoration:none">View BAKP Document</a>` : ''}
          </div>
        `); // FIX

        const marker = new maplibregl.Marker({ element: el }) // FIX
          .setLngLat([cluster.longitude!, cluster.latitude!]) // FIX
          .setPopup(popup) // FIX
          .addTo(map); // FIX

        markersRef.current.push(marker); // FIX
      });
  }, [clusters, styleEpoch]); // FIX: re-render markers when style changes

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
