import { mergeCalculationWithHomepasses } from './topologyUtils';
import type { FtthCalcApiResponse } from '../app/map/hooks/types';

describe('mergeCalculationWithHomepasses', () => {
  const baseResponse = {
    summary: {
      areaCategory: 'A',
      categoryReason: 'test',
      backboneDistanceM: 100,
      backboneOwner: 'OSM Data',
      areaType: 'URBAN',
      areaRadiusMeters: 500,
      coverageRadiusMeters: 500,
    },
    homepass: { estimated: 0, active: 0, takeRatePercent: 0 },
    route: { totalM: 0, feederM: 0, distributionM: 0 },
    cable: {
      totalM: 0,
      feederCableType: 'FO',
      distCableType: 'FO',
      dropCableType: 'FO',
      installMethod: 'aerial',
      installReason: 'test',
      breakdown: {
        feederM: 0,
        distributionM: 0,
        dropM: 0,
        bufferPercent: 0,
      },
    },
    equipment: {
      olt: { recommendation: 'olite', portsNeeded: 1, standard: 'std' },
      odc: { count: 1, capacity: '144-core', unit: 'core' },
      odp: { count: 1, capacity: 24, spacingM: 65, unit: 'm' },
      splitter: { count: 0, ratio: '1:0', unit: 'unit' },
      closure: { inline: 0, total: 0, unit: 'unit' },
      pole: { total: 0, existing: 0, newBuild: 0, spacingM: 0, unit: 'm', note: '' },
      splice: { total: 0, plan: [], unit: 'unit' },
      connector: { count: 0, type: 'SC', unit: 'unit' },
      patchCord: { count: 0, type: 'SC', unit: 'unit' },
      ont: { count: 0, type: 'GPON', unit: 'unit' },
      jointBox: { count: 0, unit: 'unit' },
      hdpeConduit: { meters: 0, type: 'mm', unit: 'unit' },
    },
    topology: {
      description: 'test',
      segments: [],
      standards: [],
    },
    powerBudget: {
      gponClass: 'B',
      linkMarginDB: 0,
      isOk: true,
      totalLossDB: 0,
      breakdown: {
        splitterDB: 0,
        seratFeederDB: 0,
        konektorDB: 0,
        sambunganDB: 0,
        seratDistDB: 0,
        seratDropDB: 0,
      },
    },
    costEstimation: {
      currency: 'IDR',
      note: 'note',
      breakdown: [],
      totalMaterial: 0,
      totalInstall: 0,
      totalProject: 0,
      costPerHomepass: 0,
      roi: {
        revenuePerHpPerMonth: 0,
        monthlyRevenue: 0,
        breakEvenMonths: 0,
        tiers: [],
      },
    },
    installation: {
      method: 'aerial',
      totalDuration: '0',
      sequence: [],
    },
    recommendations: [],
  } as FtthCalcApiResponse;

  it('returns original result when there is no previous homepass points', () => {
    const result = mergeCalculationWithHomepasses(null, baseResponse);
    expect(result).toBe(baseResponse);
    expect(result.homepassPoints).toBeUndefined();
  });

  it('preserves previous homepass points when new calc result has none', () => {
    const previousTopology = {
      homepassPoints: [
        { coords: [100, 0] as [number, number], odpIdx: 0 },
        { coords: [101, 1] as [number, number], odpIdx: 1 },
      ],
    };

    const result = mergeCalculationWithHomepasses(previousTopology, baseResponse);
    expect(result.homepassPoints).toEqual(previousTopology.homepassPoints);
  });

  it('deduplicates overlapping preserved homepass coordinates', () => {
    const previousTopology = {
      homepassPoints: [
        { coords: [100, 0] as [number, number], odpIdx: 0 },
        { coords: [101, 1] as [number, number], odpIdx: 1 },
      ],
    };
    const nextResult = {
      ...baseResponse,
      homepassPoints: [{ coords: [100, 0] as [number, number], odpIdx: 0 }],
    } as FtthCalcApiResponse & { homepassPoints: Array<{ coords: [number, number]; odpIdx: number }> };

    const merged = mergeCalculationWithHomepasses(previousTopology, nextResult);
    expect(merged.homepassPoints).toEqual([
      { coords: [100, 0], odpIdx: 0 },
      { coords: [101, 1], odpIdx: 1 },
    ]);
  });
});
