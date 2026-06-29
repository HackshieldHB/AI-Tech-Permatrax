// TODO(design-mode-phase-1.5): Split this component into CalcInputs, CalcResults,
// CalcActions before adding Design Mode UI in Phase 2. The 30-prop interface
// from page.tsx will shrink naturally once props are scoped to subcomponents.
'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useState } from 'react';
import maplibregl from 'maplibre-gl';

import type { FtthCalcApiResponse, OsmElement, TopoExportData } from '../hooks/types';
import { clearPolygonFromMap } from '../hooks/useCalculation';
import { exportExcel, exportKmz, exportMapImage, exportPdf, type ExcelAreaMeta } from '../hooks/useExports';
import { toast } from 'sonner';

export type CalcPanelProps = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  polygonMarkersRef: MutableRefObject<maplibregl.Marker[]>;

  calcMode: 'idle' | 'backbone' | 'target' | 'result';
  setCalcMode: Dispatch<SetStateAction<'idle' | 'backbone' | 'target' | 'result'>>;

  backbonePoint: [number, number] | null;
  setBackbonePoint: Dispatch<SetStateAction<[number, number] | null>>;
  targetPoint: [number, number] | null;
  setTargetPoint: Dispatch<SetStateAction<[number, number] | null>>;

  areaType: string;
  setAreaType: Dispatch<SetStateAction<string>>;
  areaRadius: number;
  setAreaRadius: Dispatch<SetStateAction<number>>;
  // JLM Issue 3A: ODP port capacity (1:8 / 1:16)
  odpPortCapacity: 8 | 16;
  setOdpPortCapacity: Dispatch<SetStateAction<8 | 16>>;

  nearestBackbone: OsmElement | null;
  setNearestBackbone: Dispatch<SetStateAction<OsmElement | null>>;

  calculating: boolean;
  runCalculation: () => Promise<void>;
  calcResult: FtthCalcApiResponse | null;
  setCalcResult: Dispatch<SetStateAction<FtthCalcApiResponse | null>>;

  inputMode: 'radius' | 'polygon';
  setInputMode: Dispatch<SetStateAction<'radius' | 'polygon'>>;
  polygonPoints: [number, number][];
  setPolygonPoints: Dispatch<SetStateAction<[number, number][]>>;
  isDrawingPolygon: boolean;
  setIsDrawingPolygon: Dispatch<SetStateAction<boolean>>;
  polygonAreaSqM: number | null;
  setPolygonAreaSqM: Dispatch<SetStateAction<number | null>>;
  polygonCentroid: [number, number] | null;
  setPolygonCentroid: Dispatch<SetStateAction<[number, number] | null>>;

  clearCalcGraphics: () => void;

  exporting: boolean;
  setExporting: Dispatch<SetStateAction<boolean>>;
  topologyRendered: boolean;
  renderingTopology: boolean;
  topoExportData: TopoExportData | null;

  clearTopology: () => void;
  renderTopology: (
    result: FtthCalcApiResponse,
    backbone: [number, number],
    target: [number, number],
    drawnPolygon?: [number, number][] | null,
  ) => Promise<void>;
  handleStartCalc: () => void;
  setActivePanel?: Dispatch<
    SetStateAction<'layers' | 'calc' | 'legend' | 'design' | null>
  >;
};

export function CalcPanel(props: CalcPanelProps) {
  const {
    mapRef,
    polygonMarkersRef,
    calcMode,
    setCalcMode,
    backbonePoint,
    setBackbonePoint,
    targetPoint,
    setTargetPoint,
    areaType,
    setAreaType,
    areaRadius,
    setAreaRadius,
    odpPortCapacity,
    setOdpPortCapacity,
    nearestBackbone,
    setNearestBackbone,
    calculating,
    runCalculation,
    calcResult,
    setCalcResult,
    inputMode,
    setInputMode,
    polygonPoints,
    setPolygonPoints,
    isDrawingPolygon,
    setIsDrawingPolygon,
    polygonAreaSqM,
    setPolygonAreaSqM,
    polygonCentroid,
    setPolygonCentroid,
    clearCalcGraphics,
    exporting,
    setExporting,
    topologyRendered,
    renderingTopology,
    topoExportData,
    clearTopology,
    renderTopology,
    handleStartCalc,
    setActivePanel,
  } = props;

  // JLM Issue 1: Export to Excel dialog (area metadata, editable, best-effort geocode)
  const [showExcel, setShowExcel] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [excelMeta, setExcelMeta] = useState<ExcelAreaMeta>({
    name: '', rw: '', provinsi: '', kabupaten: '', kelurahan: '', kecamatan: '', alamat: '',
  });

  const openExcelDialog = async () => {
    setShowExcel(true);
    const hps = topoExportData?.homepassPoints ?? [];
    let lat = targetPoint?.[1];
    let lng = targetPoint?.[0];
    if (hps.length) {
      lat = hps.reduce((s, h) => s + h.lat, 0) / hps.length;
      lng = hps.reduce((s, h) => s + h.lng, 0) / hps.length;
    }
    if (lat == null || lng == null) return;
    setGeocoding(true);
    const up = (v: unknown) => (v ? String(v).toUpperCase() : '');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) },
      );
      if (res.ok) {
        const data = (await res.json()) as { address?: Record<string, string> };
        const a = data.address ?? {};
        setExcelMeta((prev) => ({
          ...prev,
          provinsi: prev.provinsi || up(a.state),
          kabupaten: prev.kabupaten || up(a.county || a.city),
          kecamatan: prev.kecamatan || up(a.city_district || a.municipality || a.suburb),
          kelurahan: prev.kelurahan || up(a.village || a.neighbourhood || a.hamlet),
        }));
      }
    } catch {
      /* offline / rate-limited — fields stay editable */
    } finally {
      setGeocoding(false);
    }
  };

  const doExcelExport = async () => {
    const hps = (topoExportData?.homepassPoints ?? []).map((h) => ({
      lat: h.lat, lng: h.lng, odpIndex: h.odpIndex, covered: h.covered,
    }));
    if (!hps.length) {
      toast.error('Belum ada data homepass untuk diexport');
      return;
    }
    setExporting(true);
    try {
      await exportExcel({ homepass: hps, meta: excelMeta, filename: `JLM-DataListCustomer-${Date.now()}` });
      toast.success('✅ Excel diunduh');
      setShowExcel(false);
    } catch (err: unknown) {
      toast.error(`Export gagal: ${err instanceof Error ? err.message : 'Error'}`);
    } finally {
      setExporting(false);
    }
  };

  return (              <div style={{ padding: 16 }}>
                {/* JLM Issue 1: Export to Excel dialog */}
                {showExcel && (
                  <div
                    style={{
                      position: 'fixed', inset: 0, zIndex: 2000,
                      background: 'rgba(0,0,0,0.4)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', padding: 16,
                    }}
                    onClick={() => setShowExcel(false)}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: 'white', borderRadius: 12, padding: 18,
                        width: 380, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto',
                        boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 4 }}>
                        📑 Export to Excel
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 }}>
                        Lengkapi data area. Kolom wilayah diisi otomatis bila tersedia — silakan koreksi
                        bila perlu. {geocoding && <span style={{ color: '#00B89E' }}>⏳ mengambil wilayah…</span>}
                      </div>
                      {([
                        ['name', 'Name (Area / Cluster)'],
                        ['rw', 'RW'],
                        ['provinsi', 'Provinsi'],
                        ['kabupaten', 'Kabupaten'],
                        ['kecamatan', 'Kecamatan'],
                        ['kelurahan', 'Kelurahan'],
                        ['alamat', 'Alamat (opsional)'],
                      ] as const).map(([key, label]) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: 3 }}>
                            {label}
                          </label>
                          <input
                            value={excelMeta[key] ?? ''}
                            onChange={(e) => setExcelMeta((prev) => ({ ...prev, [key]: e.target.value }))}
                            style={{
                              width: '100%', padding: '7px 9px', borderRadius: 7,
                              border: '1px solid #E5E7EB', fontSize: 12, boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                        <button
                          type="button"
                          onClick={() => setShowExcel(false)}
                          style={{
                            flex: 1, padding: '9px', borderRadius: 8, border: '1px solid #E5E7EB',
                            background: 'white', cursor: 'pointer', fontSize: 12, color: '#6B7280',
                          }}
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          disabled={exporting}
                          onClick={() => void doExcelExport()}
                          style={{
                            flex: 2, padding: '9px', borderRadius: 8, border: 'none',
                            background: exporting ? '#E5E7EB' : 'linear-gradient(135deg, #00D4B4, #00B89E)',
                            color: exporting ? '#9CA3AF' : 'white', cursor: exporting ? 'not-allowed' : 'pointer',
                            fontSize: 12, fontWeight: 700,
                          }}
                        >
                          {exporting ? '⏳ Mengunduh…' : '⬇️ Download .xlsx'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {calcMode === 'idle' && !calcResult && (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: '#6B7280',
                        marginBottom: 14,
                        lineHeight: 1.5,
                      }}
                    >
                      Gunakan kalkulasi untuk menghitung kebutuhan jaringan FTTH
                      pada area yang dipilih.
                    </p>

                    {/* FIX: Input mode toggle */}
                    <div style={{ marginBottom: 14 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--color-text-secondary)',
                          display: 'block',
                          marginBottom: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Mode Input Area
                      </label>
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          background: 'var(--color-background-secondary)',
                          padding: 4,
                          borderRadius: 10,
                        }}
                      >
                        {(
                          [
                            { key: 'radius' as const, label: '⭕ Radius' },
                            { key: 'polygon' as const, label: '🔷 Polygon' },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => {
                              setInputMode(m.key); // FIX
                              setPolygonPoints([]); // FIX
                              setPolygonAreaSqM(null); // FIX
                              setPolygonCentroid(null); // FIX
                              const mmap = mapRef.current; // FIX
                              if (mmap) clearPolygonFromMap(mmap); // FIX
                              polygonMarkersRef.current.forEach((mk) => mk.remove()); // FIX
                              polygonMarkersRef.current = []; // FIX
                            }}
                            style={{
                              flex: 1,
                              padding: '7px 8px',
                              borderRadius: 7,
                              border: 'none',
                              cursor: 'pointer',
                              background: inputMode === m.key ? 'white' : 'transparent',
                              color:
                                inputMode === m.key
                                  ? 'var(--color-text-primary)'
                                  : 'var(--color-text-secondary)',
                              fontWeight: inputMode === m.key ? 700 : 400,
                              fontSize: 12,
                              boxShadow:
                                inputMode === m.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                              transition: 'all 150ms',
                            }}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      {inputMode === 'polygon' && (
                        <div
                          style={{
                            fontSize: 11,
                            color: '#6B7280',
                            marginTop: 6,
                            lineHeight: 1.4,
                          }}
                        >
                          💡 Klik titik-titik di peta untuk menggambar area. Double-click untuk
                          menutup polygon.
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#6B7280',
                          display: 'block',
                          marginBottom: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Tipe Area
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['URBAN', 'SUBURBAN', 'RURAL'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setAreaType(t)}
                            style={{
                              flex: 1,
                              padding: '7px 4px',
                              borderRadius: 7,
                              border: `1.5px solid ${areaType === t ? '#00D4B4' : '#E5E7EB'}`,
                              background: areaType === t ? '#00D4B415' : 'white',
                              color: areaType === t ? '#00D4B4' : '#374151',
                              cursor: 'pointer',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {t === 'URBAN' ? '🏙️' : t === 'SUBURBAN' ? '🏘️' : '🌳'}{' '}
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* JLM Issue 3A: ODP port capacity selector */}
                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#6B7280',
                          display: 'block',
                          marginBottom: 6,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        Kapasitas Port ODP
                      </label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {([8, 16] as const).map((cap) => (
                          <button
                            key={cap}
                            type="button"
                            onClick={() => setOdpPortCapacity(cap)}
                            style={{
                              flex: 1,
                              padding: '7px 4px',
                              borderRadius: 7,
                              border: `1.5px solid ${odpPortCapacity === cap ? '#00D4B4' : '#E5E7EB'}`,
                              background: odpPortCapacity === cap ? '#00D4B415' : 'white',
                              color: odpPortCapacity === cap ? '#00D4B4' : '#374151',
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            📦 1:{cap}
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, lineHeight: 1.4 }}>
                        Maks. {odpPortCapacity} homepass per ODP. Jumlah ODP dihitung otomatis sesuai kapasitas.
                      </div>
                    </div>

                    {/* FIX: show radius only in radius mode */}
                    {inputMode === 'radius' && (
                      <div style={{ marginBottom: 16 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#6B7280',
                            display: 'block',
                            marginBottom: 6,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          Radius Area: {areaRadius}m
                        </label>
                        <input
                          type="range"
                          min={100}
                          max={1000}
                          step={50}
                          value={areaRadius}
                          onChange={(e) => setAreaRadius(Number(e.target.value))}
                          style={{ width: '100%' }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 10,
                            color: '#9CA3AF',
                          }}
                        >
                          <span>100m</span>
                          <span>500m</span>
                          <span>1km</span>
                        </div>
                      </div>
                    )}

                    {/* FIX: polygon area info */}
                    {inputMode === 'polygon' && polygonAreaSqM != null && polygonAreaSqM > 0 && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          marginBottom: 12,
                          background: '#F0FDF4',
                          border: '1px solid #BBF7D0',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#16A34A' }}>
                          ✅ Polygon tergambar:{' '}
                        </span>
                        <span style={{ color: '#374151' }}>
                          {polygonAreaSqM > 1_000_000
                            ? `${(polygonAreaSqM / 1_000_000).toFixed(3)} km²`
                            : `${Math.round(polygonAreaSqM).toLocaleString('id-ID')} m²`}
                          {' · '}
                          {polygonPoints.length} titik
                        </span>
                      </div>
                    )}
                    {inputMode === 'polygon' && (!polygonAreaSqM || polygonAreaSqM <= 0) && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          marginBottom: 12,
                          background: '#FFF7ED',
                          border: '1px solid #FED7AA',
                          fontSize: 11,
                          color: '#92400E',
                        }}
                      >
                        📍 Klik peta untuk tambah titik. Double-click untuk selesai.
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => handleStartCalc()}
                      style={{
                        width: '100%',
                        padding: '11px',
                        borderRadius: 10,
                        border: 'none',
                        background: 'linear-gradient(135deg, #00D4B4, #00B89E)',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                        boxShadow: '0 4px 14px #00D4B440',
                      }}
                    >
                      🧮 Mulai Kalkulasi
                    </button>
                  </>
                )}

                {(calcMode === 'backbone' || calcMode === 'target') && (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>
                      {calcMode === 'backbone' ? '📡' : '🎯'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#111',
                        marginBottom: 6,
                      }}
                    >
                      {calcMode === 'backbone'
                        ? 'Klik titik BACKBONE di peta'
                        : 'Klik area TARGET di peta'}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#6B7280',
                        marginBottom: 16,
                      }}
                    >
                      {calcMode === 'backbone'
                        ? 'Tandai lokasi backbone/OLT terdekat'
                        : 'Tandai area yang ingin dipasang FTTH'}
                    </div>
                    {backbonePoint && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: '#EFF6FF',
                          border: '1px solid #BFDBFE',
                          fontSize: 11,
                          color: '#1D4ED8',
                          marginBottom: 8,
                        }}
                      >
                        ✅ Backbone: {backbonePoint[1].toFixed(4)},{' '}
                        {backbonePoint[0].toFixed(4)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        clearTopology(); // FIX: remove topology layers
                        clearCalcGraphics();
                        setCalcMode('idle');
                      }}
                      style={{
                        padding: '7px 16px',
                        borderRadius: 8,
                        border: '1px solid #E5E7EB',
                        background: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#6B7280',
                      }}
                    >
                      ✕ Batalkan
                    </button>
                  </div>
                )}

                {calcMode === 'result' && !calcResult && (
                  <div style={{ padding: '12px 0' }}>
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#F0FDF4',
                        border: '1px solid #BBF7D0',
                        marginBottom: 12,
                        fontSize: 12,
                      }}
                    >
                      ✅ Backbone + Target sudah dipilih
                    </div>
                    <button
                      type="button"
                      onClick={() => void runCalculation()}
                      disabled={calculating}
                      style={{
                        width: '100%',
                        padding: '11px',
                        borderRadius: 10,
                        border: 'none',
                        background: calculating
                          ? '#E5E7EB'
                          : 'linear-gradient(135deg, #00D4B4, #00B89E)',
                        color: calculating ? '#9CA3AF' : 'white',
                        cursor: calculating ? 'not-allowed' : 'pointer',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {calculating ? '⏳ Menghitung...' : '🧮 Hitung Sekarang'}
                    </button>
                  </div>
                )}

                {/* FIX: Enhanced calculation results */}
                {calcResult && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* FIX: Category banner */}
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 10,
                        background:
                          calcResult.summary.areaCategory === 'A'
                            ? '#EF444415'
                            : calcResult.summary.areaCategory === 'B'
                              ? '#F59E0B15'
                              : '#22C55E15',
                        border: `1px solid ${
                          calcResult.summary.areaCategory === 'A'
                            ? '#EF444440'
                            : calcResult.summary.areaCategory === 'B'
                              ? '#F59E0B40'
                              : '#22C55E40'
                        }`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 17,
                          fontWeight: 800,
                          color:
                            calcResult.summary.areaCategory === 'A'
                              ? '#EF4444'
                              : calcResult.summary.areaCategory === 'B'
                                ? '#F59E0B'
                                : '#22C55E',
                        }}
                      >
                        {calcResult.summary.areaCategory === 'A'
                          ? '🔴'
                          : calcResult.summary.areaCategory === 'B'
                            ? '🟡'
                            : '🟢'}{' '}
                        Kategori {calcResult.summary.areaCategory}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6B7280',
                          marginTop: 3,
                          lineHeight: 1.4,
                        }}
                      >
                        {calcResult.summary.categoryReason}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                        📡 {calcResult.summary.backboneOwner} ·{' '}
                        {calcResult.summary.backboneDistanceM}m · {calcResult.summary.areaType}
                      </div>
                    </div>

                    {/* FIX: Export buttons — show after calculation */}
                    {calcResult && topologyRendered && (
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
                                      // JLM Issue 2: pass full topology incl. cable paths + snapped ODC
                                      await exportKmz(
                                        {
                                          ...topoExportData,
                                          backbone: topoExportData?.backbone ?? backbonePoint ?? undefined, // FIX
                                          odcPoint: topoExportData?.odcPoint ?? targetPoint ?? undefined, // FIX
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
                          {/* JLM Issue 1: Export to Excel */}
                          <button
                            type="button"
                            disabled={exporting}
                            onClick={() => void openExcelDialog()}
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
                            <span>📑</span>
                            <span>Export to Excel (.xlsx)</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setActivePanel?.('design')}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #D1D5DB',
                        background: 'white',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#374151',
                      }}
                    >
                      💾 Buka Saved Designs
                    </button>

                    {/* FIX: Selected topology card */}
                    {calcResult?.topology?.selected && (
                      <div
                        style={{
                          borderRadius: 10, // FIX
                          overflow: 'hidden', // FIX
                          border: '1.5px solid #BFDBFE', // FIX
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            background: '#EFF6FF', // FIX
                            borderBottom: '1px solid #BFDBFE', // FIX
                            display: 'flex', // FIX
                            justifyContent: 'space-between', // FIX
                            alignItems: 'center', // FIX
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11, // FIX
                              fontWeight: 700, // FIX
                              color: '#1D4ED8', // FIX
                              textTransform: 'uppercase', // FIX
                              letterSpacing: '0.05em', // FIX
                            }}
                          >
                            🌐 Topologi Terpilih
                          </span>
                          <span
                            style={{
                              padding: '2px 8px', // FIX
                              borderRadius: 10, // FIX
                              background: '#DBEAFE', // FIX
                              color: '#1D4ED8', // FIX
                              fontSize: 10, // FIX
                              fontWeight: 700, // FIX
                            }}
                          >
                            {calcResult.topology.selected.suitability}% cocok
                          </span>
                        </div>
                        <div style={{ padding: '10px 14px', background: 'white' }}>
                          <div
                            style={{
                              fontSize: 14, // FIX
                              fontWeight: 700, // FIX
                              color: '#111', // FIX
                              marginBottom: 4, // FIX
                            }}
                          >
                            {calcResult.topology.selected.label}
                          </div>
                          <div
                            style={{
                              fontSize: 11, // FIX
                              color: '#374151', // FIX
                              lineHeight: 1.5, // FIX
                              marginBottom: 8, // FIX
                            }}
                          >
                            {calcResult.topology.selected.description}
                          </div>
                          <div
                            style={{
                              display: 'grid', // FIX
                              gridTemplateColumns: '1fr 1fr', // FIX
                              gap: 6, // FIX
                            }}
                          >
                            <div
                              style={{
                                padding: '6px 8px', // FIX
                                borderRadius: 6, // FIX
                                background: '#F0FDF4', // FIX
                                border: '1px solid #BBF7D0', // FIX
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 9, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#16A34A', // FIX
                                  marginBottom: 3, // FIX
                                  textTransform: 'uppercase', // FIX
                                }}
                              >
                                Kelebihan
                              </div>
                              {calcResult.topology.selected.pros.slice(0, 3).map((p: string, i: number) => (
                                <div
                                  key={i}
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#166534', // FIX
                                    display: 'flex', // FIX
                                    gap: 4, // FIX
                                    marginBottom: 2, // FIX
                                  }}
                                >
                                  <span>✓</span>
                                  <span>{p}</span>
                                </div>
                              ))}
                            </div>
                            <div
                              style={{
                                padding: '6px 8px', // FIX
                                borderRadius: 6, // FIX
                                background: '#FEF2F2', // FIX
                                border: '1px solid #FECACA', // FIX
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 9, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#DC2626', // FIX
                                  marginBottom: 3, // FIX
                                  textTransform: 'uppercase', // FIX
                                }}
                              >
                                Kekurangan
                              </div>
                              {calcResult.topology.selected.cons.slice(0, 2).map((c: string, i: number) => (
                                <div
                                  key={i}
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#991B1B', // FIX
                                    display: 'flex', // FIX
                                    gap: 4, // FIX
                                    marginBottom: 2, // FIX
                                  }}
                                >
                                  <span>!</span>
                                  <span>{c}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* FIX: Key metrics row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        {
                          icon: '🏠',
                          label: 'Homepass',
                          value: `~${calcResult.homepass.estimated}`,
                          sub: `${calcResult.homepass.active} aktif (70%)`,
                        },
                        {
                          icon: '📏',
                          label: 'Total Route',
                          value: `${(calcResult.route.totalM / 1000).toFixed(2)} km`,
                          sub: 'feeder + distribusi',
                        },
                        {
                          icon: '🔌',
                          label: 'Total Kabel',
                          value: `${(calcResult.cable.totalM / 1000).toFixed(2)} km`,
                          sub: 'incl. buffer 15%',
                        },
                        {
                          icon: '📦',
                          label: `ODP ${calcResult.equipment.odp.capacity}P`,
                          value: `${calcResult.equipment.odp.count} unit`,
                          sub: `splitter ${calcResult.equipment.splitter.ratio}`,
                        },
                      ].map((m) => (
                        <div
                          key={m.label}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: '#F9FAFB',
                            border: '1px solid #E5E7EB',
                          }}
                        >
                          <div style={{ fontSize: 18, marginBottom: 3 }}>{m.icon}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#111' }}>
                            {m.value}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#374151',
                              marginTop: 1,
                            }}
                          >
                            {m.label}
                          </div>
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                            {m.sub}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* FIX: Topology */}
                    <div
                      style={{
                        background: '#F0F9FF',
                        borderRadius: 10,
                        border: '1px solid #BAE6FD',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #BAE6FD',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#0369A1',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🌐 Topologi Jaringan — {calcResult.topology.description}
                      </div>
                      {calcResult.topology.segments.map((seg, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 12px',
                            borderBottom:
                              i < calcResult.topology.segments.length - 1
                                ? '1px solid #E0F2FE'
                                : 'none',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#0369A1',
                              marginBottom: 3,
                            }}
                          >
                            {seg.name}
                          </div>
                          <div style={{ fontSize: 10, color: '#374151', lineHeight: 1.5 }}>
                            <span style={{ color: '#0284C7' }}>{seg.from}</span>
                            {' → '}
                            <span style={{ color: '#0284C7' }}>{seg.to}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                            📏 {seg.distance} · 🔌 {seg.cable}
                          </div>
                          {seg.notes && (
                            <div
                              style={{
                                fontSize: 10,
                                color: '#9CA3AF',
                                marginTop: 2,
                                fontStyle: 'italic',
                              }}
                            >
                              {seg.notes}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* FIX: Cable breakdown */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        📊 Rincian Kabel
                      </div>
                      <div style={{ padding: '8px 12px' }}>
                        {[
                          {
                            label: 'Feeder (OLT→ODC)',
                            m: calcResult.cable.breakdown.feederM,
                            type: calcResult.cable.feederCableType,
                          },
                          {
                            label: 'Distribusi (ODC→ODP)',
                            m: calcResult.cable.breakdown.distributionM,
                            type: calcResult.cable.distCableType,
                          },
                          {
                            label: 'Drop (ODP→ONT)',
                            m: calcResult.cable.breakdown.dropM,
                            type: calcResult.cable.dropCableType,
                          },
                        ].map((row, i) => (
                          <div key={i} style={{ marginBottom: 8 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>
                                {row.label}
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>
                                {row.m >= 1000
                                  ? `${(row.m / 1000).toFixed(2)} km`
                                  : `${row.m} m`}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                              {row.type}
                            </div>
                            {/* FIX: progress bar (guard totalM === 0) */}
                            <div
                              style={{
                                height: 3,
                                background: '#E5E7EB',
                                borderRadius: 2,
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  height: '100%',
                                  borderRadius: 2,
                                  background:
                                    i === 0 ? '#3B82F6' : i === 1 ? '#00D4B4' : '#F59E0B',
                                  width: `${calcResult.cable.totalM > 0 ? ((row.m / calcResult.cable.totalM) * 100).toFixed(0) : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            paddingTop: 8,
                            borderTop: '1px solid #E5E7EB',
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          <span>TOTAL (incl. 15% buffer)</span>
                          <span style={{ color: '#00D4B4' }}>
                            {(calcResult.cable.totalM / 1000).toFixed(2)} km
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* FIX: Equipment table */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🔧 Kebutuhan Perangkat
                      </div>
                      <div style={{ padding: '4px 12px' }}>
                        {[
                          {
                            icon: '📡',
                            label: 'OLT',
                            value: `1 unit (${calcResult.equipment.olt.portsNeeded} port)`,
                            sub: calcResult.equipment.olt.recommendation,
                          },
                          {
                            icon: '🏗️',
                            label: 'ODC',
                            value: `${calcResult.equipment.odc.count} unit`,
                            sub: calcResult.equipment.odc.capacity,
                          },
                          {
                            icon: '📦',
                            label: `ODP ${calcResult.equipment.odp.capacity}P`,
                            value: `${calcResult.equipment.odp.count} unit`,
                            sub: `spacing ~${calcResult.equipment.odp.spacingM}m`,
                          },
                          {
                            icon: '🔀',
                            label: `Splitter ${calcResult.equipment.splitter.ratio}`,
                            value: `${calcResult.equipment.splitter.count} unit`,
                            sub: 'passive optical splitter',
                          },
                          {
                            icon: '🔗',
                            label: 'Closure',
                            value: `${calcResult.equipment.closure.total} unit`,
                            sub: `${calcResult.equipment.closure.inline} inline`,
                          },
                          {
                            icon: '🪝',
                            label: 'Tiang',
                            value: `${calcResult.equipment.pole.total} total (${calcResult.equipment.pole.newBuild} baru)`, // FIX
                            sub: calcResult.equipment.pole.note, // FIX
                          },
                          {
                            icon: '🔧',
                            label: 'Splice',
                            value: `${calcResult.equipment.splice.total} titik`,
                            sub: 'fusion splice',
                          },
                          {
                            icon: '📡',
                            label: 'Connector SC/APC',
                            value: `${calcResult.equipment.connector.count} unit`,
                            sub: '',
                          },
                          {
                            icon: '🏠',
                            label: 'ONT/CPE',
                            value: `${calcResult.equipment.ont.count} unit`,
                            sub: calcResult.equipment.ont.type,
                          },
                          ...(calcResult.equipment.hdpeConduit.meters > 0
                            ? [
                                {
                                  icon: '🕳️',
                                  label: 'HDPE Conduit 32mm',
                                  value: `${calcResult.equipment.hdpeConduit.meters}m`,
                                  sub: 'underground route',
                                },
                              ]
                            : []),
                        ].map((eq, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              padding: '7px 0',
                              borderBottom: '1px solid #F3F4F6',
                            }}
                          >
                            <div>
                              <span style={{ fontSize: 12, color: '#374151' }}>
                                {eq.icon} {eq.label}
                              </span>
                              {eq.sub && (
                                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>
                                  {eq.sub}
                                </div>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#111',
                                flexShrink: 0,
                                marginLeft: 8,
                              }}
                            >
                              {eq.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* FIX: Topology rendering status */}
                    {topologyRendered && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: '#F0FDF4',
                          border: '1px solid #BBF7D0',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontSize: 18 }}>🗺️</span>
                        <div>
                          <span style={{ fontWeight: 700, color: '#16A34A' }}>
                            Topologi ditampilkan di peta
                          </span>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                            🔵 OLT → 🟣 ODC → 🟢 ODP (mengikuti jalan) · 🟡 Closure
                          </div>
                        </div>
                      </div>
                    )}

                    {renderingTopology && (
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: '#EFF6FF',
                          border: '1px solid #BFDBFE',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            border: '2px solid #3B82F6',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: '#1D4ED8' }}>Mengambil rute jalan via OSRM...</span>
                      </div>
                    )}

                    {/* FIX: Optical Power Budget — separate card */}
                    <div
                      style={{
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: `1.5px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 14px',
                          background: calcResult.powerBudget.isOk ? '#F0FDF4' : '#FEF2F2',
                          borderBottom: `1px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                          fontSize: 11,
                          fontWeight: 700,
                          color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        ⚡ {calcResult.powerBudget.gponClass}
                      </div>
                      <div style={{ padding: '10px 14px', background: 'white' }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 10,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: calcResult.powerBudget.isOk ? '#F0FDF4' : '#FEF2F2',
                            border: `1px solid ${calcResult.powerBudget.isOk ? '#BBF7D0' : '#FECACA'}`,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                              }}
                            >
                              {calcResult.powerBudget.isOk ? '✅' : '⚠️'} Cadangan Daya (Link Margin)
                            </div>
                            <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>
                              {calcResult.powerBudget.isOk
                                ? 'Cukup — minimum 3 dB diperlukan'
                                : 'Kurang — tingkatkan ke Class C+ atau kurangi split ratio'}
                            </div>
                          </div>
                          <span
                            style={{
                              fontSize: 20,
                              fontWeight: 800,
                              color: calcResult.powerBudget.isOk ? '#16A34A' : '#DC2626',
                            }}
                          >
                            {calcResult.powerBudget.linkMarginDB} dB
                          </span>
                        </div>

                        {[
                          {
                            label: 'Total Rugi Optik',
                            value: calcResult.powerBudget.totalLossDB,
                            bold: true,
                          },
                          {
                            label: 'Splitter',
                            value: calcResult.powerBudget.breakdown.splitterDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Feeder',
                            value: calcResult.powerBudget.breakdown.seratFeederDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Distribusi',
                            value: calcResult.powerBudget.breakdown.seratDistDB,
                            bold: false,
                          },
                          {
                            label: 'Serat Drop',
                            value: calcResult.powerBudget.breakdown.seratDropDB,
                            bold: false,
                          },
                          {
                            label: 'Konektor',
                            value: calcResult.powerBudget.breakdown.konektorDB,
                            bold: false,
                          },
                          {
                            label: 'Sambungan (Splice)',
                            value: calcResult.powerBudget.breakdown.sambunganDB,
                            bold: false,
                          },
                        ].map((row, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '5px 0',
                              borderBottom: '1px solid #F3F4F6',
                              fontSize: row.bold ? 12 : 11,
                            }}
                          >
                            <span
                              style={{
                                color: row.bold ? '#111' : '#374151',
                                fontWeight: row.bold ? 700 : 400,
                              }}
                            >
                              {row.label}
                            </span>
                            <span
                              style={{
                                fontWeight: row.bold ? 800 : 600,
                                color: row.bold ? '#111' : '#374151',
                              }}
                            >
                              {row.value} dB
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* FIX: Cost Estimation — vertical layout */}
                    {calcResult.costEstimation && (
                      <div
                        style={{
                          borderRadius: 10, // FIX
                          overflow: 'hidden', // FIX
                          border: '1.5px solid #FDE68A', // FIX
                        }}
                      >
                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', // FIX
                            borderBottom: '1px solid #FDE68A', // FIX
                            display: 'flex', // FIX
                            justifyContent: 'space-between', // FIX
                            alignItems: 'center', // FIX
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11, // FIX
                              fontWeight: 700, // FIX
                              color: '#92400E', // FIX
                              textTransform: 'uppercase' as const, // FIX
                              letterSpacing: '0.05em', // FIX
                            }}
                          >
                            💰 Estimasi Biaya Proyek
                          </span>
                          <span
                            style={{
                              fontSize: 9, // FIX
                              color: '#B45309', // FIX
                              fontStyle: 'italic', // FIX
                            }}
                          >
                            {calcResult.costEstimation.note}
                          </span>
                        </div>

                        <div
                          style={{
                            padding: '10px 14px', // FIX
                            background: '#FFFBEB', // FIX
                            borderBottom: '1px solid #FDE68A', // FIX
                          }}
                        >
                          <div
                            style={{
                              display: 'flex', // FIX
                              justifyContent: 'space-between', // FIX
                              alignItems: 'flex-start', // FIX
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontSize: 12, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#92400E', // FIX
                                }}
                              >
                                Total Estimasi Proyek
                              </div>
                              <div style={{ fontSize: 10, color: '#B45309', marginTop: 2 }}>
                                Per homepass: Rp{' '}
                                {calcResult.costEstimation.costPerHomepass.toLocaleString('id-ID')}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' as const }}>
                              <div
                                style={{
                                  fontSize: 18, // FIX
                                  fontWeight: 800, // FIX
                                  color: '#92400E', // FIX
                                }}
                              >
                                Rp {(calcResult.costEstimation.totalProject / 1e6).toFixed(1)}M
                              </div>
                            </div>
                          </div>
                        </div>

                        <div style={{ background: 'white', padding: '4px 0' }}>
                          {calcResult.costEstimation.breakdown.map((row: any, i: number) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex', // FIX
                                justifyContent: 'space-between', // FIX
                                alignItems: 'center', // FIX
                                padding: '6px 14px', // FIX
                                borderBottom:
                                  i < calcResult.costEstimation.breakdown.length - 1
                                    ? '1px solid #F9FAFB'
                                    : 'none', // FIX
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <span
                                  style={{
                                    fontSize: 12, // FIX
                                    color: '#374151', // FIX
                                    fontWeight: 500, // FIX
                                  }}
                                >
                                  {row.item}
                                </span>
                                <span
                                  style={{
                                    fontSize: 10, // FIX
                                    color: '#9CA3AF', // FIX
                                    marginLeft: 6, // FIX
                                  }}
                                >
                                  ({row.qty})
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: 12, // FIX
                                  fontWeight: 700, // FIX
                                  color: '#111', // FIX
                                  flexShrink: 0, // FIX
                                }}
                              >
                                Rp {(row.idr / 1e6).toFixed(1)}M
                              </span>
                            </div>
                          ))}
                        </div>

                        <div
                          style={{
                            padding: '8px 14px', // FIX
                            borderTop: '2px solid #FDE68A', // FIX
                            background: '#FFFBEB', // FIX
                          }}
                        >
                          {[
                            { label: 'Material', value: calcResult.costEstimation.totalMaterial },
                            { label: 'Instalasi', value: calcResult.costEstimation.totalInstall },
                          ].map((row, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex', // FIX
                                justifyContent: 'space-between', // FIX
                                fontSize: 12, // FIX
                                padding: '3px 0', // FIX
                                borderBottom: '1px solid #FDE68A', // FIX
                              }}
                            >
                              <span style={{ color: '#374151' }}>{row.label}</span>
                              <span style={{ fontWeight: 600, color: '#374151' }}>
                                Rp {(row.value / 1e6).toFixed(1)}M
                              </span>
                            </div>
                          ))}
                          <div
                            style={{
                              display: 'flex', // FIX
                              justifyContent: 'space-between', // FIX
                              fontSize: 13, // FIX
                              fontWeight: 800, // FIX
                              padding: '6px 0 2px', // FIX
                              color: '#92400E', // FIX
                            }}
                          >
                            <span>TOTAL</span>
                            <span>
                              Rp {calcResult.costEstimation.totalProject.toLocaleString('id-ID')}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* FIX: ROI 3-tier — cleaner layout */}
                    {calcResult?.roi?.tiers && (
                      <div
                        style={{
                          marginTop: 10, // FIX
                                borderRadius: 12, // FIX
                                overflow: 'hidden', // FIX
                                border: '1px solid #FDE68A', // FIX
                              }}
                            >
                              <div
                                style={{
                                  padding: '10px 14px', // FIX
                                  background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', // FIX
                                  borderBottom: '1px solid #FDE68A', // FIX
                                  display: 'flex', // FIX
                                  justifyContent: 'space-between', // FIX
                                  alignItems: 'center', // FIX
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 12, // FIX
                                    fontWeight: 700, // FIX
                                    color: '#92400E', // FIX
                                  }}
                                >
                                  📈 Estimasi ROI — 3 Segmen Pasar
                                </span>
                                <span style={{ fontSize: 10, color: '#B45309' }}>
                                  {calcResult.roi.totalTakeRatePct}% total take rate
                                </span>
                              </div>

                              <div
                                style={{
                                  padding: '8px 14px', // FIX
                                  background: '#FFFBEB', // FIX
                                  borderBottom: '1px solid #FDE68A', // FIX
                                  display: 'flex', // FIX
                                  alignItems: 'center', // FIX
                                  justifyContent: 'space-between', // FIX
                                  gap: 8, // FIX
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex', // FIX
                                    gap: 16, // FIX
                                    alignItems: 'center', // FIX
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Overall BEP
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 20, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      {calcResult.roi.overallBepMonths}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        bln
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      width: 1, // FIX
                                      height: 32, // FIX
                                      background: '#FDE68A', // FIX
                                    }}
                                  />
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Revenue/bulan
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 16, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      Rp {(calcResult.roi.totalMonthlyRevenue / 1e6).toFixed(1)}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        M
                                      </span>
                                    </div>
                                  </div>
                                  <div
                                    style={{
                                      width: 1, // FIX
                                      height: 32, // FIX
                                      background: '#FDE68A', // FIX
                                    }}
                                  />
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 9, // FIX
                                        color: '#B45309', // FIX
                                        textTransform: 'uppercase' as const, // FIX
                                        letterSpacing: '0.05em', // FIX
                                      }}
                                    >
                                      Active HP
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 16, // FIX
                                        fontWeight: 800, // FIX
                                        color: '#92400E', // FIX
                                        lineHeight: 1, // FIX
                                      }}
                                    >
                                      {calcResult.roi.totalActiveHomepass}
                                      <span
                                        style={{
                                          fontSize: 11, // FIX
                                          fontWeight: 400, // FIX
                                          marginLeft: 2, // FIX
                                        }}
                                      >
                                        unit
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div
                                  style={{
                                    padding: '4px 10px', // FIX
                                    borderRadius: 8, // FIX
                                    background: '#FEF3C7', // FIX
                                    fontSize: 10, // FIX
                                    color: '#92400E', // FIX
                                    fontWeight: 600, // FIX
                                    border: '1px solid #FDE68A', // FIX
                                    whiteSpace: 'nowrap' as const, // FIX
                                  }}
                                >
                                  {calcResult.roi.overallBepYears} tahun
                                </div>
                              </div>

                              <div style={{ background: 'white' }}>
                                {calcResult.roi.tiers.map((tier: any, i: number) => {
                                  const colors: Record<
                                    string,
                                    { main: string; bg: string; border: string }
                                  > = {
                                    Basic: { main: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' }, // FIX
                                    Standard: { main: '#00D4B4', bg: '#F0FDFA', border: '#99F6E4' }, // FIX
                                    Premium: { main: '#8B5CF6', bg: '#F5F3FF', border: '#DDD6FE' }, // FIX
                                  }; // FIX
                                  const c = colors[tier.name] || colors.Standard; // FIX

                                  return (
                                    <div
                                      key={tier.name}
                                      style={{
                                        padding: '10px 14px', // FIX
                                        borderBottom: i < 2 ? '1px solid #F3F4F6' : 'none', // FIX
                                        display: 'flex', // FIX
                                        gap: 10, // FIX
                                        alignItems: 'center', // FIX
                                      }}
                                    >
                                      <div
                                        style={{
                                          minWidth: 72, // FIX
                                          padding: '4px 8px', // FIX
                                          borderRadius: 8, // FIX
                                          textAlign: 'center' as const, // FIX
                                          background: c.bg, // FIX
                                          border: `1px solid ${c.border}`, // FIX
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 11, // FIX
                                            fontWeight: 700, // FIX
                                            color: c.main, // FIX
                                          }}
                                        >
                                          {tier.name}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 9, // FIX
                                            color: c.main, // FIX
                                            opacity: 0.8, // FIX
                                          }}
                                        >
                                          Rp {(tier.arpu / 1000).toFixed(0)}k/bln
                                        </div>
                                      </div>

                                      <div
                                        style={{
                                          flex: 1, // FIX
                                          display: 'grid', // FIX
                                          gridTemplateColumns: '1fr 1fr 1fr 1fr', // FIX
                                          gap: 4, // FIX
                                        }}
                                      >
                                        {[
                                          { label: 'Take Rate', value: `${tier.takeRatePct}%` }, // FIX
                                          { label: 'Active HP', value: `${tier.activeHomepass}` }, // FIX
                                          {
                                            label: 'Rev/bln', // FIX
                                            value: `Rp ${(tier.monthlyRevenue / 1e6).toFixed(1)}M`, // FIX
                                          }, // FIX
                                          { label: 'BEP', value: `${tier.breakEvenMonths} bln` }, // FIX
                                        ].map((m) => (
                                          <div key={m.label} style={{ textAlign: 'center' as const }}>
                                            <div
                                              style={{
                                                fontSize: 12, // FIX
                                                fontWeight: 700, // FIX
                                                color: c.main, // FIX
                                              }}
                                            >
                                              {m.value}
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 9, // FIX
                                                color: '#9CA3AF', // FIX
                                                marginTop: 1, // FIX
                                              }}
                                            >
                                              {m.label}
                                            </div>
                                          </div>
                                        ))}
                                      </div>

                                      <div
                                        style={{
                                          padding: '3px 7px', // FIX
                                          borderRadius: 6, // FIX
                                          background: tier.isViable ? '#F0FDF4' : '#FEF2F2', // FIX
                                          border: `1px solid ${tier.isViable ? '#BBF7D0' : '#FECACA'}`, // FIX
                                          fontSize: 9, // FIX
                                          fontWeight: 600, // FIX
                                          color: tier.isViable ? '#16A34A' : '#EF4444', // FIX
                                          flexShrink: 0, // FIX
                                          whiteSpace: 'nowrap' as const, // FIX
                                        }}
                                      >
                                        {tier.isViable ? '✅ Viable' : '⚠️ Review'}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div
                                style={{
                                  padding: '8px 14px', // FIX
                                  background: '#F0FDF4', // FIX
                                  borderTop: '1px solid #BBF7D0', // FIX
                                  display: 'flex', // FIX
                                  justifyContent: 'space-between', // FIX
                                  alignItems: 'center', // FIX
                                }}
                              >
                                <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>
                                  Total Revenue / Tahun (semua tier)
                                </span>
                                <span style={{ fontSize: 14, fontWeight: 800, color: '#16A34A' }}>
                                  Rp{' '}
                                  {((calcResult.roi.totalAnnualRevenue ?? 0) / 1e6).toFixed(0)}M
                                </span>
                              </div>
                            </div>
                          )}

                    {/* FIX: Installation sequence */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        🏗️ Urutan Instalasi — Est. {calcResult.installation.totalDuration}
                      </div>
                      {calcResult.installation.sequence.map((step) => (
                        <div
                          key={step.step}
                          style={{
                            padding: '8px 12px',
                            borderBottom:
                              step.step < calcResult.installation.sequence.length
                                ? '1px solid #F3F4F6'
                                : 'none',
                            display: 'flex',
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              background: '#00D4B415',
                              border: '1.5px solid #00D4B440',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#00D4B4',
                            }}
                          >
                            {step.step}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#111',
                                marginBottom: 3,
                              }}
                            >
                              {step.title}
                              <span
                                style={{
                                  fontSize: 10,
                                  color: '#9CA3AF',
                                  fontWeight: 400,
                                  marginLeft: 6,
                                }}
                              >
                                ⏱ {step.duration}
                              </span>
                            </div>
                            {step.tasks.map((task, ti) => (
                              <div
                                key={ti}
                                style={{
                                  fontSize: 10,
                                  color: '#6B7280',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 4,
                                  marginBottom: 2,
                                }}
                              >
                                <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
                                {task}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* FIX: Standards */}
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#EFF6FF',
                        border: '1px solid #BFDBFE',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#1D4ED8',
                          marginBottom: 5,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        📋 Standar yang Digunakan
                      </div>
                      {calcResult.topology.standards.map((s, si) => (
                        <div key={si} style={{ fontSize: 10, color: '#1E40AF', marginBottom: 2 }}>
                          • {s}
                        </div>
                      ))}
                    </div>

                    {/* FIX: Enhanced recommendations — structured */}
                    <div
                      style={{
                        background: '#F9FAFB',
                        borderRadius: 10,
                        border: '1px solid #E5E7EB',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 14px',
                          borderBottom: '1px solid #E5E7EB',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        💡 Rekomendasi Detail
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          padding: 10,
                        }}
                      >
                        {calcResult.recommendations.map((r, i) => {
                          const colors = {
                            success: { bg: '#F0FDF4', border: '#BBF7D0', titleColor: '#16A34A' },
                            warning: { bg: '#FFFBEB', border: '#FDE68A', titleColor: '#92400E' },
                            error: { bg: '#FEF2F2', border: '#FECACA', titleColor: '#DC2626' },
                            info: { bg: '#EFF6FF', border: '#BFDBFE', titleColor: '#1D4ED8' },
                          }; // FIX
                          const c = colors[r.severity] || colors.info; // FIX
                          return (
                            <div
                              key={i}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: c.bg,
                                border: `1px solid ${c.border}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  color: c.titleColor,
                                  marginBottom: 4,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <span>{r.icon}</span>
                                <span>{r.title}</span>
                              </div>
                              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6 }}>
                                {r.detail}
                              </div>
                            </div>
                          ); // FIX
                        })}
                      </div>
                    </div>

                    {/* FIX: Reset */}
                    <button
                      type="button"
                      onClick={() => {
                        clearTopology(); // FIX: remove topology layers
                        clearCalcGraphics();
                        setCalcMode('idle');
                        setCalcResult(null);
                        setBackbonePoint(null);
                        setTargetPoint(null);
                        setNearestBackbone(null);
                      }}
                      style={{
                        width: '100%',
                        padding: '9px',
                        borderRadius: 8,
                        border: '1px solid #E5E7EB',
                        background: 'white',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#6B7280',
                      }}
                    >
                      🔄 Hitung Ulang
                    </button>
                  </div>
                )}
              </div>  );
}
