/**
 * Pure planning math for GIS FTTT.
 * Quantities and cost use only the parameters the caller supplies.
 * Nothing here treats 500 m as a fixed radius, pole spacing, or buffer.
 */

export type LngLat = [number, number];

export type FtttAreaMethod = 'RADIUS' | 'POLYGON';

export type FtttRoadKind = 'MAIN_ROAD' | 'LOCAL_ROAD';

export type FtttRouteType = 'MAIN_ROAD' | 'LOCAL_ROAD' | 'ALTERNATIVE' | 'ALTERNATIVE_CROSSING';

export type FtttPlanningRates = {
  poleSpacingMeters: number;
  cableSlackRatio: number;
  manholeSpacingMeters: number;
  handholeSpacingMeters: number;
  splicesPerManhole: number;
  splicesPerTowerEnd: number;
  costPerMeterCableIdr: number;
  costPerManholeIdr: number;
  costPerHandholeIdr: number;
  costPerSpliceIdr: number;
  costPerPoleIdr: number;
  /** Applied only when the route actually intersects mapped water and the user set a surcharge. */
  waterCrossingSurchargeIdr?: number;
  /** User-entered setback. Omitted means no buffer is applied. */
  waterSetbackMeters?: number;
};

export type RouteStep = {
  name?: string;
  ref?: string;
  distance?: number;
};

export type RouteCandidate = {
  coordinates: LngLat[];
  steps: RouteStep[];
  profile: 'driving' | 'foot';
  kind: FtttRoadKind;
  crossesWater: boolean;
};

export type RouteEstimate = {
  distanceM: number;
  foCableM: number;
  manholes: LngLat[];
  handholes: LngLat[];
  poles: LngLat[];
  spliceCount: number;
  supportingWork: string[];
  costIdr: number;
  costBreakdown: {
    cableIdr: number;
    manholeIdr: number;
    handholeIdr: number;
    spliceIdr: number;
    poleIdr: number;
    waterSurchargeIdr: number;
  };
  advantages: string[];
  considerations: string[];
};

const ROUTE_LABELS = ['R1', 'R2', 'R3'] as const;
const ROUTE_COLORS = ['#F5C518', '#F97316', '#EC4899'] as const;

export const FTTT_ROUTE_STYLES = ROUTE_LABELS.map((id, index) => ({
  id,
  color: ROUTE_COLORS[index],
}));

const TECHNICAL_RADIUS_MAX_M = 50_000;
const TECHNICAL_SPACING_MAX_M = 2_000;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polylineLengthMeters(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i]);
  return total;
}

/** Points strictly between the endpoints, every `spacingM` along the line. */
export function pointsAlongLine(coords: LngLat[], spacingM: number): LngLat[] {
  if (!Number.isFinite(spacingM) || spacingM <= 0 || coords.length < 2) return [];
  const total = polylineLengthMeters(coords);
  if (total < spacingM) return [];
  const out: LngLat[] = [];
  let walked = 0;
  let nextAt = spacingM;
  const endGuard = Math.min(spacingM * 0.4, 15);
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (seg <= 0) continue;
    while (nextAt <= walked + seg + 1e-6) {
      const t = (nextAt - walked) / seg;
      const lng = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t;
      if (total - nextAt >= endGuard) out.push([lng, lat]);
      nextAt += spacingM;
      if (out.length > 20_000) return out;
    }
    walked += seg;
  }
  return out;
}

export function pointInRadius(point: LngLat, center: LngLat, radiusM: number): boolean {
  return haversineMeters(point, center) <= radiusM + 0.5;
}

export function pointInPolygon(point: LngLat, ring: LngLat[]): boolean {
  if (ring.length < 3) return false;
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateFtttArea(input: {
  areaMethod: FtttAreaMethod;
  radiusMeters?: number;
  center?: LngLat;
  polygon?: LngLat[];
  start: LngLat;
  dest: LngLat;
}): string | null {
  if (haversineMeters(input.start, input.dest) < 15) {
    return 'Starting tower dan destination tower terlalu dekat (minimal 15 m).';
  }
  if (input.areaMethod === 'RADIUS') {
    if (!finiteNumber(input.radiusMeters) || input.radiusMeters <= 0) {
      return 'Isi nilai radius dalam meter sebelum kalkulasi. Radius tidak memakai nilai tetap.';
    }
    if (input.radiusMeters > TECHNICAL_RADIUS_MAX_M) {
      return `Radius maksimal ${TECHNICAL_RADIUS_MAX_M} m untuk batas teknis permintaan ini.`;
    }
    if (!input.center || !finiteNumber(input.center[0]) || !finiteNumber(input.center[1])) {
      return 'Tentukan pusat area radius di peta.';
    }
    if (!pointInRadius(input.start, input.center, input.radiusMeters)) {
      return 'Starting tower berada di luar radius area.';
    }
    if (!pointInRadius(input.dest, input.center, input.radiusMeters)) {
      return 'Destination tower berada di luar radius area.';
    }
    return null;
  }
  const ring = input.polygon ?? [];
  if (ring.length < 3) return 'Polygon area membutuhkan minimal 3 titik.';
  if (ring.length > 200) return 'Polygon area maksimal 200 titik.';
  if (!pointInPolygon(input.start, ring) || !pointInPolygon(input.dest, ring)) {
    return 'Kedua tower harus berada di dalam polygon area.';
  }
  return null;
}

export function validatePlanningRates(rates: Partial<FtttPlanningRates> | undefined): string | null {
  if (!rates) return 'Isi parameter planning FTTT sebelum kalkulasi.';
  const required: Array<[keyof FtttPlanningRates, string]> = [
    ['poleSpacingMeters', 'Jarak tiang'],
    ['cableSlackRatio', 'Slack kabel'],
    ['manholeSpacingMeters', 'Jarak manhole'],
    ['handholeSpacingMeters', 'Jarak handhole'],
    ['splicesPerManhole', 'Splicing per manhole'],
    ['splicesPerTowerEnd', 'Splicing per ujung tower'],
    ['costPerMeterCableIdr', 'Harga kabel per meter'],
    ['costPerManholeIdr', 'Harga manhole'],
    ['costPerHandholeIdr', 'Harga handhole'],
    ['costPerSpliceIdr', 'Harga splicing'],
    ['costPerPoleIdr', 'Harga tiang'],
  ];
  for (const [key, label] of required) {
    if (!finiteNumber(rates[key])) return `${label} harus diisi sebagai angka (boleh 0 untuk harga).`;
  }
  if ((rates.poleSpacingMeters as number) <= 0 || (rates.poleSpacingMeters as number) > TECHNICAL_SPACING_MAX_M) {
    return `Jarak tiang harus lebih dari 0 dan maksimal ${TECHNICAL_SPACING_MAX_M} m.`;
  }
  if ((rates.manholeSpacingMeters as number) <= 0 || (rates.handholeSpacingMeters as number) <= 0) {
    return 'Jarak manhole dan handhole harus lebih dari 0.';
  }
  if ((rates.cableSlackRatio as number) < 0 || (rates.cableSlackRatio as number) > 1) {
    return 'Slack kabel diisi sebagai rasio 0 sampai 1 (contoh 0.05 = 5%).';
  }
  const nonNegative = [
    rates.splicesPerManhole,
    rates.splicesPerTowerEnd,
    rates.costPerMeterCableIdr,
    rates.costPerManholeIdr,
    rates.costPerHandholeIdr,
    rates.costPerSpliceIdr,
    rates.costPerPoleIdr,
  ];
  if (nonNegative.some((n) => !finiteNumber(n) || n < 0)) {
    return 'Jumlah splicing dan harga tidak boleh negatif.';
  }
  if (rates.waterSetbackMeters != null) {
    if (!finiteNumber(rates.waterSetbackMeters) || rates.waterSetbackMeters <= 0 || rates.waterSetbackMeters > 500) {
      return 'Setback badan air, jika diisi, harus antara 1 dan 500 m. Kosongkan bila belum ada standar.';
    }
  }
  if (rates.waterCrossingSurchargeIdr != null && (!finiteNumber(rates.waterCrossingSurchargeIdr) || rates.waterCrossingSurchargeIdr < 0)) {
    return 'Surcharge water crossing, jika diisi, tidak boleh negatif.';
  }
  return null;
}

export function towerInsideArea(
  point: LngLat,
  area: { areaMethod: FtttAreaMethod; radiusMeters?: number; center?: LngLat; polygon?: LngLat[] },
): boolean {
  if (area.areaMethod === 'RADIUS' && area.center && finiteNumber(area.radiusMeters)) {
    return pointInRadius(point, area.center, area.radiusMeters);
  }
  if (area.areaMethod === 'POLYGON' && area.polygon && area.polygon.length >= 3) {
    return pointInPolygon(point, area.polygon);
  }
  return false;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function onSegment(a: LngLat, b: LngLat, p: LngLat): boolean {
  return (
    Math.min(a[0], b[0]) - 1e-12 <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    Math.min(a[1], b[1]) - 1e-12 <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}

export function segmentsIntersect(a1: LngLat, a2: LngLat, b1: LngLat, b2: LngLat): boolean {
  const o1 = orient(a1[0], a1[1], a2[0], a2[1], b1[0], b1[1]);
  const o2 = orient(a1[0], a1[1], a2[0], a2[1], b2[0], b2[1]);
  const o3 = orient(b1[0], b1[1], b2[0], b2[1], a1[0], a1[1]);
  const o4 = orient(b1[0], b1[1], b2[0], b2[1], a2[0], a2[1]);
  if ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) {
    if ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)) return true;
  }
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

function toLocalMeters(origin: LngLat, point: LngLat): [number, number] {
  const latRad = (origin[1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(latRad);
  const my = 110_540;
  return [(point[0] - origin[0]) * mx, (point[1] - origin[1]) * my];
}

export function distancePointToSegmentMeters(point: LngLat, a: LngLat, b: LngLat): number {
  const p = toLocalMeters(point, point);
  const aa = toLocalMeters(point, a);
  const bb = toLocalMeters(point, b);
  // origin is `point`, so p is [0,0]
  void p;
  const abx = bb[0] - aa[0];
  const aby = bb[1] - aa[1];
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(aa[0], aa[1]);
  let t = -(aa[0] * abx + aa[1] * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = aa[0] + abx * t;
  const cy = aa[1] + aby * t;
  return Math.hypot(cx, cy);
}

export type WaterSegment = [LngLat, LngLat];

export function routeCrossesWater(
  route: LngLat[],
  water: WaterSegment[],
  setbackMeters?: number,
): boolean {
  if (route.length < 2 || water.length === 0) return false;
  const useSetback = finiteNumber(setbackMeters) && setbackMeters > 0;
  const waterways = water.length > 1500 ? water.slice(0, 1500) : water;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    for (const [w1, w2] of waterways) {
      if (segmentsIntersect(a, b, w1, w2)) return true;
      if (useSetback) {
        if (distancePointToSegmentMeters(a, w1, w2) <= (setbackMeters as number)) return true;
        if (distancePointToSegmentMeters(b, w1, w2) <= (setbackMeters as number)) return true;
      }
    }
  }
  return false;
}

/**
 * OSM road-name hint only. This is not a JIP road classification standard.
 * Foot profile is treated as local because it is allowed to leave arterial roads.
 */
export function classifyRoadKind(steps: RouteStep[], profile: 'driving' | 'foot'): FtttRoadKind {
  if (profile === 'foot') return 'LOCAL_ROAD';
  let main = 0;
  let local = 0;
  for (const step of steps) {
    const dist = step.distance && step.distance > 0 ? step.distance : 1;
    const text = `${step.name ?? ''} ${step.ref ?? ''}`.toLowerCase();
    const major =
      /\b(tol|toll|highway|nasional|arteri|raya|ring)\b/.test(text) ||
      /^[a-z]?\d{1,3}[a-z]?$/i.test((step.ref ?? '').trim());
    const localish =
      /\b(gang|lorong|lingkungan|setapak)\b/.test(text) || !(step.name && step.name.trim());
    if (major) main += dist;
    else if (localish) local += dist;
    else main += dist * 0.25;
  }
  if (main === 0 && local === 0) return 'MAIN_ROAD';
  return main >= local ? 'MAIN_ROAD' : 'LOCAL_ROAD';
}

export function routesTooSimilar(a: LngLat[], b: LngLat[], nearM = 40, threshold = 0.8): boolean {
  const samples = pointsAlongLine(a, 80);
  const probe = samples.length > 0 ? samples : a;
  if (probe.length === 0 || b.length < 2) return false;
  let near = 0;
  for (const p of probe) {
    let min = Infinity;
    for (let i = 1; i < b.length; i++) {
      const d = distancePointToSegmentMeters(p, b[i - 1], b[i]);
      if (d < min) min = d;
    }
    if (min <= nearM) near += 1;
  }
  return near / probe.length >= threshold;
}

export function selectFtttRoutes(candidates: RouteCandidate[]): RouteCandidate[] {
  const distinct: RouteCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.coordinates.length < 2) continue;
    if (polylineLengthMeters(candidate.coordinates) < 15) continue;
    if (distinct.some((kept) => routesTooSimilar(kept.coordinates, candidate.coordinates))) continue;
    distinct.push(candidate);
  }
  const used = new Set<RouteCandidate>();
  const picked: RouteCandidate[] = [];
  const take = (pred: (candidate: RouteCandidate) => boolean) => {
    const found = distinct.find((candidate) => !used.has(candidate) && pred(candidate));
    if (!found) return;
    used.add(found);
    picked.push(found);
  };
  take((candidate) => candidate.kind === 'MAIN_ROAD' && !candidate.crossesWater);
  if (!picked.some((candidate) => candidate.kind === 'MAIN_ROAD')) {
    take((candidate) => candidate.kind === 'MAIN_ROAD');
  }
  take((candidate) => candidate.kind === 'LOCAL_ROAD');
  take((candidate) => candidate.crossesWater);
  for (const candidate of distinct) {
    if (picked.length >= 3) break;
    if (used.has(candidate)) continue;
    used.add(candidate);
    picked.push(candidate);
  }
  return picked.slice(0, 3);
}

function routeTypeFor(route: RouteCandidate, index: number, picked: RouteCandidate[]): FtttRouteType {
  if (route.crossesWater && (index === picked.length - 1 || index >= 2)) return 'ALTERNATIVE_CROSSING';
  if (index >= 2 && route.kind === picked[0]?.kind) return 'ALTERNATIVE';
  return route.kind;
}

const TYPE_LABEL: Record<FtttRouteType, string> = {
  MAIN_ROAD: 'Main Road',
  LOCAL_ROAD: 'Local Road',
  ALTERNATIVE: 'Alternative Route',
  ALTERNATIVE_CROSSING: 'Alternative Crossing',
};

export function routeTypeLabel(type: FtttRouteType): string {
  return TYPE_LABEL[type];
}

export function estimateFtttRoute(
  coordinates: LngLat[],
  rates: FtttPlanningRates,
  routeType: FtttRouteType,
  crossesWater: boolean,
): RouteEstimate {
  const distanceM = Math.round(polylineLengthMeters(coordinates));
  const foCableM = Math.ceil(distanceM * (1 + rates.cableSlackRatio));
  const manholes = pointsAlongLine(coordinates, rates.manholeSpacingMeters);
  const handholes = pointsAlongLine(coordinates, rates.handholeSpacingMeters).filter((hole) =>
    manholes.every((manhole) => haversineMeters(hole, manhole) > 8),
  );
  const poles = pointsAlongLine(coordinates, rates.poleSpacingMeters);
  const spliceCount = manholes.length * rates.splicesPerManhole + 2 * rates.splicesPerTowerEnd;
  const cableIdr = foCableM * rates.costPerMeterCableIdr;
  const manholeIdr = manholes.length * rates.costPerManholeIdr;
  const handholeIdr = handholes.length * rates.costPerHandholeIdr;
  const spliceIdr = spliceCount * rates.costPerSpliceIdr;
  const poleIdr = poles.length * rates.costPerPoleIdr;
  const waterSurchargeIdr =
    crossesWater && finiteNumber(rates.waterCrossingSurchargeIdr) ? rates.waterCrossingSurchargeIdr : 0;
  const supportingWork = [
    `Penarikan kabel FO ±${foCableM} m termasuk slack ${(rates.cableSlackRatio * 100).toFixed(1)}% dari parameter user.`,
    `Tiang antara tower: ${poles.length} titik, jarak ${rates.poleSpacingMeters} m.`,
    `Manhole: ${manholes.length} titik, jarak ${rates.manholeSpacingMeters} m.`,
    `Handhole: ${handholes.length} titik, jarak ${rates.handholeSpacingMeters} m (titik yang berhimpit manhole tidak dihitung ganda).`,
    `Splicing: ${spliceCount} sambungan (${rates.splicesPerManhole} per manhole + ${rates.splicesPerTowerEnd} per ujung tower).`,
  ];
  if (crossesWater) {
    supportingWork.push(
      waterSurchargeIdr > 0
        ? 'Lintasan memotong badan air pada data OSM. Surcharge yang diinput user ditambahkan. Ini bukan desain crossing (entry/exit, metode, buffer engineering).'
        : 'Lintasan memotong badan air pada data OSM. Biaya tambahan crossing tidak dihitung karena surcharge tidak diisi.',
    );
  }
  const advantages: string[] = [];
  const considerations: string[] = [
    'Klasifikasi jalan memakai nama/referensi dari data routing OSM, bukan standar klasifikasi JIP.',
    'Sistem tidak memilih jalur final. Keputusan tetap di tim Project.',
  ];
  if (routeType === 'MAIN_ROAD') {
    advantages.push('Koridor mengikuti jalan yang dikenali routing sebagai jalan utama atau jalan bernama.');
    considerations.push('Perizinan, bahu jalan, dan kepadatan lalu lintas perlu dicek di lapangan.');
  } else if (routeType === 'LOCAL_ROAD') {
    advantages.push('Koridor memakai jalan lingkungan atau profil yang tidak mengutamakan jalan arteri.');
    considerations.push('Akses kendaraan kerja dan kondisi jalan kecil perlu survei.');
  } else if (routeType === 'ALTERNATIVE_CROSSING') {
    advantages.push('Geometri ini berbeda dan berpotongan dengan badan air pada data yang tersedia, sehingga bisa dipertimbangkan sebagai kandidat crossing.');
    considerations.push(
      'Bukan rekomendasi water crossing. Entry, exit, lebar badan air, metode konstruksi, dan standar JIP belum diterapkan sebagai aturan sistem.',
    );
  } else {
    advantages.push('Geometri alternatif yang cukup berbeda dari jalur lain pada pasangan tower yang sama.');
    considerations.push('Kelayakan lapangan belum diverifikasi oleh sistem.');
  }
  if (crossesWater && routeType !== 'ALTERNATIVE_CROSSING') {
    considerations.push('Jalur ini juga memotong badan air pada data OSM. Jangan dipilih hanya karena jaraknya.');
  }
  if (!finiteNumber(rates.waterSetbackMeters)) {
    considerations.push('Setback/buffer badan air tidak diterapkan karena tidak diisi.');
  } else {
    considerations.push(`Setback badan air memakai nilai yang diinput: ${rates.waterSetbackMeters} m.`);
  }
  return {
    distanceM,
    foCableM,
    manholes,
    handholes,
    poles,
    spliceCount,
    supportingWork,
    costIdr: Math.round(cableIdr + manholeIdr + handholeIdr + spliceIdr + poleIdr + waterSurchargeIdr),
    costBreakdown: {
      cableIdr: Math.round(cableIdr),
      manholeIdr: Math.round(manholeIdr),
      handholeIdr: Math.round(handholeIdr),
      spliceIdr: Math.round(spliceIdr),
      poleIdr: Math.round(poleIdr),
      waterSurchargeIdr: Math.round(waterSurchargeIdr),
    },
    advantages,
    considerations,
  };
}

export type PresentedFtttRoute = RouteCandidate & {
  routeId: string;
  color: string;
  routeType: FtttRouteType;
  routeName: string;
  estimate: RouteEstimate;
};

export function presentFtttRoutes(picked: RouteCandidate[], rates: FtttPlanningRates): PresentedFtttRoute[] {
  return picked.map((route, index) => {
    const routeType = routeTypeFor(route, index, picked);
    return {
      ...route,
      routeId: FTTT_ROUTE_STYLES[index].id,
      color: FTTT_ROUTE_STYLES[index].color,
      routeType,
      routeName: `${FTTT_ROUTE_STYLES[index].id} — ${routeTypeLabel(routeType)}`,
      estimate: estimateFtttRoute(route.coordinates, rates, routeType, route.crossesWater),
    };
  });
}

export function midpoint(coords: LngLat[]): LngLat {
  if (coords.length === 0) return [0, 0];
  const target = polylineLengthMeters(coords) / 2;
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineMeters(coords[i - 1], coords[i]);
    if (walked + seg >= target) {
      const t = seg === 0 ? 0 : (target - walked) / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
    }
    walked += seg;
  }
  return coords[Math.floor(coords.length / 2)];
}
