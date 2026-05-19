'use client';

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
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#6B7280',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Kategori Area
                  </div>
                  {Object.entries(categoryConfig).map(([key, cfg]) => (
                    <div
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        background: cfg.bg,
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: cfg.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'white',
                        }}
                      >
                        {key}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: cfg.color,
                          }}
                        >
                          {cfg.label}
                        </div>
                        <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                          {cfg.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#6B7280',
                      marginBottom: 8,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    Status Fase
                  </div>
                  {[
                    { color: '#3B82F6', label: 'Survey / Input' },
                    { color: '#8B5CF6', label: 'SIP Request' },
                    { color: '#F59E0B', label: 'HLD / LLD' },
                    { color: '#EF4444', label: 'PR/BR / SKOM' },
                    { color: '#22C55E', label: 'Permit Done (ISP Approved)' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 5,
                      }}
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: item.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12, color: '#374151' }}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#16A34A',
                      marginBottom: 8,
                    }}
                  >
                    📊 Statistik
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#374151',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div>
                      Total cluster: <strong>{clusters.length}</strong>
                    </div>
                    <div>
                      Punya koordinat:{' '}
                      <strong>
                        {
                          clusters.filter(
                            (c) => c.latitude != null && c.longitude != null,
                          ).length
                        }
                      </strong>
                    </div>
                    <div>
                      Permit Done:{' '}
                      <strong>{clusters.filter((c) => c.isDone).length}</strong>{' '}
                      (green pin)
                    </div>
                    <div>
                      Layer KMZ: <strong>{layers.length}</strong>
                    </div>
                  </div>
                </div>

                {/* FIX: Topology legend (shown after calculation) */}
                {topologyRendered && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 11, // FIX
                        fontWeight: 700, // FIX
                        color: '#6B7280', // FIX
                        marginBottom: 8, // FIX
                        textTransform: 'uppercase' as const, // FIX
                        letterSpacing: '0.05em', // FIX
                      }}
                    >
                      Topologi FTTH
                    </div>
                    {[
                      { color: '#1D4ED8', size: 13, label: 'OLT / Backbone', type: 'circle' as const }, // FIX
                      { color: '#2563EB', size: 3, label: 'Kabel Feeder', type: 'line' as const }, // FIX
                      { color: '#7C3AED', size: 11, label: 'ODC (Kabinet)', type: 'circle' as const }, // FIX
                      { color: '#00D4B4', size: 2, label: 'Kabel Distribusi', type: 'line' as const }, // FIX
                      { color: '#16A34A', size: 8, label: 'ODP (Splitter)', type: 'circle' as const }, // FIX
                      { color: '#86EFAC', size: 1, label: 'Kabel Drop', type: 'line' as const }, // FIX
                      { color: '#22C55E', size: 5, label: 'Homepass', type: 'circle' as const }, // FIX
                      { color: '#F59E0B', size: 5, label: 'Closure', type: 'circle' as const }, // FIX
                      { color: '#9CA3AF', size: 3, label: 'Tiang', type: 'circle' as const }, // FIX
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: 'flex', // FIX
                          alignItems: 'center', // FIX
                          gap: 8, // FIX
                          marginBottom: 5, // FIX
                        }}
                      >
                        {item.type === 'circle' ? (
                          <div
                            style={{
                              width: item.size * 1.5, // FIX
                              height: item.size * 1.5, // FIX
                              borderRadius: '50%', // FIX
                              background: item.color, // FIX
                              flexShrink: 0, // FIX
                              border: '1.5px solid white', // FIX
                              boxShadow: '0 1px 3px rgba(0,0,0,0.2)', // FIX
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 20, // FIX
                              height: Math.max(2, item.size), // FIX
                              borderRadius: 1, // FIX
                              background: item.color, // FIX
                              flexShrink: 0, // FIX
                            }}
                          />
                        )}
                        <span style={{ fontSize: 11, color: '#374151' }}>{item.label}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => clearTopology()}
                      style={{
                        marginTop: 8, // FIX
                        width: '100%', // FIX
                        padding: '5px', // FIX
                        borderRadius: 6, // FIX
                        border: '1px solid #E5E7EB', // FIX
                        background: 'white', // FIX
                        cursor: 'pointer', // FIX
                        fontSize: 11, // FIX
                        color: '#6B7280', // FIX
                      }}
                    >
                      🗑️ Hapus Topologi
                    </button>
                  </div>
                )}
              </div>
  );
}
