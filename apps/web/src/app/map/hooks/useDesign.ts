import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { FeatureCollection } from 'geojson';
import { toast } from 'sonner';

import { apiGet, apiPost } from '../../../lib/api';
import { useDesignStore } from '../../../store/useDesignStore';
import type { FtthCalcApiResponse } from './types';

export type DesignSummary = {
  id: string;
  projectId: string;
  status: string;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DesignDetail = DesignSummary & {
  calcInputs: {
    areaType: 'URBAN' | 'SUBURBAN' | 'RURAL';
    areaRadiusMeters: number;
    polygonAreaSqM?: number;
    backbonePoint: [number, number];
    targetPoint: [number, number];
    polygonCentroid?: [number, number];
  };
  baseTopology: any;
  geometry: FeatureCollection;
  sketchTopology: any;
};

export type BuildDesignGeometryInput = {
  backbone: [number, number];
  odcPoint: [number, number];
  odpPositions: [number, number][];
  feederCoords: [number, number][];
  distRoutes: [number, number][][];
};

export type SaveArgs = {
  projectId: string;
  calcInputs: {
    areaType: 'URBAN' | 'SUBURBAN' | 'RURAL';
    areaRadiusMeters: number;
    polygonAreaSqM?: number;
    backbonePoint: [number, number];
    targetPoint: [number, number];
    polygonCentroid?: [number, number];
  };
  // Persist full calcResult so loaded design can repopulate result cards.
  baseTopology: FtthCalcApiResponse;
  geometrySources: BuildDesignGeometryInput;
};

export interface UseDesignReturn {
  saveDesignAsDraft: (args: SaveArgs) => Promise<{ id: string }>;
  // FIX: projectId is now optional - when not provided, fetches ALL designs for user
  listDesigns: (projectId?: string) => Promise<DesignSummary[]>;
  loadDesign: (designId: string) => Promise<void>;
  loadedDesignId: string | null;
  designsList: DesignSummary[];
  listLoading: boolean;
  listError: string | null;
  detailLoading: boolean;
  detailError: string | null;
  saveLoading: boolean;
  saveError: string | null;
}

function isFullCalcResult(value: unknown): value is FtthCalcApiResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    'summary' in v &&
    'homepass' in v &&
    'route' in v &&
    'cable' in v &&
    'equipment' in v &&
    'powerBudget' in v &&
    'topology' in v
  );
}

export function useDesign(args: {
  buildDesignGeometry: (args: BuildDesignGeometryInput) => FeatureCollection;
  renderStoredDesign: (args: { baseTopology: object; geometry: FeatureCollection; calcInputs?: object }) => Promise<void>;
  setCalcResult: Dispatch<SetStateAction<FtthCalcApiResponse | null>>;
  setCalcMode: Dispatch<SetStateAction<'idle' | 'backbone' | 'target' | 'result'>>;
  setBackbonePoint: Dispatch<SetStateAction<[number, number] | null>>;
  setTargetPoint: Dispatch<SetStateAction<[number, number] | null>>;
}): UseDesignReturn {
  const {
    buildDesignGeometry,
    renderStoredDesign,
    setCalcResult,
    setCalcMode,
    setBackbonePoint,
    setTargetPoint,
  } = args;

  const [loadedDesignId, setLoadedDesignId] = useState<string | null>(null);
  const [designsList, setDesignsList] = useState<DesignSummary[]>([]);

  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveDesignAsDraft = useCallback(
    async (saveArgs: SaveArgs): Promise<{ id: string }> => {
      setSaveLoading(true);
      setSaveError(null);
      try {
        const geometry = buildDesignGeometry(saveArgs.geometrySources);
        const created = await apiPost<DesignDetail>('/design', {
          projectId: saveArgs.projectId.trim(),
          calcInputs: saveArgs.calcInputs,
          baseTopology: saveArgs.baseTopology,
          geometry,
        });
        setLoadedDesignId(created.id);
        useDesignStore.getState().hydrate(created.id, created, created.calcInputs, created.baseTopology, created.sketchTopology);
        // FIX: Clear designId after save so next Simpan creates a NEW record (not update)
        useDesignStore.setState({ designId: null });
        setDesignsList((prev) => {
          const without = prev.filter((d) => d.id !== created.id);
          return [created, ...without];
        });
        return { id: created.id };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Gagal menyimpan design';
        setSaveError(msg);
        toast.error(msg);
        throw err;
      } finally {
        setSaveLoading(false);
      }
    },
    [buildDesignGeometry],
  );

  const listDesigns = useCallback(async (projectId?: string): Promise<DesignSummary[]> => {
    setListLoading(true);
    setListError(null);
    try {
      // FIX: When projectId is provided, filter by it; otherwise fetch ALL designs for user
      const params: Record<string, string> = {};
      if (projectId?.trim()) {
        params.projectId = projectId.trim();
      }
      const list = await apiGet<DesignSummary[]>('/design', params);
      setDesignsList(list);
      return list;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil daftar design';
      setListError(msg);
      toast.error(msg);
      throw err;
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDesign = useCallback(
    async (designId: string): Promise<void> => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const detail = await apiGet<DesignDetail>(`/design/${designId}`);
        // GIS Issue 6: draft sketch-only (disimpan tanpa kalkulasi) tidak punya
        // geometri OLT/ODC — cukup hydrate sketch, jangan render topologi.
        const isSketchOnly =
          (detail.baseTopology as { sketchOnly?: boolean } | null)?.sketchOnly === true ||
          !(detail.geometry?.features?.length > 0);
        if (isSketchOnly) {
          useDesignStore.getState().hydrate(detail.id, detail, detail.calcInputs, detail.baseTopology, detail.sketchTopology);
          setLoadedDesignId(detail.id);
          useDesignStore.getState().setSketchMode(true);
          toast.success('Draft sketch termuat — mode sketch diaktifkan');
          return;
        }
        await renderStoredDesign({
          baseTopology: detail.baseTopology,
          geometry: detail.geometry,
          calcInputs: detail.calcInputs,
        });
        useDesignStore.getState().hydrate(detail.id, detail, detail.calcInputs, detail.baseTopology, detail.sketchTopology);
        setLoadedDesignId(detail.id);
        setCalcMode('result');
        setBackbonePoint(detail.calcInputs.backbonePoint);
        setTargetPoint(detail.calcInputs.targetPoint);
        if (isFullCalcResult(detail.baseTopology)) {
          setCalcResult(detail.baseTopology);
        } else {
          // TODO(design-mode-phase-3c): Backfill old records where baseTopology only stored topology subtree.
          toast.warning('Design termuat, tapi ringkasan hasil kalkulasi lama tidak lengkap.');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat design';
        setDetailError(msg);
        toast.error(msg);
        throw err;
      } finally {
        setDetailLoading(false);
      }
    },
    [renderStoredDesign, setBackbonePoint, setCalcMode, setCalcResult, setTargetPoint],
  );

  return {
    saveDesignAsDraft,
    listDesigns,
    loadDesign,
    loadedDesignId,
    designsList,
    listLoading,
    listError,
    detailLoading,
    detailError,
    saveLoading,
    saveError,
  };
}
