'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { apiPatch, apiPost } from '../../../lib/api';
import { useDesignStore } from '../../../store/useDesignStore';
import { useCommandStore } from '../../../store/useCommandStore';
import { useAuthStore } from '../../../store/authStore';
import type { SaveArgs, UseDesignReturn } from '../hooks/useDesign';
import type { FtthCalcApiResponse } from '../hooks/types';
import type { LastRenderedGeometry } from '../hooks/useTopologyRender';

export type SavedDesignsPanelProps = Pick<
  UseDesignReturn,
  | 'saveDesignAsDraft'
  | 'listDesigns'
  | 'loadDesign'
  | 'loadedDesignId'
  | 'designsList'
  | 'listLoading'
  | 'listError'
  | 'detailLoading'
  | 'detailError'
  | 'saveLoading'
  | 'saveError'
> & {
  calcResult: FtthCalcApiResponse | null;
  topologyRendered: boolean;
  lastRenderedGeometry: LastRenderedGeometry;
  areaType: string;
  areaRadius: number;
  polygonAreaSqM: number | null;
  polygonCentroid: [number, number] | null;
  backbonePoint: [number, number] | null;
  targetPoint: [number, number] | null;
};

function formatDesignDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SavedDesignsPanel(props: SavedDesignsPanelProps) {
  const {
    saveDesignAsDraft,
    listDesigns,
    loadDesign,
    loadedDesignId,
    designsList,
    listLoading,
    listError,
    detailLoading,
    detailError,
    calcResult,
    topologyRendered,
    lastRenderedGeometry,
    areaType,
    areaRadius,
    polygonAreaSqM,
    polygonCentroid,
    backbonePoint,
    targetPoint,
  } = props;

  const hasPending = useCommandStore((s) => s.pendingPersist.length > 0);
  const isSaving = useCommandStore((s) => s.isSaving);
  const designId = useDesignStore((s) => s.designId);
  const isEditMode = useDesignStore((s) => s.editMode);

  const projectIdStore = useDesignStore((s) => s.projectId);
  const setProjectIdStore = useDesignStore((s) => s.setProjectId);
  const projectId = projectIdStore || '';
  const setProjectId = (val: string) => setProjectIdStore(val || null);

  const [projectIdModalOpen, setProjectIdModalOpen] = useState(false);
  const [pendingProjectIdInput, setPendingProjectIdInput] = useState('');

  const calcReady = Boolean(
    calcResult &&
      topologyRendered &&
      lastRenderedGeometry &&
      backbonePoint &&
      targetPoint &&
      areaType,
  );

  // GIS Issue 6: sketch/gambar manual bisa disimpan sebagai draft TANPA harus
  // kalkulasi dulu — alur simpan tidak lagi memaksa kalkulasi.
  const hasSketch = useDesignStore(
    (s) => (s.sketchTopology?.features?.length ?? 0) > 0,
  );

  const canSave = (calcReady || hasPending || Boolean(designId) || hasSketch) && !isEditMode;

  const buildSaveArgs = (pid: string): SaveArgs | null => {
    if (!calcReady || !calcResult || !backbonePoint || !targetPoint || !lastRenderedGeometry) {
      return null;
    }
    const areaTypeNorm = areaType as 'URBAN' | 'SUBURBAN' | 'RURAL';
    return {
      projectId: pid,
      calcInputs: {
        areaType: areaTypeNorm,
        areaRadiusMeters: areaRadius,
        backbonePoint,
        targetPoint,
        ...(polygonAreaSqM != null ? { polygonAreaSqM: polygonAreaSqM } : {}),
        ...(polygonCentroid ? { polygonCentroid } : {}),
      },
      baseTopology: calcResult,
      geometrySources: {
        backbone: lastRenderedGeometry.oltCoords,
        odcPoint: lastRenderedGeometry.odcCoords,
        odpPositions: lastRenderedGeometry.odpPositions,
        feederCoords: lastRenderedGeometry.feederCoords,
        distRoutes: lastRenderedGeometry.distRoutes,
      },
    };
  };

  const refetchDesignList = async (pid: string) => {
    await listDesigns(pid.trim());
  };

  const persistCalcAndDesign = async (pid: string) => {
    const saveArgs = buildSaveArgs(pid);
    if (!saveArgs) {
      toast.error('Data kalkulasi belum lengkap.');
      return;
    }
    await saveDesignAsDraft(saveArgs);
    await refetchDesignList(pid);
    toast.success('Desain berhasil disimpan');
    // FIX: Clear designId after save so next Simpan creates a NEW record
    useDesignStore.setState({ designId: null });
  };

  const runSave = async (pid: string) => {
    const trimmed = pid.trim();
    setProjectIdStore(trimmed);

    if (hasPending) {
      await useCommandStore.getState().flush({ interaction: 'toolbar-save' });
      if (trimmed) await refetchDesignList(trimmed);
      return;
    }

    if (calcReady) {
      await persistCalcAndDesign(trimmed);
      return;
    }

    if (designId) {
      const state = useDesignStore.getState();
      await apiPatch(`/design/${designId}`, {
        sketchTopology: state.sketchTopology,
      });
      if (trimmed) await refetchDesignList(trimmed);
      toast.success('Desain berhasil disimpan');
      // FIX: Clear designId after save so next Simpan creates a NEW record
      useDesignStore.setState({ designId: null });
      return;
    }

    // GIS Issue 6: simpan sketch-only draft (belum ada kalkulasi) — dibuat
    // sebagai design kosong lalu sketch dilekatkan; tidak memaksa kalkulasi.
    if (hasSketch) {
      const state = useDesignStore.getState();
      const created = await apiPost<{ id: string }>('/design', {
        projectId: trimmed,
        // stub penanda sketch-only (backbone/target [0,0] = belum dikalkulasi)
        calcInputs: {
          areaType: 'URBAN',
          areaRadiusMeters: 0,
          backbonePoint: [0, 0],
          targetPoint: [0, 0],
        },
        baseTopology: { sketchOnly: true },
        geometry: { type: 'FeatureCollection', features: [] },
      });
      await apiPatch(`/design/${created.id}`, { sketchTopology: state.sketchTopology });
      if (trimmed) await refetchDesignList(trimmed);
      toast.success('Sketch tersimpan sebagai draft (tanpa kalkulasi)');
    }
  };

  const handleSaveClick = () => {
    if (!canSave || isSaving) return;
    const pid = projectId.trim();
    if (!pid) {
      setPendingProjectIdInput('');
      setProjectIdModalOpen(true);
      return;
    }
    void runSave(pid);
  };

  const handleLoadList = async () => {
    // FIX: Allow fetching ALL designs for user when no projectId is entered
    // When projectId is provided, filters by it; otherwise returns ALL designs
    const { pendingPersist, flush } = useCommandStore.getState();
    if (pendingPersist.length > 0) {
      await flush({ interaction: 'panel-refresh' });
    }
    try {
      const list = await listDesigns(projectId.trim() || undefined);
      if (list.length === 0) {
        toast.info('Tidak ada design tersimpan. Lakukan kalkulasi lalu Simpan.');
      } else {
        toast.success(`${list.length} design ditemukan`);
      }
    } catch {
      /* errors toasted in hooks */
    }
  };

  const { user } = useAuthStore();

  // UX: Auto-fetch saved designs on component mount when user is authenticated
  useEffect(() => {
    if (user?.id) {
      handleLoadList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleDeleteDesign = async (designIdToDelete: string) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus desain ini?')) return;
    try {
      const { apiDelete } = await import('../../../lib/api');
      await apiDelete(`/design/${designIdToDelete}`);
      toast.success('Desain berhasil dihapus');
      if (loadedDesignId === designIdToDelete) {
        useDesignStore.getState().clear();
      }
      if (projectId.trim()) {
        await listDesigns(projectId.trim());
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Gagal menghapus desain');
    }
  };

  const saveButtonTitle = useMemo(() => {
    if (isSaving) return 'Sedang menyimpan...';
    if (isEditMode) return 'Non-aktifkan Edit Mode menjadi OFF terlebih dahulu sebelum melakukan Simpan.';
    if (!canSave) return 'Lakukan kalkulasi atau gambar sketch terlebih dahulu';
    if (hasPending) return 'Simpan perubahan design';
    if (!calcReady && hasSketch) return 'Simpan sketch sebagai draft (tanpa kalkulasi)';
    return 'Simpan hasil kalkulasi dan design';
  }, [canSave, hasPending, isSaving, isEditMode, calcReady, hasSketch]);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#6B7280',
            display: 'block',
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Project ID
        </label>
        <input
          type="text"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Masukkan projectId"
          style={{
            width: '100%',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            color: '#111',
          }}
        />
        <p style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>
          * Dapat diisi saat menyimpan jika belum diisi
        </p>
      </div>

      <button
        type="button"
        onClick={handleSaveClick}
        disabled={!canSave || isSaving}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #F59E0B',
          background: isSaving ? '#F9FAFB' : canSave ? '#FEF3C7' : '#F9FAFB',
          color: isSaving ? '#9CA3AF' : canSave ? '#92400E' : '#9CA3AF',
          cursor: canSave && !isSaving ? 'pointer' : 'not-allowed',
          fontSize: 12,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
        title={saveButtonTitle}
      >
        <span>{isSaving ? '⏳' : '💾'}</span>
        {isSaving ? 'Menyimpan...' : 'Simpan'}
      </button>

      <button
        type="button"
        onClick={() => void handleLoadList()}
        disabled={!projectId.trim() || listLoading}
        title={!projectId.trim() ? 'Masukkan Project ID terlebih dahulu' : ''}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #E5E7EB',
          background: 'white',
          color: !projectId.trim() || listLoading ? '#9CA3AF' : '#374151',
          cursor: !projectId.trim() || listLoading ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {listLoading ? 'Memuat daftar...' : '🔄 Muat daftar'}
      </button>

      {listError && <div style={{ fontSize: 11, color: '#DC2626' }}>{listError}</div>}
      {detailError && <div style={{ fontSize: 11, color: '#DC2626' }}>{detailError}</div>}

      {designsList.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {designsList.map((item) => {
            const active = loadedDesignId === item.id;
            return (
              <div key={item.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => void loadDesign(item.id)}
                  disabled={detailLoading}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 10,
                    border: active ? '1px solid #93C5FD' : '1px solid #E5E7EB',
                    background: active ? '#EFF6FF' : 'white',
                    padding: '9px 10px',
                    cursor: detailLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{item.projectId}</span>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        background: '#F3F4F6',
                        color: '#374151',
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280' }}>
                    v{item.version} · {formatDesignDate(item.createdAt)}
                  </div>
                  {active && (
                    <div style={{ marginTop: 6, fontSize: 10, color: '#2563EB', fontWeight: 600 }}>
                      {detailLoading ? 'Memuat...' : '✓ Sedang aktif'}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteDesign(item.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 70,
                    background: 'none',
                    border: 'none',
                    color: '#EF4444',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 5px',
                    borderRadius: 4,
                  }}
                >
                  Hapus
                </button>
              </div>
            );
          })}
        </div>
      )}

      {listLoading && designsList.length === 0 && (
        <div style={{ fontSize: 12, color: '#6B7280' }}>Memuat daftar...</div>
      )}
      {!listLoading && !listError && designsList.length === 0 && (
        <div style={{ fontSize: 12, color: '#6B7280' }}>Belum ada design tersimpan.</div>
      )}

      {projectIdModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setProjectIdModalOpen(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 20,
              width: 'min(360px, 90vw)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111' }}>Project ID diperlukan</h3>
            <p style={{ margin: '8px 0 12px', fontSize: 12, color: '#6B7280' }}>
              Masukkan Project ID untuk menyimpan design ke database.
            </p>
            <input
              type="text"
              autoFocus
              value={pendingProjectIdInput}
              onChange={(e) => setPendingProjectIdInput(e.target.value)}
              placeholder="Project ID"
              style={{
                width: '100%',
                border: '1px solid #E5E7EB',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 12,
                marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setProjectIdModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #E5E7EB',
                  background: 'white',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!pendingProjectIdInput.trim() || isSaving}
                onClick={() => {
                  const pid = pendingProjectIdInput.trim();
                  if (!pid) return;
                  setProjectIdModalOpen(false);
                  void runSave(pid);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#F59E0B',
                  color: '#92400E',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: pendingProjectIdInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}