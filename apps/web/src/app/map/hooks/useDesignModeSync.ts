import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { useDesignStore } from '../../../store/useDesignStore';
import { edgesToFeatureCollections } from '../utils/geojsonMapper';

function setEdgeSources(map: maplibregl.Map): void {
  const { edges } = useDesignStore.getState();
  const { feederFeatures, distributionFeatures } = edgesToFeatureCollections(edges);

  const feederSource = map.getSource('topo-feeder') as maplibregl.GeoJSONSource | undefined;
  if (feederSource) {
    feederSource.setData({
      type: 'FeatureCollection',
      features: feederFeatures,
    });
  }

  const distSource = map.getSource('topo-distribution') as maplibregl.GeoJSONSource | undefined;
  if (distSource) {
    distSource.setData({
      type: 'FeatureCollection',
      features: distributionFeatures,
    });
  }
}

export function useDesignModeSync(params: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  editMode: boolean;
}): void {
  const { mapRef, editMode } = params;

  useEffect(() => {
    if (!editMode) return;
    const map = mapRef.current;
    if (!map) return;

    setEdgeSources(map);
    const unsubscribe = useDesignStore.subscribe((state, prev) => {
      if (state.edges !== prev.edges) {
        const activeMap = mapRef.current;
        if (activeMap) setEdgeSources(activeMap);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [editMode, mapRef]);
}
