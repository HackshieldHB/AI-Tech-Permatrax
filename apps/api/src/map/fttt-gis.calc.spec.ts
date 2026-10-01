import {
  classifyRoadKind,
  estimateFtttRoute,
  haversineMeters,
  pointInPolygon,
  pointInRadius,
  presentFtttRoutes,
  routeCrossesWater,
  routesTooSimilar,
  selectFtttRoutes,
  validateFtttArea,
  validatePlanningRates,
  type FtttPlanningRates,
  type LngLat,
  type RouteCandidate,
  type WaterSegment,
} from './fttt-gis.calc';
import { parseOsrmRoutes, parseOverpassWaterways } from './fttt-gis.routing';

function lineEast(lng: number, lat: number, meters: number, parts = 8): LngLat[] {
  const mPerDeg = 111_320 * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: parts + 1 }, (_, i) => [lng + (meters * i) / parts / mPerDeg, lat]);
}

function shiftNorth(coords: LngLat[], meters: number): LngLat[] {
  const dLat = meters / 110_540;
  return coords.map(([lng, lat]) => [lng, lat + dLat]);
}

const rates: FtttPlanningRates = {
  poleSpacingMeters: 50,
  cableSlackRatio: 0.1,
  manholeSpacingMeters: 200,
  handholeSpacingMeters: 250,
  splicesPerManhole: 2,
  splicesPerTowerEnd: 1,
  costPerMeterCableIdr: 1000,
  costPerManholeIdr: 500_000,
  costPerHandholeIdr: 200_000,
  costPerSpliceIdr: 50_000,
  costPerPoleIdr: 150_000,
};

describe('FTTT planning rules', () => {
  const center: LngLat = [106.8, -6.2];

  it('rejects a missing radius instead of assuming 500 m', () => {
    const message = validateFtttArea({
      areaMethod: 'RADIUS',
      center,
      start: [106.8, -6.2],
      dest: [106.805, -6.2],
    });
    expect(message).toMatch(/radius/i);
    expect(message).not.toMatch(/500/);
  });

  it('accepts a user radius above 500 m when both towers are inside', () => {
    const start = lineEast(106.8, -6.2, 0, 1)[0];
    const far = lineEast(106.8, -6.2, 1200, 1)[1];
    expect(haversineMeters(start, far)).toBeGreaterThan(1100);
    expect(haversineMeters(start, far)).toBeLessThan(1300);
    expect(
      validateFtttArea({
        areaMethod: 'RADIUS',
        radiusMeters: 2000,
        center: start,
        start,
        dest: far,
      }),
    ).toBeNull();
    expect(pointInRadius(far, start, 500)).toBe(false);
    expect(pointInRadius(far, start, 2000)).toBe(true);
  });

  it('keeps towers outside the polygon out of the calculation', () => {
    const ring: LngLat[] = [
      [106.8, -6.2],
      [106.81, -6.2],
      [106.81, -6.19],
      [106.8, -6.19],
    ];
    expect(pointInPolygon([106.805, -6.195], ring)).toBe(true);
    expect(pointInPolygon([107.2, -6.195], ring)).toBe(false);
    expect(
      validateFtttArea({
        areaMethod: 'POLYGON',
        polygon: ring,
        start: [106.805, -6.195],
        dest: [107.2, -6.5],
      }),
    ).toMatch(/polygon/i);
  });

  it('places poles at the user spacing and prices only the entered rates', () => {
    const coords = lineEast(106.8, -6.2, 1000, 20);
    const estimate = estimateFtttRoute(coords, rates, 'MAIN_ROAD', false);
    expect(estimate.distanceM).toBeGreaterThan(980);
    expect(estimate.distanceM).toBeLessThan(1020);
    expect(estimate.poles.length).toBeGreaterThan(15);
    for (let i = 1; i < estimate.poles.length; i++) {
      const gap = haversineMeters(estimate.poles[i - 1], estimate.poles[i]);
      expect(gap).toBeGreaterThan(45);
      expect(gap).toBeLessThan(55);
    }
    for (let i = 1; i < estimate.manholes.length; i++) {
      const gap = haversineMeters(estimate.manholes[i - 1], estimate.manholes[i]);
      expect(gap).toBeGreaterThan(190);
      expect(gap).toBeLessThan(210);
    }
    expect(estimate.spliceCount).toBe(estimate.manholes.length * 2 + 2);
    expect(estimate.foCableM).toBe(Math.ceil(estimate.distanceM * 1.1));
    const expected =
      estimate.foCableM * rates.costPerMeterCableIdr +
      estimate.manholes.length * rates.costPerManholeIdr +
      estimate.handholes.length * rates.costPerHandholeIdr +
      estimate.spliceCount * rates.costPerSpliceIdr +
      estimate.poles.length * rates.costPerPoleIdr;
    expect(estimate.costIdr).toBe(Math.round(expected));
    expect(estimate.costBreakdown.waterSurchargeIdr).toBe(0);
  });

  it('adds a water surcharge only when the route crosses mapped water and the user set one', () => {
    const coords = lineEast(106.8, -6.2, 400, 4);
    const dry = estimateFtttRoute(coords, { ...rates, waterCrossingSurchargeIdr: 75_000 }, 'MAIN_ROAD', false);
    const wet = estimateFtttRoute(
      coords,
      { ...rates, waterCrossingSurchargeIdr: 75_000 },
      'ALTERNATIVE_CROSSING',
      true,
    );
    const unmarked = estimateFtttRoute(coords, rates, 'ALTERNATIVE_CROSSING', true);
    expect(dry.costBreakdown.waterSurchargeIdr).toBe(0);
    expect(wet.costBreakdown.waterSurchargeIdr).toBe(75_000);
    expect(unmarked.costBreakdown.waterSurchargeIdr).toBe(0);
    expect(unmarked.considerations.join(' ')).toMatch(/tidak dihitung|bukan rekomendasi/i);
  });

  it('does not flag water crossing when no water geometry exists', () => {
    const coords = lineEast(106.8, -6.2, 500, 6);
    expect(routeCrossesWater(coords, [], 30)).toBe(false);
  });

  it('flags a route that intersects a mapped waterway', () => {
    const coords = lineEast(106.8, -6.2, 500, 6);
    const mid = coords[3];
    const water: WaterSegment[] = [
      [
        [mid[0], mid[1] - 0.002],
        [mid[0], mid[1] + 0.002],
      ],
    ];
    expect(routeCrossesWater(coords, water)).toBe(true);
  });

  it('uses a setback only when the user supplied one', () => {
    const coords = lineEast(106.8, -6.2, 200, 2);
    const parallel: WaterSegment[] = [
      [
        [coords[0][0], coords[0][1] + 25 / 110_540],
        [coords[2][0], coords[2][1] + 25 / 110_540],
      ],
    ];
    expect(routeCrossesWater(coords, parallel)).toBe(false);
    expect(routeCrossesWater(coords, parallel, 40)).toBe(true);
  });

  it('returns up to three distinct routes and does not invent a water route', () => {
    const main = lineEast(106.8, -6.2, 800, 8);
    const local = shiftNorth(lineEast(106.81, -6.205, 800, 8), 180);
    const sameAsMain = main.map((p) => [p[0], p[1]] as LngLat);
    const candidates: RouteCandidate[] = [
      { coordinates: main, steps: [{ name: 'Jalan Tol Jagorawi', ref: '1', distance: 800 }], profile: 'driving', kind: 'MAIN_ROAD', crossesWater: false },
      { coordinates: sameAsMain, steps: [{ name: 'Jalan Tol Jagorawi', distance: 800 }], profile: 'driving', kind: 'MAIN_ROAD', crossesWater: false },
      { coordinates: local, steps: [{ name: 'Gang Melati', distance: 800 }], profile: 'foot', kind: 'LOCAL_ROAD', crossesWater: false },
    ];
    expect(routesTooSimilar(main, sameAsMain)).toBe(true);
    const picked = selectFtttRoutes(candidates);
    expect(picked).toHaveLength(2);
    expect(picked.some((route) => route.crossesWater)).toBe(false);
    const presented = presentFtttRoutes(picked, rates);
    expect(presented.map((route) => route.routeId)).toEqual(['R1', 'R2']);
    expect(presented.map((route) => route.color)).toEqual(['#F5C518', '#F97316']);
    expect(presented[0].routeType).toBe('MAIN_ROAD');
    expect(presented[1].routeType).toBe('LOCAL_ROAD');
    expect(presented.some((route) => 'recommended' in route)).toBe(false);
  });

  it('classifies arterial names as main road and gang or foot routes as local', () => {
    expect(classifyRoadKind([{ name: 'Jalan Tol Dalam Kota', ref: '2', distance: 400 }], 'driving')).toBe('MAIN_ROAD');
    expect(classifyRoadKind([{ name: 'Gang Mawar', distance: 400 }], 'driving')).toBe('LOCAL_ROAD');
    expect(classifyRoadKind([{ name: 'Jalan Tol', distance: 400 }], 'foot')).toBe('LOCAL_ROAD');
  });

  it('rejects incomplete planning rates', () => {
    expect(validatePlanningRates(undefined)).toMatch(/parameter/i);
    expect(validatePlanningRates({ ...rates, poleSpacingMeters: 0 })).toMatch(/tiang/i);
  });
});

describe('FTTT routing parsers', () => {
  it('reads OSRM alternatives and ignores a non-ok response', () => {
    const parsed = parseOsrmRoutes(
      {
        code: 'Ok',
        routes: [
          {
            geometry: { coordinates: [[106.8, -6.2], [106.81, -6.2]] },
            legs: [{ steps: [{ name: 'Jalan Raya Bogor', ref: '1', distance: 1000 }] }],
          },
        ],
      },
      'driving',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].steps[0].name).toBe('Jalan Raya Bogor');
    expect(parseOsrmRoutes({ code: 'NoRoute', routes: [] }, 'driving')).toEqual([]);
  });

  it('reads OSM waterway geometry and does not invent segments from an empty payload', () => {
    const segments = parseOverpassWaterways({
      elements: [{ geometry: [{ lon: 106.8, lat: -6.2 }, { lon: 106.8, lat: -6.19 }] }],
    });
    expect(segments).toEqual([
      [
        [106.8, -6.2],
        [106.8, -6.19],
      ],
    ]);
    expect(parseOverpassWaterways({})).toEqual([]);
  });
});
