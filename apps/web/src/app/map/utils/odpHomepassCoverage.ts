/**
 * Homepass-first ODP placement helpers (JLM GIS coverage).
 * Cluster in-area Homepass → ODP candidates → capacity/distance assignment.
 */

export type HpPoint = { lng: number; lat: number };

export type UnservedReason = 'CAPACITY' | 'DISTANCE' | 'NO_ODP';

export type HpAssignment = {
  coords: [number, number];
  odpIdx: number;
  covered: boolean;
  reason?: UnservedReason;
  /** Cascade drop attaches to this already-covered Homepass index (JLM V3). */
  peerIdx?: number;
  viaPeer?: boolean;
};

export type CoverageReport = {
  totalHomepass: number;
  covered: number;
  unserved: number;
  reasons: Record<UnservedReason, number>;
  odpPlaced: number;
  odpTarget: number;
  odpAddedForCoverage: number;
};

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroidOf(points: HpPoint[]): [number, number] {
  const n = points.length || 1;
  const lng = points.reduce((s, p) => s + p.lng, 0) / n;
  const lat = points.reduce((s, p) => s + p.lat, 0) / n;
  return [lng, lat];
}

/** Pick the remaining point with the most neighbors within neighborRadiusM. */
function pickDensestSeed(remaining: HpPoint[], neighborRadiusM: number): number {
  if (remaining.length <= 1) return 0;
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < remaining.length; i++) {
    const a = remaining[i];
    let score = 0;
    for (let j = 0; j < remaining.length; j++) {
      if (i === j) continue;
      const b = remaining[j];
      if (haversineMeters(a.lat, a.lng, b.lat, b.lng) <= neighborRadiusM) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Greedy Homepass packing: grow clusters up to `capacity` around densest seeds.
 * Stops packing a member when farther than maxClusterRadiusM (JLM V2).
 */
export function clusterHomepassForOdp(
  points: HpPoint[],
  capacity: number,
  neighborRadiusM = 90,
  maxClusterRadiusM = 180,
): Array<{ centroid: [number, number]; members: HpPoint[] }> {
  const cap = Math.max(1, capacity);
  const remaining = points.map((p) => ({ ...p }));
  const clusters: Array<{ centroid: [number, number]; members: HpPoint[] }> = [];

  while (remaining.length > 0) {
    const seedIdx = pickDensestSeed(remaining, neighborRadiusM);
    const members: HpPoint[] = [remaining[seedIdx]];
    remaining.splice(seedIdx, 1);

    while (members.length < cap && remaining.length > 0) {
      const c = centroidOf(members);
      let nearestIdx = -1;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineMeters(c[1], c[0], remaining[i].lat, remaining[i].lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      // JLM V2: do not stretch one cluster beyond drop-cable reach
      if (nearestIdx < 0 || nearestDist > maxClusterRadiusM) break;
      members.push(remaining[nearestIdx]);
      remaining.splice(nearestIdx, 1);
    }

    clusters.push({ centroid: centroidOf(members), members });
  }

  return clusters;
}

/** Target ODP count from actual Homepass vs API density estimate. */
export function resolveOdpTargetCount(
  apiEstimateCount: number,
  actualHomepass: number,
  capacity: number,
): number {
  const byCapacity =
    actualHomepass > 0 ? Math.max(1, Math.ceil(actualHomepass / Math.max(1, capacity))) : 0;
  return Math.max(1, apiEstimateCount || 0, byCapacity);
}

/** Soft ceiling so completion loop cannot explode ODP count / API storms. */
export function resolveMaxOdpCap(
  targetCount: number,
  actualHomepass: number,
  capacity: number,
): number {
  const byCapacity =
    actualHomepass > 0 ? Math.ceil(actualHomepass / Math.max(1, capacity)) : targetCount;
  // JLM V4: more spatial slack for CAPACITY pockets (esp. 1:8) without unbounded growth
  const headroom = Math.max(16, Math.ceil(byCapacity * 0.35));
  const soft = Math.max(targetCount, byCapacity) + headroom;
  return Math.min(soft, Math.max(byCapacity + 40, 72));
}

/**
 * JLM V4 Issue 1: capacity 1:8 must never invent random densitas Homepass.
 * Random scatter is only allowed as last-resort densitas for other capacities.
 */
export function shouldUseSyntheticDensitasFallback(
  capacity: number,
  hasKmzCustomers: boolean,
  buildingCount: number,
): boolean {
  if (hasKmzCustomers || buildingCount > 0) return false;
  if (capacity === 8) return false;
  return true;
}

/** Gap-fill ODP success budget from remaining unserved (JLM V4 Issue 2). */
export function resolveCoverageGapFillPasses(
  unservedCount: number,
  capacity: number,
  maxOdpCap: number,
  currentOdpCount: number,
): number {
  const room = Math.max(0, maxOdpCap - currentOdpCount);
  if (room <= 0 || unservedCount <= 0) return 0;
  const portsNeeded = Math.ceil(unservedCount / Math.max(1, capacity));
  return Math.min(Math.max(12, portsNeeded + 4), room, 48);
}

/** Drop coverage radius — scale slightly for large areas without becoming unbounded. */
export function resolveCoverageRadiusM(
  spacingM: number,
  areaRadiusM: number,
): number {
  const base = Math.max(250, spacingM * 3);
  const scaled = Math.min(420, Math.max(base, areaRadiusM * 0.28));
  return Math.round(scaled);
}

export function assignHomepassToOdps(
  buildings: HpPoint[],
  odpPositions: [number, number][],
  odpCapacity: number,
  coverageRadiusM: number,
): { assignments: HpAssignment[]; odpLoad: number[] } {
  const odpLoad = odpPositions.map(() => 0);
  const ordered = buildings
    .map((b) => {
      let nearest = Infinity;
      for (const [oLng, oLat] of odpPositions) {
        const d = haversineMeters(b.lat, b.lng, oLat, oLng);
        if (d < nearest) nearest = d;
      }
      return { b, nearest };
    })
    .sort((a, z) => a.nearest - z.nearest);

  const assignments: HpAssignment[] = [];
  for (const { b } of ordered) {
    let chosen = -1;
    let chosenDist = Infinity;
    let anyInRange = false;
    let anyHasPort = false;

    odpPositions.forEach(([oLng, oLat], oi) => {
      const d = haversineMeters(b.lat, b.lng, oLat, oLng);
      if (d > coverageRadiusM) return;
      anyInRange = true;
      if (odpLoad[oi] >= odpCapacity) return;
      anyHasPort = true;
      if (d < chosenDist) {
        chosen = oi;
        chosenDist = d;
      }
    });

    if (chosen >= 0) {
      odpLoad[chosen] += 1;
      assignments.push({ coords: [b.lng, b.lat], odpIdx: chosen, covered: true });
    } else {
      let reason: UnservedReason = 'NO_ODP';
      if (odpPositions.length === 0) reason = 'NO_ODP';
      else if (!anyInRange) reason = 'DISTANCE';
      else if (!anyHasPort) reason = 'CAPACITY';
      else reason = 'CAPACITY';
      assignments.push({
        coords: [b.lng, b.lat],
        odpIdx: -1,
        covered: false,
        reason,
      });
    }
  }

  return { assignments, odpLoad };
}

/**
 * JLM V2 Dynamic Redistribution: move CAPACITY-unserved HP onto under-filled ODPs
 * still within coverage radius (one-pass rebalance).
 */
export function redistributeHomepassLoads(
  assignments: HpAssignment[],
  odpPositions: [number, number][],
  odpCapacity: number,
  coverageRadiusM: number,
  options?: { passes?: number },
): { assignments: HpAssignment[]; odpLoad: number[] } {
  let next = assignments.map((a) => ({ ...a }));
  const passes = Math.max(1, options?.passes ?? 3);

  const rebuildLoad = () => {
    const odpLoad = odpPositions.map(() => 0);
    for (const a of next) {
      if (a.covered && a.odpIdx >= 0) odpLoad[a.odpIdx] += 1;
    }
    return odpLoad;
  };

  let odpLoad = rebuildLoad();
  for (let pass = 0; pass < passes; pass++) {
    let moved = 0;
    for (let i = 0; i < next.length; i++) {
      const a = next[i];
      if (a.covered) continue;
      if (a.reason !== 'CAPACITY' && a.reason !== 'DISTANCE') continue;

      let best = -1;
      let bestDist = Infinity;
      odpPositions.forEach(([oLng, oLat], oi) => {
        if (odpLoad[oi] >= odpCapacity) return;
        const d = haversineMeters(a.coords[1], a.coords[0], oLat, oLng);
        if (d > coverageRadiusM) return;
        if (d < bestDist) {
          best = oi;
          bestDist = d;
        }
      });
      if (best >= 0) {
        odpLoad[best] += 1;
        next[i] = { coords: a.coords, odpIdx: best, covered: true };
        moved += 1;
      }
    }
    if (moved === 0) break;
    odpLoad = rebuildLoad();
  }

  return { assignments: next, odpLoad };
}

/**
 * Max peer-to-peer drop hop (m). Short hops force chain along densitas / street frontage
 * without long jumps that cut across blocks (JLM V3).
 */
export function resolveMaxPeerHopM(coverageRadiusM: number): number {
  return Math.round(Math.min(160, Math.max(65, coverageRadiusM * 0.4)));
}

/**
 * JLM V3: coverage completion via nearest already-served Homepass (peer-to-peer).
 * Only flips unserved → covered; never rewires existing covered assignments.
 * Capacity is charged to the peer's ODP. Multi-wave BFS expands the connected set.
 */
export function expandHomepassViaPeers(
  assignments: HpAssignment[],
  odpLoad: number[],
  odpCapacity: number,
  maxPeerHopM: number,
  options?: { maxWaves?: number },
): { assignments: HpAssignment[]; odpLoad: number[]; expanded: number } {
  const next = assignments.map((a) => ({ ...a }));
  const load = odpLoad.slice();
  const maxWaves = options?.maxWaves ?? 32;
  let expanded = 0;
  const hop = Math.max(1, maxPeerHopM);

  for (let wave = 0; wave < maxWaves; wave++) {
    type Cand = { ui: number; peer: number; dist: number; odp: number };
    const cands: Cand[] = [];

    for (let ui = 0; ui < next.length; ui++) {
      if (next[ui].covered) continue;
      const u = next[ui];
      let best: Cand | null = null;
      for (let pi = 0; pi < next.length; pi++) {
        const p = next[pi];
        if (!p.covered || p.odpIdx < 0) continue;
        if (load[p.odpIdx] >= odpCapacity) continue;
        const d = haversineMeters(u.coords[1], u.coords[0], p.coords[1], p.coords[0]);
        if (d <= 0 || d > hop) continue;
        if (!best || d < best.dist) best = { ui, peer: pi, dist: d, odp: p.odpIdx };
      }
      if (best) cands.push(best);
    }

    if (cands.length === 0) break;
    cands.sort((a, b) => a.dist - b.dist);

    let progress = 0;
    const claimed = new Set<number>();
    for (const c of cands) {
      if (claimed.has(c.ui)) continue;
      if (next[c.ui].covered) continue;
      if (!next[c.peer].covered || next[c.peer].odpIdx !== c.odp) continue;
      if (load[c.odp] >= odpCapacity) continue;
      load[c.odp] += 1;
      next[c.ui] = {
        coords: next[c.ui].coords,
        odpIdx: c.odp,
        covered: true,
        viaPeer: true,
        peerIdx: c.peer,
      };
      claimed.add(c.ui);
      progress += 1;
      expanded += 1;
    }
    if (progress === 0) break;
  }

  return { assignments: next, odpLoad: load, expanded };
}

/** Centroid of the largest remaining unserved pocket (for gap-fill ODP). */
export function unservedClusterCentroid(
  unserved: HpPoint[],
  capacity: number,
  maxClusterRadiusM = 180,
): [number, number] | null {
  if (unserved.length === 0) return null;
  const clusters = clusterHomepassForOdp(unserved, capacity, 90, maxClusterRadiusM);
  if (clusters.length === 0) return null;
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters[0].centroid;
}

/** N-th unserved pocket centroid (skip failed seeds without aborting gap-fill). */
export function unservedClusterCentroidAt(
  unserved: HpPoint[],
  capacity: number,
  index: number,
  maxClusterRadiusM = 180,
): [number, number] | null {
  if (unserved.length === 0) return null;
  const clusters = clusterHomepassForOdp(unserved, capacity, 90, maxClusterRadiusM);
  if (clusters.length === 0) return null;
  clusters.sort((a, b) => b.members.length - a.members.length);
  const c = clusters[index % clusters.length];
  return c ? c.centroid : null;
}

export function summarizeCoverage(
  assignments: HpAssignment[],
  odpPlaced: number,
  odpTarget: number,
  odpAddedForCoverage: number,
): CoverageReport {
  const reasons: Record<UnservedReason, number> = {
    CAPACITY: 0,
    DISTANCE: 0,
    NO_ODP: 0,
  };
  let covered = 0;
  for (const a of assignments) {
    if (a.covered) covered += 1;
    else if (a.reason) reasons[a.reason] += 1;
  }
  return {
    totalHomepass: assignments.length,
    covered,
    unserved: assignments.length - covered,
    reasons,
    odpPlaced,
    odpTarget,
    odpAddedForCoverage,
  };
}

export function formatCoverageToast(
  report: CoverageReport,
  capacity: number,
): {
  ok: boolean;
  message: string;
} {
  // JLM V2: never claim "cakupan lengkap" when Homepass detection produced 0
  if (report.totalHomepass <= 0) {
    return {
      ok: false,
      message:
        '⚠️ Topologi selesai tanpa Homepass terdeteksi di area. ' +
        'OSM mungkin kosong/gagal — coba lagi, unggah KMZ pelanggan, atau perbesar area.',
    };
  }
  const base =
    `${report.odpPlaced} ODP · ${report.covered} tercover / ${report.totalHomepass} homepass` +
    ` (kapasitas 1:${capacity})`;
  if (report.unserved <= 0) {
    return { ok: true, message: `✅ Topologi selesai: ${base} · cakupan lengkap` };
  }
  const bits: string[] = [];
  if (report.reasons.CAPACITY) bits.push(`${report.reasons.CAPACITY} kapasitas port`);
  if (report.reasons.DISTANCE) bits.push(`${report.reasons.DISTANCE} jarak drop`);
  if (report.reasons.NO_ODP) bits.push(`${report.reasons.NO_ODP} tanpa ODP`);
  const why = bits.length ? bits.join(', ') : 'kendala algoritma';
  return {
    ok: false,
    message:
      `⚠️ Topologi selesai: ${base} · ${report.unserved} belum terlayani (${why}).` +
      (report.odpAddedForCoverage
        ? ` Ditambah ${report.odpAddedForCoverage} ODP untuk cakupan.`
        : ''),
  };
}
