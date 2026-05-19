import { useDesignStore } from './useDesignStore';
import type { FeatureCollection } from 'geojson';

describe('useDesignStore hydrate', () => {
  beforeEach(() => {
    useDesignStore.getState().clear();
  });

  it('converts feature collection geometry into node and edge records', () => {
    const geometry: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [100.1, -0.1] },
          properties: {
            kind: 'node',
            refId: 'olt-1',
            type: 'OLT',
            origin: 'MANUAL',
            label: 'OLT 1',
          },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [100.1, -0.1],
              [100.2, -0.2],
            ],
          },
          properties: {
            kind: 'edge',
            refId: 'edge-1',
            type: 'FEEDER',
            origin: 'AUTO',
            fromRef: 'olt-1',
            toRef: 'odp-1',
          },
        },
      ],
    };

    useDesignStore.getState().hydrate('design-1', geometry, { areaType: 'URBAN' }, { foo: 'bar' }, { type: 'FeatureCollection', features: [] });
    const state = useDesignStore.getState();

    expect(state.designId).toBe('design-1');
    expect(state.calcInputs).toEqual({ areaType: 'URBAN' });
    expect(state.baseTopology).toEqual({ foo: 'bar' });
    expect(state.nodes['olt-1']).toEqual(
      expect.objectContaining({
        refId: 'olt-1',
        type: 'OLT',
        origin: 'MANUAL',
      }),
    );
    expect(state.edges['edge-1']).toEqual(
      expect.objectContaining({
        refId: 'edge-1',
        fromRef: 'olt-1',
        toRef: 'odp-1',
        type: 'FEEDER',
      }),
    );
  });

  it('normalizes API node and edge arrays into store records', () => {
    const apiPayload = {
      projectId: 'project-123',
      nodes: [
        {
          id: 'olt-1',
          type: 'OLT',
          origin: 'AUTO',
          coordinates: [100.1, -0.1],
          properties: {
            refId: 'olt-1',
            nodeMeta: 'x',
          },
        },
        {
          refId: 'odp-1',
          type: 'ODP',
          origin: 'MANUAL',
          coordinates: [100.2, -0.2],
          properties: {
            capture: 'y',
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          refId: 'edge-1',
          fromRef: 'olt-1',
          toRef: 'odp-1',
          type: 'DROP',
          origin: 'MANUAL',
          coordinates: [
            [100.1, -0.1],
            [100.2, -0.2],
          ],
          properties: {
            route: 'z',
          },
        },
      ],
    };

    useDesignStore.getState().hydrate('design-2', apiPayload, { areaType: 'RURAL' }, { summary: 'ok' }, { type: 'FeatureCollection', features: [] });
    const state = useDesignStore.getState();

    expect(state.projectId).toBe('project-123');
    expect(state.nodes['olt-1']).toEqual(
      expect.objectContaining({
        refId: 'olt-1',
        type: 'OLT',
      }),
    );
    expect(state.nodes['odp-1']).toEqual(
      expect.objectContaining({
        refId: 'odp-1',
        type: 'ODP',
      }),
    );
    expect(state.edges['edge-1']).toEqual(
      expect.objectContaining({
        refId: 'edge-1',
        fromRef: 'olt-1',
        toRef: 'odp-1',
        type: 'DROP',
      }),
    );
    expect(state.edges['edge-1']?.coordinates).toEqual([
      [100.1, -0.1],
      [100.2, -0.2],
    ]);
  });
});
