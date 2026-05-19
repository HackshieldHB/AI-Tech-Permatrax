'use client';

import type { Dispatch, SetStateAction } from 'react';

import type { MapTileLayerBundle } from '../hooks/useMapInstance';
import type { FtthCalcApiResponse } from '../hooks/types';
import { DesignModeToggle } from './DesignModeToggle';
import { DesignModeToolbar } from './DesignModeToolbar';
import { DesignPropertiesPanel } from './DesignPropertiesPanel';

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
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'white',
            borderRadius: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}
        >
          {(['osm', 'satellite'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => switchMapType(type)}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                border: 'none',
                background: mapType === type ? '#00D4B4' : 'transparent',
                color: mapType === type ? 'white' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 150ms',
              }}
            >
              {TILE_LAYERS[type].icon} {TILE_LAYERS[type].label}
            </button>
          ))}
        </div>
  );
}

export type MapOverlaysProps = {
  topologyRendered: boolean;
  calcResult: FtthCalcApiResponse | null;
  loading: boolean;
  calcMode: 'idle' | 'backbone' | 'target' | 'result';
  editMode: boolean;
  setEditMode: (next: boolean) => void | Promise<void>;
  setActivePanel: Dispatch<
    SetStateAction<'layers' | 'calc' | 'legend' | null>
  >;
};

export function MapOverlays({
  topologyRendered,
  calcResult,
  loading,
  calcMode,
  editMode,
  setEditMode,
  setActivePanel,
}: MapOverlaysProps) {
  return (
    <>
      <DesignModeToggle editMode={editMode} setEditMode={setEditMode} />
      <DesignModeToolbar />
      <DesignPropertiesPanel />

      {topologyRendered && calcResult && (
        <div
          style={{
            position: 'absolute', // FIX
            bottom: 40, // FIX
            right: 12, // FIX
            zIndex: 10, // FIX
            background: 'white', // FIX
            borderRadius: 10, // FIX
            overflow: 'hidden', // FIX
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)', // FIX
            minWidth: 180, // FIX
          }}
        >
          <div
            style={{
              padding: '6px 12px', // FIX
              background: '#F9FAFB', // FIX
              borderBottom: '1px solid #E5E7EB', // FIX
              fontSize: 10, // FIX
              fontWeight: 700, // FIX
              color: '#374151', // FIX
              textTransform: 'uppercase', // FIX
              letterSpacing: '0.05em', // FIX
            }}
          >
            🔧 Equipment di Peta
          </div>
          {[
            { icon: '📡', label: 'OLT', value: '1 unit', color: '#1D4ED8' }, // FIX
            {
              icon: '🟣', // FIX
              label: 'ODC', // FIX
              value: `${calcResult.equipment.odc.count} unit`, // FIX
              color: '#7C3AED', // FIX
            },
            {
              icon: '🟢', // FIX
              label: 'ODP', // FIX
              value: `${calcResult.equipment.odp.count} unit`, // FIX
              color: '#16A34A', // FIX
            },
            {
              icon: '🟡', // FIX
              label: 'Closure', // FIX
              value: `${calcResult.equipment.closure.total} unit`, // FIX
              color: '#F59E0B', // FIX
            },
            {
              icon: '🏠', // FIX
              label: 'Homepass', // FIX
              value: `${calcResult.homepass.estimated} est.`, // FIX
              color: '#22C55E', // FIX
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: 'flex', // FIX
                alignItems: 'center', // FIX
                justifyContent: 'space-between', // FIX
                padding: '5px 12px', // FIX
                borderBottom: '1px solid #F3F4F6', // FIX
                fontSize: 11, // FIX
              }}
            >
              <span style={{ color: item.color, fontWeight: 600 }}>
                {item.icon} {item.label}
              </span>
              <span style={{ fontWeight: 700, color: '#111' }}>{item.value}</span>
            </div>
          ))}
          <div style={{ padding: '5px 12px' }}>
            <button
              type="button"
              onClick={() => setActivePanel('legend')}
              style={{
                width: '100%', // FIX
                padding: '4px', // FIX
                borderRadius: 5, // FIX
                border: '1px solid #E5E7EB', // FIX
                background: 'none', // FIX
                cursor: 'pointer', // FIX
                fontSize: 10, // FIX
                color: '#6B7280', // FIX
              }}
            >
              Lihat Legenda →
            </button>
          </div>
        </div>
      )}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>
              Memuat Peta GIS...
            </div>
          </div>
        </div>
      )}
      {calcMode !== 'idle' && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}
        >
          {calcMode === 'backbone' && '📡 Klik untuk pilih titik BACKBONE'}
          {calcMode === 'target' && '🎯 Klik untuk pilih area TARGET'}
          {calcMode === 'result' && '✅ Siap dihitung — klik Hitung Sekarang'}
        </div>
      )}
    </>
  );
}
