'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { toast } from 'sonner';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../lib/api';

type TowerStatus = 'EXISTING' | 'ON_PROGRESS' | 'PLANNING';
type AreaMethod = 'RADIUS' | 'POLYGON';
type MapMode = 'idle' | 'center' | 'polygon' | 'tower';
type LngLat = [number, number];

type Tower = {
  id: string;
  name: string;
  code: string | null;
  latitude: number;
  longitude: number;
  status: TowerStatus;
  notes: string | null;
};

type FtttRoute = {
  routeId: string;
  routeName: string;
  routeType: string;
  color: string;
  crossesWater: boolean;
  coordinates: LngLat[];
  labelAt: LngLat;
  distanceM: number;
  foCableM: number;
  manholeCount: number;
  manholes: LngLat[];
  handholeCount: number;
  handholes: LngLat[];
  poleCount: number;
  poles: LngLat[];
  spliceCount: number;
  supportingWork: string[];
  estimatedCostIdr: number;
  advantages: string[];
  considerations: string[];
};

type CalcResponse = {
  startTower: { id: string; name: string; status: TowerStatus };
  destinationTower: { id: string; name: string; status: TowerStatus };
  existingReferences: Array<{ id: string; name: string; distanceToDestinationM: number; distanceToStartM: number }>;
  routes: FtttRoute[];
  decisionSupport: string;
  classificationNote: string;
  waterAssessment: { dataAvailable: boolean; note: string; setbackMeters: number | null };
  parameterNote: string;
};

const STATUS_META: Record<TowerStatus, { label: string; color: string }> = {
  EXISTING: { label: 'Existing', color: '#2563EB' },
  ON_PROGRESS: { label: 'On Progress', color: '#DC2626' },
  PLANNING: { label: 'Planning', color: '#16A34A' },
};

const ROUTE_TYPE_LABEL: Record<string, string> = {
  MAIN_ROAD: 'Main Road',
  LOCAL_ROAD: 'Local Road',
  ALTERNATIVE: 'Alternative Route',
  ALTERNATIVE_CROSSING: 'Alternative Crossing',
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PARAMS_KEY = 'permatrax-gis-fttt-params';

const BASEMAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
    satellite: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
    },
  },
  layers: [
    { id: 'basemap-osm', type: 'raster' as const, source: 'osm', layout: { visibility: 'visible' as const } },
    { id: 'basemap-satellite', type: 'raster' as const, source: 'satellite', layout: { visibility: 'none' as const } },
  ],
};

function haversine(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointInPolygon(point: LngLat, ring: LngLat[]): boolean {
  if (ring.length < 3) return false;
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function circleRing(center: LngLat, radiusM: number): LngLat[] {
  const lat = (center[1] * Math.PI) / 180;
  const mx = 111320 * Math.cos(lat);
  const my = 110540;
  const ring: LngLat[] = [];
  for (let i = 0; i <= 64; i++) {
    const ang = (i / 64) * Math.PI * 2;
    ring.push([center[0] + (Math.cos(ang) * radiusM) / mx, center[1] + (Math.sin(ang) * radiusM) / my]);
  }
  return ring;
}

function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function formatIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

function num(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function FtttGisClient() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<MapMode>('idle');
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const labelMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState<'osm' | 'satellite'>('osm');
  const [mode, setMode] = useState<MapMode>('idle');
  const [towers, setTowers] = useState<Tower[]>([]);
  const [areaMethod, setAreaMethod] = useState<AreaMethod>('RADIUS');
  const [radiusText, setRadiusText] = useState('');
  const [center, setCenter] = useState<LngLat | null>(null);
  const [polygon, setPolygon] = useState<LngLat[]>([]);
  const [poleSpacing, setPoleSpacing] = useState('');
  const [slack, setSlack] = useState('');
  const [manholeSpacing, setManholeSpacing] = useState('');
  const [handholeSpacing, setHandholeSpacing] = useState('');
  const [splicesPerManhole, setSplicesPerManhole] = useState('');
  const [splicesPerTower, setSplicesPerTower] = useState('');
  const [costCable, setCostCable] = useState('');
  const [costManhole, setCostManhole] = useState('');
  const [costHandhole, setCostHandhole] = useState('');
  const [costSplice, setCostSplice] = useState('');
  const [costPole, setCostPole] = useState('');
  const [waterSurcharge, setWaterSurcharge] = useState('');
  const [waterSetback, setWaterSetback] = useState('');
  const [startId, setStartId] = useState('');
  const [destId, setDestId] = useState('');
  const [draftPoint, setDraftPoint] = useState<LngLat | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCode, setDraftCode] = useState('');
  const [draftStatus, setDraftStatus] = useState<TowerStatus>('PLANNING');
  const [draftNotes, setDraftNotes] = useState('');
  const [savingTower, setSavingTower] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      if (saved.radiusText) setRadiusText(saved.radiusText);
      if (saved.poleSpacing) setPoleSpacing(saved.poleSpacing);
      if (saved.slack) setSlack(saved.slack);
      if (saved.manholeSpacing) setManholeSpacing(saved.manholeSpacing);
      if (saved.handholeSpacing) setHandholeSpacing(saved.handholeSpacing);
      if (saved.splicesPerManhole) setSplicesPerManhole(saved.splicesPerManhole);
      if (saved.splicesPerTower) setSplicesPerTower(saved.splicesPerTower);
      if (saved.costCable) setCostCable(saved.costCable);
      if (saved.costManhole) setCostManhole(saved.costManhole);
      if (saved.costHandhole) setCostHandhole(saved.costHandhole);
      if (saved.costSplice) setCostSplice(saved.costSplice);
      if (saved.costPole) setCostPole(saved.costPole);
      if (saved.waterSurcharge) setWaterSurcharge(saved.waterSurcharge);
      if (saved.waterSetback) setWaterSetback(saved.waterSetback);
    } catch {
      /* ignore broken local draft */
    }
  }, []);

  const loadTowers = useCallback(async () => {
    const rows = await apiGet<Tower[]>('/map/fttt/towers');
    setTowers(rows);
  }, []);

  useEffect(() => {
    void loadTowers().catch((err: Error) => toast.error(err.message || 'Gagal memuat tower'));
  }, [loadTowers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [106.8456, -6.2088],
      zoom: 11,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('fttt-area', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({ id: 'fttt-area-fill', type: 'fill', source: 'fttt-area', paint: { 'fill-color': '#2563EB', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'fttt-area-line', type: 'line', source: 'fttt-area', paint: { 'line-color': '#1D4ED8', 'line-width': 2, 'line-dasharray': [1.2, 1.2] } });
      map.addSource('fttt-routes', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'fttt-route-casing',
        type: 'line',
        source: 'fttt-routes',
        filter: ['==', ['get', 'active'], true],
        paint: { 'line-color': '#111827', 'line-width': 10, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'fttt-route-line',
        type: 'line',
        source: 'fttt-routes',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['==', ['get', 'active'], true], 6, 4],
          'line-opacity': ['case', ['==', ['get', 'dimmed'], true], 0.28, 0.95],
        },
      });
      map.addSource('fttt-infra', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'fttt-infra',
        type: 'circle',
        source: 'fttt-infra',
        paint: {
          'circle-radius': 4,
          'circle-color': ['match', ['get', 'kind'], 'pole', '#6B7280', 'manhole', '#7C3AED', 'handhole', '#0891B2', '#6B7280'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', 'fttt-route-line', (event) => {
        if (modeRef.current !== 'idle') return;
        const routeId = event.features?.[0]?.properties?.routeId;
        if (typeof routeId === 'string') setActiveRouteId(routeId);
      });
      map.on('mouseenter', 'fttt-route-line', () => {
        if (modeRef.current === 'idle') map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'fttt-route-line', () => {
        map.getCanvas().style.cursor = '';
      });
      setMapReady(true);
    });
    map.on('click', (event) => {
      const ll: LngLat = [event.lngLat.lng, event.lngLat.lat];
      const current = modeRef.current;
      if (current === 'center') {
        setCenter(ll);
        setMode('idle');
        return;
      }
      if (current === 'polygon') {
        setPolygon((prev) => [...prev, ll]);
        return;
      }
      if (current === 'tower') {
        setDraftPoint(ll);
        setMode('idle');
      }
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      labelMarkersRef.current.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.setLayoutProperty('basemap-osm', 'visibility', basemap === 'osm' ? 'visible' : 'none');
    map.setLayoutProperty('basemap-satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  }, [basemap, mapReady]);

  const radiusM = num(radiusText);
  const areaRing = useMemo(() => {
    if (areaMethod === 'RADIUS' && center && radiusM && radiusM > 0) return circleRing(center, radiusM);
    if (areaMethod === 'POLYGON' && polygon.length >= 3) return [...polygon, polygon[0]];
    return null;
  }, [areaMethod, center, radiusM, polygon]);

  const towerInArea = useCallback(
    (tower: Tower) => {
      const point: LngLat = [tower.longitude, tower.latitude];
      if (areaMethod === 'RADIUS') {
        if (!center || !radiusM || radiusM <= 0) return false;
        return haversine(point, center) <= radiusM + 0.5;
      }
      if (polygon.length < 3) return false;
      return pointInPolygon(point, polygon);
    },
    [areaMethod, center, radiusM, polygon],
  );

  const selectable = useMemo(() => towers.filter(towerInArea), [towers, towerInArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource('fttt-area') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!areaRing) {
      source.setData(EMPTY_FC);
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [areaRing] },
        },
      ],
    });
  }, [areaRing, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const active = activeRouteId;
    const routes = result?.routes ?? [];
    const routeSource = map.getSource('fttt-routes') as maplibregl.GeoJSONSource | undefined;
    const infraSource = map.getSource('fttt-infra') as maplibregl.GeoJSONSource | undefined;
    if (!routeSource || !infraSource) return;
    routeSource.setData({
      type: 'FeatureCollection',
      features: routes.map((route) => ({
        type: 'Feature',
        properties: {
          routeId: route.routeId,
          color: active && route.routeId !== active ? '#9CA3AF' : route.color,
          active: route.routeId === active,
          dimmed: Boolean(active && route.routeId !== active),
        },
        geometry: { type: 'LineString', coordinates: route.coordinates },
      })),
    });
    labelMarkersRef.current.forEach((marker) => marker.remove());
    labelMarkersRef.current = routes.map((route) => {
      const el = document.createElement('div');
      el.textContent = route.routeId;
      el.style.background = route.routeId === active ? route.color : active ? '#9CA3AF' : route.color;
      el.style.color = '#111827';
      el.style.fontWeight = '800';
      el.style.fontSize = '12px';
      el.style.padding = '2px 6px';
      el.style.borderRadius = '6px';
      el.style.border = '1px solid white';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.25)';
      return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(route.labelAt).addTo(map);
    });
    const selected = routes.find((route) => route.routeId === active);
    const infra: GeoJSON.Feature[] = [];
    if (selected) {
      selected.poles.forEach((coord) => infra.push({ type: 'Feature', properties: { kind: 'pole' }, geometry: { type: 'Point', coordinates: coord } }));
      selected.manholes.forEach((coord) => infra.push({ type: 'Feature', properties: { kind: 'manhole' }, geometry: { type: 'Point', coordinates: coord } }));
      selected.handholes.forEach((coord) => infra.push({ type: 'Feature', properties: { kind: 'handhole' }, geometry: { type: 'Point', coordinates: coord } }));
    }
    infraSource.setData({ type: 'FeatureCollection', features: infra });
  }, [result, activeRouteId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = towers.map((tower) => {
      const meta = STATUS_META[tower.status];
      const el = document.createElement('div');
      el.style.width = '18px';
      el.style.height = '18px';
      el.style.borderRadius = '50%';
      el.style.background = meta.color;
      el.style.border = tower.id === startId || tower.id === destId ? '3px solid #111827' : '2px solid white';
      el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
      el.title = `${tower.name} · ${meta.label}`;
      const marker = new maplibregl.Marker({ element: el }).setLngLat([tower.longitude, tower.latitude]).addTo(map);
      return marker;
    });
  }, [towers, mapReady, startId, destId]);

  function rememberParams() {
    const payload = {
      radiusText, poleSpacing, slack, manholeSpacing, handholeSpacing,
      splicesPerManhole, splicesPerTower, costCable, costManhole, costHandhole,
      costSplice, costPole, waterSurcharge, waterSetback,
    };
    localStorage.setItem(PARAMS_KEY, JSON.stringify(payload));
  }

  function fillExampleParams() {
    setPoleSpacing('50');
    setSlack('0.05');
    setManholeSpacing('200');
    setHandholeSpacing('100');
    setSplicesPerManhole('1');
    setSplicesPerTower('2');
    setCostCable('15000');
    setCostManhole('2500000');
    setCostHandhole('750000');
    setCostSplice('150000');
    setCostPole('350000');
    toast.message('Contoh parameter diisi. Angka ini bukan standar harga JIP — ubah sesuai project.');
  }

  async function saveTower() {
    if (!draftPoint || !draftName.trim()) {
      toast.error('Isi nama tower dan klik peta untuk menentukan koordinat.');
      return;
    }
    setSavingTower(true);
    try {
      await apiPost('/map/fttt/towers', {
        name: draftName.trim(),
        code: draftCode.trim() || undefined,
        latitude: draftPoint[1],
        longitude: draftPoint[0],
        status: draftStatus,
        notes: draftNotes.trim() || undefined,
      });
      setDraftName('');
      setDraftCode('');
      setDraftNotes('');
      setDraftPoint(null);
      await loadTowers();
      toast.success('Tower disimpan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan tower');
    } finally {
      setSavingTower(false);
    }
  }

  async function changeStatus(tower: Tower, status: TowerStatus) {
    try {
      await apiPatch(`/map/fttt/towers/${tower.id}`, { status });
      setTowers((prev) => prev.map((row) => (row.id === tower.id ? { ...row, status } : row)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status');
    }
  }

  async function removeTower(tower: Tower) {
    if (!window.confirm(`Hapus tower ${tower.name}?`)) return;
    try {
      await apiDelete(`/map/fttt/towers/${tower.id}`);
      if (startId === tower.id) setStartId('');
      if (destId === tower.id) setDestId('');
      setTowers((prev) => prev.filter((row) => row.id !== tower.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus tower');
    }
  }

  async function runSearch() {
    if (!search.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`);
      const rows = (await res.json()) as Array<{ lon: string; lat: string }>;
      if (!rows[0] || !mapRef.current) {
        toast.error('Lokasi tidak ditemukan.');
        return;
      }
      mapRef.current.flyTo({ center: [Number(rows[0].lon), Number(rows[0].lat)], zoom: 14 });
    } catch {
      toast.error('Pencarian lokasi gagal.');
    }
  }

  async function calculate() {
    const pole = num(poleSpacing);
    const slackRatio = num(slack);
    const manhole = num(manholeSpacing);
    const handhole = num(handholeSpacing);
    const spliceManhole = num(splicesPerManhole);
    const spliceTower = num(splicesPerTower);
    const cable = num(costCable);
    const manholeCost = num(costManhole);
    const handholeCost = num(costHandhole);
    const spliceCost = num(costSplice);
    const poleCost = num(costPole);
    if (!startId || !destId || startId === destId) {
      toast.error('Pilih starting tower dan destination tower yang berbeda.');
      return;
    }
    if (areaMethod === 'RADIUS' && (!center || !radiusM || radiusM <= 0)) {
      toast.error('Isi radius (meter) dan tentukan pusat area. Radius tidak diisi otomatis.');
      return;
    }
    if (areaMethod === 'POLYGON' && polygon.length < 3) {
      toast.error('Gambar polygon minimal 3 titik.');
      return;
    }
    if (
      pole == null || slackRatio == null || manhole == null || handhole == null ||
      spliceManhole == null || spliceTower == null || cable == null || manholeCost == null ||
      handholeCost == null || spliceCost == null || poleCost == null
    ) {
      toast.error('Lengkapi parameter planning. Harga boleh 0, tetapi kolomnya harus diisi.');
      return;
    }
    rememberParams();
    setCalculating(true);
    setActiveRouteId(null);
    try {
      const rates: Record<string, number> = {
        poleSpacingMeters: pole,
        cableSlackRatio: slackRatio,
        manholeSpacingMeters: manhole,
        handholeSpacingMeters: handhole,
        splicesPerManhole: spliceManhole,
        splicesPerTowerEnd: spliceTower,
        costPerMeterCableIdr: cable,
        costPerManholeIdr: manholeCost,
        costPerHandholeIdr: handholeCost,
        costPerSpliceIdr: spliceCost,
        costPerPoleIdr: poleCost,
      };
      const surcharge = num(waterSurcharge);
      const setback = num(waterSetback);
      if (surcharge != null && surcharge > 0) rates.waterCrossingSurchargeIdr = surcharge;
      if (setback != null && setback > 0) rates.waterSetbackMeters = setback;
      const body: Record<string, unknown> = {
        areaMethod,
        startTowerId: startId,
        destTowerId: destId,
        rates,
      };
      if (areaMethod === 'RADIUS') {
        body.radiusMeters = radiusM;
        body.centerLat = center![1];
        body.centerLon = center![0];
      } else {
        body.polygon = polygon;
      }
      const data = await apiPost<CalcResponse>('/map/fttt/calculate', body);
      setResult(data);
      const map = mapRef.current;
      if (map && data.routes[0]) {
        const bounds = new maplibregl.LngLatBounds();
        data.routes.forEach((route) => route.coordinates.forEach((coord) => bounds.extend(coord)));
        if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
      }
      if (data.routes.length < 3) {
        toast.message(`${data.routes.length} jalur feasible. Sistem tidak memaksakan 3 alternatif bila datanya tidak ada.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kalkulasi gagal');
    } finally {
      setCalculating(false);
    }
  }

  const activeRoute = result?.routes.find((route) => route.routeId === activeRouteId) ?? null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#F8FAFC', color: '#0F172A' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'white', borderBottom: '1px solid #E2E8F0' }}>
        <Link href="/home" style={{ color: '#0F766E', fontWeight: 700, textDecoration: 'none' }}>← Menu</Link>
        <div>
          <div style={{ fontWeight: 800 }}>GIS FTTT</div>
          <div style={{ fontSize: 12, color: '#64748B' }}>Perencanaan Tower-to-Tower. Peta GIS FTTH tidak diubah.</div>
        </div>
        <Link href="/map" style={{ marginLeft: 'auto', fontSize: 13, color: '#334155' }}>Buka Peta GIS FTTH</Link>
      </header>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside style={{ width: 380, overflow: 'auto', background: 'white', borderRight: '1px solid #E2E8F0', padding: 14 }}>
          <Section title="1. Area kalkulasi">
            <div style={{ display: 'flex', gap: 6 }}>
              {(['RADIUS', 'POLYGON'] as const).map((method) => (
                <button key={method} type="button" onClick={() => { setAreaMethod(method); setResult(null); setActiveRouteId(null); }} style={chip(areaMethod === method)}>
                  {method === 'RADIUS' ? 'Radius' : 'Polygon'}
                </button>
              ))}
            </div>
            {areaMethod === 'RADIUS' ? (
              <>
                <label style={labelStyle}>Radius (meter)</label>
                <input value={radiusText} onChange={(e) => setRadiusText(e.target.value)} placeholder="Contoh 1000 — isi sendiri" inputMode="decimal" style={inputStyle} />
                <p style={hint}>Nilai radius tidak dikunci di 500 m. Isi sesuai jarak antar tower pada project ini.</p>
                <button type="button" onClick={() => setMode('center')} style={chip(mode === 'center')}>
                  {center ? 'Ubah pusat radius' : 'Klik peta untuk pusat radius'}
                </button>
                {center && <p style={hint}>Pusat: {center[1].toFixed(5)}, {center[0].toFixed(5)}</p>}
              </>
            ) : (
              <>
                <button type="button" onClick={() => setMode('polygon')} style={chip(mode === 'polygon')}>
                  {mode === 'polygon' ? 'Klik peta untuk menambah titik' : 'Gambar polygon'}
                </button>
                <button type="button" onClick={() => { setPolygon([]); setMode('idle'); }} style={ghostBtn}>Reset polygon ({polygon.length} titik)</button>
              </>
            )}
          </Section>

          <Section title="2. Parameter planning">
            <p style={hint}>Semua angka di bawah adalah input project. Sistem tidak memakai tarif atau jarak tiang tetap.</p>
            <button type="button" onClick={fillExampleParams} style={ghostBtn}>Isi contoh angka (bukan standar JIP)</button>
            <Field label="Jarak tiang (m)" value={poleSpacing} onChange={setPoleSpacing} placeholder="50" />
            <Field label="Slack kabel (rasio, 0.05 = 5%)" value={slack} onChange={setSlack} placeholder="0.05" />
            <Field label="Jarak manhole (m)" value={manholeSpacing} onChange={setManholeSpacing} placeholder="200" />
            <Field label="Jarak handhole (m)" value={handholeSpacing} onChange={setHandholeSpacing} placeholder="100" />
            <Field label="Splicing per manhole" value={splicesPerManhole} onChange={setSplicesPerManhole} placeholder="1" />
            <Field label="Splicing per ujung tower" value={splicesPerTower} onChange={setSplicesPerTower} placeholder="2" />
            <Field label="Harga kabel / meter (IDR)" value={costCable} onChange={setCostCable} placeholder="0" />
            <Field label="Harga manhole (IDR)" value={costManhole} onChange={setCostManhole} placeholder="0" />
            <Field label="Harga handhole (IDR)" value={costHandhole} onChange={setCostHandhole} placeholder="0" />
            <Field label="Harga splicing (IDR)" value={costSplice} onChange={setCostSplice} placeholder="0" />
            <Field label="Harga tiang (IDR)" value={costPole} onChange={setCostPole} placeholder="0" />
            <Field label="Setback badan air (m, kosongkan bila belum ada standar)" value={waterSetback} onChange={setWaterSetback} placeholder="kosong" />
            <Field label="Surcharge water crossing (IDR, opsional)" value={waterSurcharge} onChange={setWaterSurcharge} placeholder="kosong" />
          </Section>

          <Section title="3. Tower">
            <div style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 8 }}>
              {(Object.keys(STATUS_META) as TowerStatus[]).map((status) => (
                <span key={status}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: STATUS_META[status].color, marginRight: 4 }} />{STATUS_META[status].label}</span>
              ))}
            </div>
            <button type="button" onClick={() => setMode('tower')} style={chip(mode === 'tower')}>Tambah tower — klik peta</button>
            {draftPoint && (
              <div style={{ marginTop: 8, padding: 8, background: '#F8FAFC', borderRadius: 8 }}>
                <p style={hint}>{draftPoint[1].toFixed(5)}, {draftPoint[0].toFixed(5)}</p>
                <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Nama tower" style={inputStyle} />
                <input value={draftCode} onChange={(e) => setDraftCode(e.target.value)} placeholder="Kode (opsional)" style={inputStyle} />
                <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as TowerStatus)} style={inputStyle}>
                  {(Object.keys(STATUS_META) as TowerStatus[]).map((status) => (
                    <option key={status} value={status}>{STATUS_META[status].label}</option>
                  ))}
                </select>
                <input value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Catatan" style={inputStyle} />
                <button type="button" disabled={savingTower} onClick={() => void saveTower()} style={primaryBtn}>{savingTower ? 'Menyimpan…' : 'Simpan tower'}</button>
              </div>
            )}
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {towers.map((tower) => (
                <div key={tower.id} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: 8, opacity: areaRing && !towerInArea(tower) ? 0.45 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <button type="button" onClick={() => mapRef.current?.flyTo({ center: [tower.longitude, tower.latitude], zoom: 15 })} style={{ background: 'none', border: 'none', padding: 0, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                      <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: STATUS_META[tower.status].color, marginRight: 6 }} />
                      {tower.name}{tower.code ? ` · ${tower.code}` : ''}
                    </button>
                    <button type="button" onClick={() => void removeTower(tower)} style={{ border: 'none', background: 'none', color: '#B91C1C', cursor: 'pointer' }}>Hapus</button>
                  </div>
                  <select value={tower.status} onChange={(e) => void changeStatus(tower, e.target.value as TowerStatus)} style={{ ...inputStyle, marginTop: 6 }}>
                    {(Object.keys(STATUS_META) as TowerStatus[]).map((status) => (
                      <option key={status} value={status}>{STATUS_META[status].label}</option>
                    ))}
                  </select>
                </div>
              ))}
              {towers.length === 0 && <p style={hint}>Belum ada tower. Tambah minimal dua titik: existing sebagai referensi, dan planning sebagai tujuan.</p>}
            </div>
          </Section>

          <Section title="4. Koneksi tower">
            <label style={labelStyle}>Starting tower</label>
            <select value={startId} onChange={(e) => { setStartId(e.target.value); setResult(null); setActiveRouteId(null); }} style={inputStyle}>
              <option value="">Pilih</option>
              {selectable.map((tower) => <option key={tower.id} value={tower.id}>{tower.name} · {STATUS_META[tower.status].label}</option>)}
            </select>
            <label style={labelStyle}>Destination tower</label>
            <select value={destId} onChange={(e) => { setDestId(e.target.value); setResult(null); setActiveRouteId(null); }} style={inputStyle}>
              <option value="">Pilih</option>
              {selectable.map((tower) => <option key={tower.id} value={tower.id}>{tower.name} · {STATUS_META[tower.status].label}</option>)}
            </select>
            <p style={hint}>Hanya tower di dalam area yang bisa dipilih. Tower existing lain di area yang sama dipakai sebagai referensi pada hasil, bukan sebagai jalur otomatis.</p>
            <button type="button" disabled={calculating} onClick={() => void calculate()} style={primaryBtn}>
              {calculating ? 'Menghitung jalur…' : 'Jalankan kalkulasi'}
            </button>
          </Section>

          {result && (
            <Section title="5. Perbandingan jalur">
              <p style={hint}>{result.decisionSupport}</p>
              <p style={hint}>{result.classificationNote}</p>
              <p style={hint}>{result.waterAssessment.note}</p>
              <p style={hint}>{result.parameterNote}</p>
              {result.existingReferences.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 12 }}>Referensi infrastruktur existing</strong>
                  {result.existingReferences.map((ref) => (
                    <p key={ref.id} style={hint}>{ref.name}: {formatMeters(ref.distanceToDestinationM)} ke tujuan, {formatMeters(ref.distanceToStartM)} ke start</p>
                  ))}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>{['Jalur', 'Jarak', 'FO', 'MH', 'HH', 'Splice', 'Tiang', 'Biaya'].map((head) => <th key={head} style={th}>{head}</th>)}</tr>
                </thead>
                <tbody>
                  {result.routes.map((route) => (
                    <tr key={route.routeId} onClick={() => setActiveRouteId(route.routeId)} style={{ cursor: 'pointer', background: route.routeId === activeRouteId ? '#FEF3C7' : 'transparent' }}>
                      <td style={td}><b style={{ color: route.color }}>{route.routeId}</b><div>{ROUTE_TYPE_LABEL[route.routeType] ?? route.routeType}</div></td>
                      <td style={td}>{formatMeters(route.distanceM)}</td>
                      <td style={td}>{formatMeters(route.foCableM)}</td>
                      <td style={td}>{route.manholeCount}</td>
                      <td style={td}>{route.handholeCount}</td>
                      <td style={td}>{route.spliceCount}</td>
                      <td style={td}>{route.poleCount}</td>
                      <td style={td}>{formatIdr(route.estimatedCostIdr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </aside>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 2, display: 'flex', gap: 8 }}>
            <div style={{ background: 'white', borderRadius: 10, display: 'flex', padding: 4, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
              <button type="button" onClick={() => setBasemap('osm')} style={chip(basemap === 'osm')}>Peta</button>
              <button type="button" onClick={() => setBasemap('satellite')} style={chip(basemap === 'satellite')}>Satelit</button>
            </div>
            <form
              onSubmit={(event) => { event.preventDefault(); void runSearch(); }}
              style={{ background: 'white', borderRadius: 10, display: 'flex', boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}
            >
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari lokasi" style={{ border: 'none', padding: '8px 10px', borderRadius: 10, outline: 'none', width: 180 }} />
            </form>
          </div>
          {mode !== 'idle' && (
            <div style={{ position: 'absolute', top: 64, left: 12, zIndex: 2, background: '#111827', color: 'white', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
              {mode === 'center' && 'Klik peta untuk pusat radius'}
              {mode === 'polygon' && 'Klik peta untuk titik polygon. Minimal 3 titik.'}
              {mode === 'tower' && 'Klik peta untuk koordinat tower baru'}
            </div>
          )}
          {activeRoute && (
            <aside style={{ position: 'absolute', top: 12, right: 52, bottom: 12, width: 320, overflow: 'auto', background: 'white', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.16)', zIndex: 2, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>{activeRoute.routeName}</h2>
                <button type="button" onClick={() => setActiveRouteId(null)} style={ghostBtn}>Tutup</button>
              </div>
              <Detail label="Route ID" value={activeRoute.routeId} />
              <Detail label="Route type" value={ROUTE_TYPE_LABEL[activeRoute.routeType] ?? activeRoute.routeType} />
              <Detail label="Estimated distance" value={formatMeters(activeRoute.distanceM)} />
              <Detail label="Estimated FO cable" value={formatMeters(activeRoute.foCableM)} />
              <Detail label="Manhole" value={`${activeRoute.manholeCount} titik`} />
              <Detail label="Handhole" value={`${activeRoute.handholeCount} titik`} />
              <Detail label="Splicing" value={`${activeRoute.spliceCount} sambungan`} />
              <Detail label="Tiang" value={`${activeRoute.poleCount} titik`} />
              <Detail label="Estimated construction cost" value={formatIdr(activeRoute.estimatedCostIdr)} />
              <h3 style={subhead}>Supporting work</h3>
              {activeRoute.supportingWork.map((line) => <p key={line} style={hint}>{line}</p>)}
              <h3 style={subhead}>Keunggulan</h3>
              {activeRoute.advantages.map((line) => <p key={line} style={hint}>{line}</p>)}
              <h3 style={subhead}>Pertimbangan</h3>
              {activeRoute.considerations.map((line) => <p key={line} style={hint}>{line}</p>)}
              <p style={hint}>Lokasi tiang, manhole, dan handhole jalur aktif ditampilkan di peta tanpa label biaya di atas garis.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 13, margin: '0 0 8px' }}>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <>
      <label style={labelStyle}>{label}</label>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} inputMode="decimal" style={inputStyle} />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: '#64748B' }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const labelStyle: CSSProperties = { display: 'block', fontSize: 11, color: '#475569', marginTop: 8 };
const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: '1px solid #CBD5E1' };
const hint: CSSProperties = { fontSize: 12, color: '#64748B', lineHeight: 1.45, margin: '6px 0' };
const subhead: CSSProperties = { fontSize: 13, margin: '12px 0 4px' };
const th: CSSProperties = { textAlign: 'left', fontSize: 10, color: '#64748B', padding: '4px 2px', borderBottom: '1px solid #E2E8F0' };
const td: CSSProperties = { padding: '6px 2px', verticalAlign: 'top', borderBottom: '1px solid #F1F5F9' };
const primaryBtn: CSSProperties = { marginTop: 10, width: '100%', background: '#0F766E', color: 'white', border: 'none', borderRadius: 8, padding: '10px 12px', fontWeight: 700, cursor: 'pointer' };
const ghostBtn: CSSProperties = { marginTop: 6, background: 'white', border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', fontSize: 12 };

function chip(active: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 8,
    padding: '7px 10px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: 12,
    background: active ? '#0F766E' : '#F1F5F9',
    color: active ? 'white' : '#0F172A',
  };
}
