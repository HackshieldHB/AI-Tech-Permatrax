'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type maplibregl from 'maplibre-gl';
import type { Geometry } from 'geojson';

import { apiPatch } from '../../../lib/api';
import { toast } from 'sonner';
import type { GisLayer } from '../hooks/types';
import { getAllCoordinates } from '../hooks/useKmzLayers';

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
  // GIS Issue 7: zoom-to-layer needs the map instance
  mapRef: MutableRefObject<maplibregl.Map | null>;
};

// GIS Issue 5: layer punya Point yang bisa dipakai sebagai titik pelanggan?
function countLayerPoints(layer: GisLayer): number {
  return (layer.geoJson?.features ?? []).filter(
    (f) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint',
  ).length;
}

export function LayerPanel(props: LayerPanelProps) {
  const {
    layers,
    setLayers,
    uploadingKmz,
    handleKmzUpload,
    handleDeleteLayer,
    handleColorChange,
    mapRef,
  } = props;

  // GIS Issue 7: fit map view to the extent of one KMZ layer
  const zoomToLayer = (layer: GisLayer) => {
    const map = mapRef.current;
    if (!map || !layer.geoJson?.features?.length) return;
    let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
    layer.geoJson.features.forEach((feature) => {
      getAllCoordinates(feature.geometry as Geometry | null | undefined).forEach(([lng, lat]) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });
    });
    if (minLng >= 180) {
      toast.error('Layer tidak memiliki koordinat');
      return;
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, duration: 1000, maxZoom: 17 },
    );
  };

  return (
              <div style={{ padding: 16 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: `2px dashed ${uploadingKmz ? '#00D4B4' : '#D1D5DB'}`,
                    cursor: uploadingKmz ? 'wait' : 'pointer',
                    background: uploadingKmz ? '#00D4B408' : '#F9FAFB',
                    marginBottom: 14,
                    transition: 'all 150ms',
                  }}
                >
                  <span style={{ fontSize: 28 }}>
                    {uploadingKmz ? '⏳' : '📂'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                      }}
                    >
                      {uploadingKmz ? 'Memproses KMZ...' : '+ Upload KMZ / KML'}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginTop: 2,
                      }}
                    >
                      Tidak menghapus layer existing
                    </div>
                  </div>
                  <input
                    type="file"
                    accept=".kmz,.kml"
                    disabled={uploadingKmz}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleKmzUpload(file);
                      e.target.value = '';
                    }}
                  />
                </label>

                {layers.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '20px 0',
                      fontSize: 13,
                      color: '#6B7280',
                    }}
                  >
                    Belum ada layer KMZ
                  </div>
                ) : (
                  layers.map((layer) => (
                    <div
                      key={layer.id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: '#F9FAFB',
                        marginBottom: 6,
                        border: '1px solid #E5E7EB',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(e) =>
                            void handleColorChange(layer.id, e.target.value, layer.isVisible)
                          }
                          title="Ganti warna layer"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: '1px solid rgba(0,0,0,0.15)',
                            cursor: 'pointer',
                            padding: 0,
                            background: layer.color,
                          }}
                        />
                      </div>

                      <span
                        style={{
                          flex: 1,
                          fontSize: 12,
                          color: '#111',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {layer.name}
                      </span>

                      <span
                        style={{
                          fontSize: 9,
                          padding: '1px 5px',
                          borderRadius: 8,
                          background: '#E5E7EB',
                          color: '#6B7280',
                          flexShrink: 0,
                        }}
                      >
                        {layer.geoJson?.features?.length || 0} titik
                      </span>

                      {/* GIS Issue 7: zoom kembali ke lokasi layer KMZ */}
                      <button
                        type="button"
                        onClick={() => zoomToLayer(layer)}
                        title="Zoom ke layer ini"
                        style={{
                          padding: '3px 6px',
                          borderRadius: 5,
                          border: 'none',
                          background: '#EFF6FF',
                          color: '#2563EB',
                          cursor: 'pointer',
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        🔍
                      </button>

                      {/* GIS Issue 5: pakai titik KMZ ini sebagai titik pelanggan pada kalkulasi */}
                      {countLayerPoints(layer) > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = !layer.useAsCustomers;
                            setLayers((prev) =>
                              prev.map((l) => (l.id === layer.id ? { ...l, useAsCustomers: next } : l)),
                            );
                            toast.info(
                              next
                                ? `${countLayerPoints(layer)} titik dari "${layer.name}" akan dipakai sebagai titik pelanggan pada kalkulasi berikutnya`
                                : `Titik "${layer.name}" tidak lagi dipakai sebagai titik pelanggan`,
                            );
                          }}
                          title={
                            layer.useAsCustomers
                              ? 'Titik layer ini dipakai sebagai titik pelanggan pada kalkulasi — klik untuk menonaktifkan'
                              : 'Gunakan titik layer ini sebagai titik pelanggan (homepass) pada kalkulasi'
                          }
                          style={{
                            padding: '3px 6px',
                            borderRadius: 5,
                            border: 'none',
                            background: layer.useAsCustomers ? '#16A34A' : '#F3F4F6',
                            color: layer.useAsCustomers ? 'white' : '#9CA3AF',
                            cursor: 'pointer',
                            fontSize: 11,
                            flexShrink: 0,
                          }}
                        >
                          HP
                        </button>
                      )}

                      {/* JLM Issue 5: gunakan ODP/ODC/OLT KMZ sebagai existing network */}
                      <button
                        type="button"
                        onClick={() => {
                          const next = !layer.useAsExistingNetwork;
                          setLayers((prev) =>
                            prev.map((l) =>
                              l.id === layer.id ? { ...l, useAsExistingNetwork: next } : l,
                            ),
                          );
                          toast.info(
                            next
                              ? `"${layer.name}" dipakai sebagai existing network (ODP/ODC dikunci)`
                              : `"${layer.name}" tidak lagi dipakai sebagai existing network`,
                          );
                        }}
                        title={
                          layer.useAsExistingNetwork
                            ? 'Layer dipakai sebagai existing network — klik untuk menonaktifkan'
                            : 'Gunakan ODP/ODC/OLT di layer ini sebagai existing network pada kalkulasi'
                        }
                        style={{
                          padding: '3px 6px',
                          borderRadius: 5,
                          border: 'none',
                          background: layer.useAsExistingNetwork ? '#7C3AED' : '#F3F4F6',
                          color: layer.useAsExistingNetwork ? 'white' : '#9CA3AF',
                          cursor: 'pointer',
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        EX
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const newVis = !layer.isVisible;
                            try {
                              await apiPatch(`/map/layers/${layer.id}/visibility`, {
                                isVisible: newVis,
                              });
                              setLayers((prev) =>
                                prev.map((l) =>
                                  l.id === layer.id ? { ...l, isVisible: newVis } : l,
                                ),
                              );
                            } catch {
                              toast.error('Gagal update visibility');
                            }
                          })();
                        }}
                        title={layer.isVisible ? 'Sembunyikan' : 'Tampilkan'}
                        style={{
                          padding: '3px 7px',
                          borderRadius: 5,
                          border: 'none',
                          background: layer.isVisible ? '#22C55E15' : '#F3F4F6',
                          color: layer.isVisible ? '#22C55E' : '#9CA3AF',
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {layer.isVisible ? 'ON' : 'OFF'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleDeleteLayer(layer.id, layer.name)}
                        title="Hapus layer"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          border: 'none',
                          flexShrink: 0,
                          background: '#FEE2E2',
                          color: '#EF4444',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                          transition: 'all 150ms',
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = '#EF4444';
                          el.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.background = '#FEE2E2';
                          el.style.color = '#EF4444';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
  );
}
