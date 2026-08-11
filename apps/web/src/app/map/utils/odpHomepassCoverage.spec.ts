import {
  assignHomepassToOdps,
  clusterHomepassForOdp,
  formatCoverageToast,
  resolveMaxOdpCap,
  resolveOdpTargetCount,
  summarizeCoverage,
  unservedClusterCentroid,
} from './odpHomepassCoverage';

describe('odpHomepassCoverage', () => {
  it('clusters Homepass into capacity-sized groups', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({
      lng: 106.8 + (i % 5) * 0.0002,
      lat: -6.2 + Math.floor(i / 5) * 0.0002,
    }));
    const clusters = clusterHomepassForOdp(points, 8);
    expect(clusters.length).toBe(3);
    expect(clusters.reduce((s, c) => s + c.members.length, 0)).toBe(20);
    expect(Math.max(...clusters.map((c) => c.members.length))).toBeLessThanOrEqual(8);
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

  it('caps max ODP soft ceiling', () => {
    expect(resolveMaxOdpCap(5, 40, 8)).toBeGreaterThanOrEqual(5);
    expect(resolveMaxOdpCap(5, 40, 8)).toBeLessThanOrEqual(36);
  });
});
