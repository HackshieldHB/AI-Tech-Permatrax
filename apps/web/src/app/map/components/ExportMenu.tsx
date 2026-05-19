'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import maplibregl from 'maplibre-gl';
import { toast } from 'sonner'; // FIX: user feedback (panel actions)

import type { FtthCalcApiResponse, TopoExportData } from '../hooks/types';
import { exportKmz, exportMapImage, exportPdf } from '../hooks/useExports';

export type ExportMenuProps = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  calcResult: FtthCalcApiResponse | null;
  topologyRendered: boolean;
  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  backbonePoint: [number, number] | null;
  targetPoint: [number, number] | null;
  topoExportData: TopoExportData | null;
};

export function ExportMenu({
  mapRef,
  calcResult,
  topologyRendered,
  exporting,
  setExporting,
  backbonePoint,
  targetPoint,
  topoExportData,
}: ExportMenuProps) {
  if (!calcResult || !topologyRendered) return null;
  return (
    <>
                    {/* FIX: Export buttons — show after calculation */}
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 10,
                          background: '#F9FAFB',
                          border: '0.5px solid var(--color-border-tertiary)',
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#374151',
                            marginBottom: 8,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          📥 Export Hasil
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(
                            [
                              { key: 'image' as const, icon: '🖼️', label: 'Screenshot Peta (PNG)' },
                              { key: 'pdf-map' as const, icon: '📄', label: 'PDF — Peta Saja' },
                              { key: 'pdf-full' as const, icon: '📊', label: 'PDF — Lengkap + ROI' },
                              {
                                key: 'kmz' as const,
                                icon: '📍',
                                label: 'Export KMZ (Google Earth)',
                              },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              disabled={exporting}
                              onClick={() => {
                                void (async () => {
                                  setExporting(true); // FIX
                                  try {
                                    const fname = `permatrax-ftth-${
                                      calcResult.summary?.areaType || 'calc'
                                    }-${Date.now()}`; // FIX

                                    if (opt.key === 'image') {
                                      await exportMapImage(mapRef, `${fname}.png`); // FIX
                                      toast.success('✅ Screenshot diunduh'); // FIX
                                    } else if (opt.key === 'pdf-map' || opt.key === 'pdf-full') {
                                      await exportPdf(opt.key, mapRef, calcResult); // FIX
                                      toast.success('✅ PDF diunduh'); // FIX
                                    } else if (opt.key === 'kmz') {
                                      await exportKmz(
                                        {
                                          backbone: backbonePoint ?? undefined, // FIX
                                          odcPoint: targetPoint ?? undefined, // FIX
                                          odpPositions: topoExportData?.odpPositions || [], // FIX
                                          homepassPoints: topoExportData?.homepassPoints || [], // FIX
                                        },
                                        fname,
                                      ); // FIX
                                      toast.success('✅ KMZ diunduh'); // FIX
                                    } // FIX
                                  } catch (err: unknown) {
                                    const m = err instanceof Error ? err.message : 'Error'; // FIX
                                    toast.error(`Export gagal: ${m}`); // FIX
                                  } finally {
                                    setExporting(false); // FIX
                                  } // FIX
                                })(); // FIX
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: exporting
                                  ? 'var(--color-background-secondary)'
                                  : 'var(--color-background-primary)',
                                cursor: exporting ? 'not-allowed' : 'pointer',
                                fontSize: 12,
                                fontWeight: 500,
                                color: exporting ? '#9CA3AF' : 'var(--color-text-primary)',
                                border: '0.5px solid var(--color-border-tertiary)',
                                textAlign: 'left',
                              }}
                            >
                              <span>{opt.icon}</span>
                              <span>{opt.label}</span>
                              {exporting && (
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#9CA3AF' }}>
                                  ⏳
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
    </>
  );
}
