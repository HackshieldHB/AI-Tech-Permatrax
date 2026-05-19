import { edgesToFeatureCollections, extractHomepassPoints, homepassPointsToFeatureCollection } from './geojsonMapper';

describe('geojsonMapper', () => {
  it('maps saved API edges into normalized feeder and distribution GeoJSON features', () => {
    const apiEdges = {
      'edge-1': {
        refId: 'edge-1',
        type: 'FEEDER',
        fromRef: 'olt-1',
        toRef: 'odc-1',
        coordinates: '[[100.1, -0.1], [100.2, -0.2]]',
        properties: {},
      },
      'edge-2': {
        refId: 'edge-2',
        type: 'DISTRIBUTION',
        fromRef: 'odc-1',
        toRef: 'odp-1',
        geometry: {
          type: 'LineString',
          coordinates: [[100.2, -0.2], [100.3, -0.3]],
        },
        properties: { coordinates: '[[100.2, -0.2], [100.3, -0.3]]' },
      },
    };

    const { feederFeatures, distributionFeatures } = edgesToFeatureCollections(apiEdges);

    expect(feederFeatures).toHaveLength(1);
    expect(distributionFeatures).toHaveLength(1);

    expect(feederFeatures[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [100.1, -0.1],
        [100.2, -0.2],
      ],
    });

    expect(distributionFeatures[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [100.2, -0.2],
        [100.3, -0.3],
      ],
    });
  });

  it('extracts homepass points from nested topology payloads and builds a feature collection', () => {
    const baseTopology = {
      homepassPoints: [{ coords: [100.4, -0.4] }],
    };
    const calcInputs = {
      homepassPoints: [{ coords: [100.5, -0.5] }],
    };

    const points = extractHomepassPoints(baseTopology, calcInputs);
    expect(points).toEqual([[100.4, -0.4]]);

    const featureCollection = homepassPointsToFeatureCollection(points);
    expect(featureCollection.features).toHaveLength(1);
    expect(featureCollection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [100.4, -0.4],
    });
  });
});
