import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sd = path.join(__dirname, '_slices');
const read = (f) => fs.readFileSync(path.join(sd, f), 'utf8');

const polyHelpers = read('calc-helpers-polygon.txt').replace(
  'function clearPolygonFromMap',
  'export function clearPolygonFromMap',
);
const clearCalcGraphics = read('clearCalcGraphics.txt');
const startCalcBlock = read('startCalc.txt');
const polyEffect = read('calc-polygon-effect.txt');
const calcClick = read('calc-click-effect.txt');
const runCalculation = read('runCalc.txt');

const src = `import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import { apiGet, apiPost } from '../../../lib/api';
import { toast } from 'sonner';
import type { FtthCalcApiResponse, OsmElement } from './types';

${polyHelpers}

export function useCalculation(args: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  clearTopology: () => void;
  renderTopology: (
    result: FtthCalcApiResponse,
    backbone: [number, number],
    target: [number, number],
    drawnPolygon?: [number, number][] | null,
  ) => Promise<void>;
  /** Lifted so useTopologyRender can subscribe before calculation runs (explicit wiring, no globals). */
  inputMode: 'radius' | 'polygon';
  setInputMode: Dispatch<SetStateAction<'radius' | 'polygon'>>;
  polygonPoints: [number, number][];
  setPolygonPoints: Dispatch<SetStateAction<[number, number][]>>;
  isDrawingPolygon: boolean;
  setIsDrawingPolygon: Dispatch<SetStateAction<boolean>>;
  polygonAreaSqM: number | null;
  setPolygonAreaSqM: Dispatch<SetStateAction<number | null>>;
  polygonCentroid: [number, number] | null;
  setPolygonCentroid: Dispatch<SetStateAction<[number, number] | null>>;
}) {
  const {
    mapRef,
    clearTopology,
    renderTopology,
    inputMode,
    setInputMode,
    polygonPoints,
    setPolygonPoints,
    isDrawingPolygon,
    setIsDrawingPolygon,
    polygonAreaSqM,
    setPolygonAreaSqM,
    polygonCentroid,
    setPolygonCentroid,
  } = args;
  const backboneMarkerRef = useRef<maplibregl.Marker | null>(null);
  const targetMarkerRef = useRef<maplibregl.Marker | null>(null);
  const polygonMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [calcMode, setCalcMode] = useState<'idle' | 'backbone' | 'target' | 'result'>('idle');
  const [backbonePoint, setBackbonePoint] = useState<[number, number] | null>(null);
  const [targetPoint, setTargetPoint] = useState<[number, number] | null>(null);
  const [areaType, setAreaType] = useState<'URBAN' | 'SUBURBAN' | 'RURAL'>('URBAN');
  const [areaRadius, setAreaRadius] = useState(300);
  const [calcResult, setCalcResult] = useState<FtthCalcApiResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [nearestBackbone, setNearestBackbone] = useState<OsmElement | null>(null);

${clearCalcGraphics}

${startCalcBlock}

${polyEffect}

${calcClick}

${runCalculation}

  return {
    polygonMarkersRef,
    calcMode,
    setCalcMode,
    backbonePoint,
    setBackbonePoint,
    targetPoint,
    setTargetPoint,
    areaType,
    setAreaType,
    areaRadius,
    setAreaRadius,
    calcResult,
    setCalcResult,
    calculating,
    nearestBackbone,
    setNearestBackbone,
    runCalculation,
    handleStartCalc,
    startCalculation,
    clearCalcGraphics,
  };
}
`;

fs.writeFileSync(path.join(__dirname, 'useCalculation.ts'), src, 'utf8');
console.log('wrote useCalculation.ts');
