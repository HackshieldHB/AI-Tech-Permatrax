'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';

import { BasemapToggle } from './MapOverlays';
import type { MapTileLayerBundle } from '../hooks/useMapInstance';
import { CalcPanel, type CalcPanelProps } from './CalcPanel';
import { LayerPanel, type LayerPanelProps } from './LayerPanel';
import { LegendPanel, type LegendCategoryConfig } from './LegendPanel';
import { SavedDesignsPanel, type SavedDesignsPanelProps } from './SavedDesignsPanel';

export type LeftSidebarPanels = {
  legend: {
    clusters: import('../hooks/types').ClusterPin[];
    layers: import('../hooks/types').GisLayer[];
    topologyRendered: boolean;
    topoExportData?: import('../hooks/types').TopoExportData | null;
    categoryConfig: LegendCategoryConfig;
    clearTopology: () => void;
    mapRef: MutableRefObject<maplibregl.Map | null>;
  };
  layers: LayerPanelProps;
  calc: CalcPanelProps;
  design: SavedDesignsPanelProps;
};

export type LeftSidebarProps = {
  activePanel: 'layers' | 'calc' | 'legend' | 'design' | null;
  setActivePanel: Dispatch<SetStateAction<'layers' | 'calc' | 'legend' | 'design' | null>>;
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
  const { legend: legendProps, layers: layerProps, calc: calcProps, design: designProps } = panels;

  return (
    <>
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
        <BasemapToggle
          mapType={mapType}
          switchMapType={switchMapType}
          TILE_LAYERS={TILE_LAYERS}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: 'white',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
          }}
        >
          {[
            { key: 'legend' as const, label: '🏷️ Legenda' },
            { key: 'layers' as const, label: '📂 KMZ Layers' },
            { key: 'calc' as const, label: '🧮 Kalkulasi' },
            { key: 'design' as const, label: '💾 Saved Designs' },
          ].map((panel) => (
            <button
              key={panel.key}
              type="button"
              onClick={() =>
                setActivePanel(activePanel === panel.key ? null : panel.key)
              }
              style={{
                padding: '8px 14px',
                border: 'none',
                textAlign: 'left',
                background:
                  activePanel === panel.key ? '#F06A6A18' : 'transparent',
                color: activePanel === panel.key ? '#F06A6A' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                borderLeft:
                  activePanel === panel.key
                    ? '3px solid #F06A6A'
                    : '3px solid transparent',
                transition: 'all 150ms',
              }}
            >
              {panel.label}
            </button>
          ))}
        </div>
      </div>
      {activePanel && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 200,
            width: 300,
            maxHeight: 'calc(100vh - 120px)',
            background: 'white',
            borderRadius: 14,
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #F3F4F6',
              background: '#F9FAFB',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
              {activePanel === 'legend' && '🏷️ Legenda Peta'}
              {activePanel === 'layers' && '📂 KMZ Layers'}
              {activePanel === 'calc' && '🧮 Kalkulasi FTTH'}
              {activePanel === 'design' && '💾 Saved Designs'}
            </span>
            <button
              type="button"
              onClick={() => setActivePanel(null)}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                border: 'none',
                background: '#E5E7EB',
                cursor: 'pointer',
                fontSize: 14,
                color: '#6B7280',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {activePanel === 'legend' && (
              <LegendPanel
                clusters={legendProps.clusters}
                layers={legendProps.layers}
                topologyRendered={legendProps.topologyRendered}
                topoExportData={legendProps.topoExportData}
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
                mapRef={layerProps.mapRef}
              />
            )}
            {activePanel === 'calc' && <CalcPanel {...calcProps} />}
            {activePanel === 'design' && <SavedDesignsPanel {...designProps} />}
          </div>
        </div>
      )}
    </>
  );
}
