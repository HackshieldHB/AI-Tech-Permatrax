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
 * Returns one centroid per cluster (candidate ODP positions).
 */
export function clusterHomepassForOdp(
  points: HpPoint[],
  capacity: number,
  neighborRadiusM = 90,
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
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineMeters(c[1], c[0], remaining[i].lat, remaining[i].lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      // Prefer tight clusters; still pack remote leftovers into their own ODPs
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

/** Soft ceiling so completion loop cannot explode ODP count. */
export function resolveMaxOdpCap(targetCount: number, actualHomepass: number, capacity: number): number {
  const byCapacity =
    actualHomepass > 0 ? Math.ceil(actualHomepass / Math.max(1, capacity)) : targetCount;
  const soft = Math.max(targetCount, byCapacity) + Math.max(8, Math.ceil(byCapacity * 0.35));
  return Math.min(soft, Math.max(byCapacity + 40, 80));
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

/** Centroid of the largest remaining unserved pocket (for gap-fill ODP). */
export function unservedClusterCentroid(
  unserved: HpPoint[],
  capacity: number,
): [number, number] | null {
  if (unserved.length === 0) return null;
  const clusters = clusterHomepassForOdp(unserved, capacity);
  if (clusters.length === 0) return null;
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters[0].centroid;
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

export function formatCoverageToast(report: CoverageReport, capacity: number): {
  ok: boolean;
  message: string;
} {
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
