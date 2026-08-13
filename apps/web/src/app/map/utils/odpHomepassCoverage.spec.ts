import {
  assignHomepassToOdps,
  clusterHomepassForOdp,
  expandHomepassViaPeers,
  formatCoverageToast,
  redistributeHomepassLoads,
  resolveCoverageGapFillPasses,
  resolveCoverageRadiusM,
  resolveMaxOdpCap,
  resolveMaxPeerHopM,
  resolveOdpTargetCount,
  shouldUseSyntheticDensitasFallback,
  summarizeCoverage,
  unservedClusterCentroid,
  unservedClusterCentroidAt,
} from './odpHomepassCoverage';

describe('odpHomepassCoverage', () => {
  it('clusters Homepass into capacity-sized groups', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({
      lng: 106.8 + (i % 5) * 0.0002,
      lat: -6.2 + Math.floor(i / 5) * 0.0002,
    }));
    const clusters = clusterHomepassForOdp(points, 8);
    expect(clusters.reduce((s, c) => s + c.members.length, 0)).toBe(20);
    expect(Math.max(...clusters.map((c) => c.members.length))).toBeLessThanOrEqual(8);
  });

  it('does not stretch a cluster beyond max radius', () => {
    const points = [
      { lng: 106.8, lat: -6.2 },
      { lng: 106.8001, lat: -6.2001 },
      { lng: 106.85, lat: -6.25 }, // far
    ];
    const clusters = clusterHomepassForOdp(points, 8, 90, 120);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves ODP target from actual Homepass, not only estimate', () => {
    expect(resolveOdpTargetCount(3, 40, 8)).toBe(5);
    expect(resolveOdpTargetCount(10, 20, 8)).toBe(10);
  });

  it('assigns by nearest free port within coverage radius', () => {
    const buildings = [
      { lng: 106.8, lat: -6.2 },
      { lng: 106.8001, lat: -6.2001 },
      { lng: 106.81, lat: -6.21 }, // far
    ];
    const odps: [number, number][] = [[106.8, -6.2]];
    const { assignments, odpLoad } = assignHomepassToOdps(buildings, odps, 2, 250);
    expect(odpLoad[0]).toBe(2);
    expect(assignments.filter((a) => a.covered).length).toBe(2);
    expect(assignments.some((a) => !a.covered && a.reason === 'DISTANCE')).toBe(true);
  });

  it('marks CAPACITY when ODP in range is full', () => {
    const buildings = Array.from({ length: 3 }, (_, i) => ({
      lng: 106.8 + i * 0.00001,
      lat: -6.2,
    }));
    const { assignments } = assignHomepassToOdps(buildings, [[106.8, -6.2]], 2, 250);
    expect(assignments.filter((a) => a.covered).length).toBe(2);
    expect(assignments.some((a) => a.reason === 'CAPACITY')).toBe(true);
  });

  it('redistributes CAPACITY unserved onto another ODP in range', () => {
    const buildings = [
      { lng: 106.8, lat: -6.2 },
      { lng: 106.80005, lat: -6.2 },
      { lng: 106.8001, lat: -6.2 },
    ];
    const odps: [number, number][] = [
      [106.8, -6.2],
      [106.8001, -6.20005],
    ];
    const first = assignHomepassToOdps(buildings, odps, 1, 250);
    // Force overload on first ODP pattern then rebalance
    const { assignments } = redistributeHomepassLoads(first.assignments, odps, 2, 250);
    expect(assignments.every((a) => a.covered)).toBe(true);
  });

  it('finds unserved cluster centroid for gap-fill', () => {
    const c = unservedClusterCentroid(
      [
        { lng: 106.81, lat: -6.21 },
        { lng: 106.8101, lat: -6.2101 },
      ],
      8,
    );
    expect(c).not.toBeNull();
    expect(c![0]).toBeCloseTo(106.81005, 4);
    expect(unservedClusterCentroidAt(
      [
        { lng: 106.81, lat: -6.21 },
        { lng: 106.82, lat: -6.22 },
      ],
      1,
      1,
      50,
    )).not.toBeNull();
  });

  it('formats warning toast when coverage incomplete', () => {
    const report = summarizeCoverage(
      [
        { coords: [0, 0], odpIdx: 0, covered: true },
        { coords: [1, 1], odpIdx: -1, covered: false, reason: 'DISTANCE' },
      ],
      1,
      1,
      0,
    );
    const toast = formatCoverageToast(report, 8);
    expect(toast.ok).toBe(false);
    expect(toast.message).toMatch(/belum terlayani/);
    expect(toast.message).toMatch(/jarak drop/);
  });

  it('never claims full coverage when Homepass count is 0', () => {
    const report = summarizeCoverage([], 3, 3, 0);
    const toast = formatCoverageToast(report, 8);
    expect(toast.ok).toBe(false);
    expect(toast.message).toMatch(/tanpa Homepass/i);
  });

  it('caps max ODP soft ceiling with spatial slack', () => {
    expect(resolveMaxOdpCap(5, 40, 8)).toBeGreaterThanOrEqual(5);
    expect(resolveMaxOdpCap(5, 40, 8)).toBeLessThanOrEqual(72);
    // Enough headroom for CAPACITY pockets beyond ceil(HP/cap)
    expect(resolveMaxOdpCap(100, 800, 8)).toBeGreaterThanOrEqual(100 + 16);
  });

  it('never uses synthetic densitas for ODP capacity 1:8', () => {
    expect(shouldUseSyntheticDensitasFallback(8, false, 0)).toBe(false);
    expect(shouldUseSyntheticDensitasFallback(16, false, 0)).toBe(true);
    expect(shouldUseSyntheticDensitasFallback(8, true, 0)).toBe(false);
    expect(shouldUseSyntheticDensitasFallback(16, false, 10)).toBe(false);
  });

  it('budgets gap-fill passes from remaining unserved', () => {
    expect(resolveCoverageGapFillPasses(174, 8, 140, 100)).toBeGreaterThan(12);
    expect(resolveCoverageGapFillPasses(10, 8, 20, 20)).toBe(0);
    expect(resolveCoverageGapFillPasses(80, 8, 200, 100)).toBeLessThanOrEqual(48);
  });

  it('scales coverage radius with area', () => {
    expect(resolveCoverageRadiusM(65, 300)).toBeGreaterThanOrEqual(250);
    expect(resolveCoverageRadiusM(65, 2000)).toBeLessThanOrEqual(420);
  });

  it('expands unserved Homepass via nearest covered peer within hop', () => {
    // ODP covers HP0 only (capacity 2); HP1 and HP2 are beyond direct radius but chainable
    const assignments = [
      { coords: [106.8, -6.2] as [number, number], odpIdx: 0, covered: true },
      {
        coords: [106.8008, -6.2] as [number, number],
        odpIdx: -1,
        covered: false,
        reason: 'DISTANCE' as const,
      },
      {
        coords: [106.8016, -6.2] as [number, number],
        odpIdx: -1,
        covered: false,
        reason: 'DISTANCE' as const,
      },
    ];
    const { assignments: out, odpLoad, expanded } = expandHomepassViaPeers(
      assignments,
      [1],
      3,
      120,
    );
    expect(expanded).toBe(2);
    expect(out.every((a) => a.covered)).toBe(true);
    expect(out[1].viaPeer).toBe(true);
    expect(out[1].peerIdx).toBe(0);
    expect(out[2].viaPeer).toBe(true);
    expect(out[0].viaPeer).toBeUndefined(); // already covered untouched
    expect(odpLoad[0]).toBe(3);
  });

  it('does not expand peers beyond ODP capacity', () => {
    const assignments = [
      { coords: [106.8, -6.2] as [number, number], odpIdx: 0, covered: true },
      {
        coords: [106.8005, -6.2] as [number, number],
        odpIdx: -1,
        covered: false,
        reason: 'DISTANCE' as const,
      },
      {
        coords: [106.8006, -6.2] as [number, number],
        odpIdx: -1,
        covered: false,
        reason: 'DISTANCE' as const,
      },
    ];
    const { assignments: out, expanded } = expandHomepassViaPeers(assignments, [1], 1, 120);
    expect(expanded).toBe(0);
    expect(out.filter((a) => a.covered).length).toBe(1);
  });

  it('does not rewire already-covered Homepass during peer expansion', () => {
    const assignments = [
      { coords: [106.8, -6.2] as [number, number], odpIdx: 0, covered: true },
      { coords: [106.8001, -6.2] as [number, number], odpIdx: 0, covered: true },
      {
        coords: [106.8007, -6.2] as [number, number],
        odpIdx: -1,
        covered: false,
        reason: 'DISTANCE' as const,
      },
    ];
    const before = JSON.stringify(assignments.slice(0, 2));
    const { assignments: out } = expandHomepassViaPeers(assignments, [2], 4, 120);
    expect(JSON.stringify(out.slice(0, 2))).toBe(before);
    expect(out[2].covered).toBe(true);
    expect(out[2].viaPeer).toBe(true);
  });

  it('resolves peer hop within a bounded band', () => {
    expect(resolveMaxPeerHopM(250)).toBeGreaterThanOrEqual(65);
    expect(resolveMaxPeerHopM(250)).toBeLessThanOrEqual(160);
    expect(resolveMaxPeerHopM(420)).toBeLessThanOrEqual(160);
  });
});
