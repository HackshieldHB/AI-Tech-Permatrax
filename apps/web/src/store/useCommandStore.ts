import { toast } from 'sonner';
import { create } from 'zustand';
import { apiPatch, apiPost, apiDelete } from '../lib/api';
import { applyCommand, revertCommand } from '../app/map/commands/core';
import type { Command, MoveNodeCommand, AddNodeCommand, DeleteNodeCommand, AddEdgeCommand, DeleteEdgeCommand, UpdateNodeCommand, UpdateEdgeCommand } from '../app/map/commands/types';
import { useDesignStore } from './useDesignStore';
import { clientDebugLog } from '../lib/clientDebugLog';

type ApiPatchFn = (path: string, body: unknown) => Promise<unknown>;
type ApiPostFn = (path: string, body: unknown) => Promise<unknown>;
type ApiDeleteFn = (path: string) => Promise<unknown>;

let patchImpl: ApiPatchFn = apiPatch;
let postImpl: ApiPostFn = apiPost;
let deleteImpl: ApiDeleteFn = apiDelete;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Controls UX toasts for flush (debounced auto-save stays quiet). */
export type FlushInteraction = 'toolbar-save' | 'panel-refresh' | 'edit-mode-exit' | 'debounced-auto';

export interface CommandStoreState {
  applied: Command[];
  undone: Command[];
  pendingPersist: Command[];
  inFlight: Set<string>;
  isSaving: boolean;
  dispatch: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  flush: (opts?: { interaction?: FlushInteraction }) => Promise<void>;
  clearStacks: () => void;
}

function commandKey(cmd: Command): string {
  if (cmd.type === 'MoveNode') {
    return cmd.refId;
  }
  return JSON.stringify(cmd);
}

// TODO(design-mode-phase-2biii): commandsEqual currently does deep equality on the
// command shape. If two structurally-identical commands exist in `applied` (rare:
// move-back-and-forth), the filter on PATCH failure removes both. Consider adding a
// uuid `id` field to Command for precise identification.
function commandsEqual(a: Command, b: Command): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function invertCommand(cmd: Command): Command {
  if (cmd.type === 'MoveNode') {
    return {
      ...cmd,
      fromCoords: [cmd.toCoords[0], cmd.toCoords[1]],
      toCoords: [cmd.fromCoords[0], cmd.fromCoords[1]],
    };
  }
  return cmd;
}

function scheduleDebouncedFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void useCommandStore.getState().flush({ interaction: 'debounced-auto' });
  }, 1000);
}

export const useCommandStore = create<CommandStoreState>()((set, get) => ({
  applied: [],
  undone: [],
  pendingPersist: [],
  inFlight: new Set<string>(),
  isSaving: false,

  dispatch: (cmd) => {
    const { nodes, edges } = useDesignStore.getState();
    const next = applyCommand({ nodes, edges }, cmd);
    useDesignStore.setState({ nodes: next.nodes, edges: next.edges });

    set((s) => ({
      applied: [...s.applied, cmd],
      undone: [],
      pendingPersist: [...s.pendingPersist, cmd],
    }));
  },

  undo: () => {
    const { applied, undone, isSaving } = get();
    if (applied.length === 0 || isSaving) return;
    const cmd = applied[applied.length - 1]!;
    const state = useDesignStore.getState();
    const nextState = revertCommand(state, cmd);
    useDesignStore.setState({ nodes: nextState.nodes, edges: nextState.edges });
    set({
      applied: applied.slice(0, -1),
      undone: [cmd, ...undone],
      pendingPersist: [...get().pendingPersist, cmd],
    });
  },

  redo: () => {
    const { applied, undone, isSaving } = get();
    if (undone.length === 0 || isSaving) return;
    const cmd = undone[0]!;
    const state = useDesignStore.getState();
    const nextState = applyCommand(state, cmd);
    useDesignStore.setState({ nodes: nextState.nodes, edges: nextState.edges });
    set({
      applied: [...applied, cmd],
      undone: undone.slice(1),
      pendingPersist: [...get().pendingPersist, cmd],
    });
  },

  flush: async (opts?: { interaction?: FlushInteraction }) => {
    const interaction: FlushInteraction = opts?.interaction ?? 'debounced-auto';
    const { pendingPersist, inFlight, isSaving } = get();
    if (isSaving) return;
    if (pendingPersist.length === 0) {
      if (interaction === 'toolbar-save') {
        return;
      }
      return;
    }

    set({ isSaving: true });
    const toastId = 'flush-save';
    
    const state = useDesignStore.getState();

    if (!state.projectId || state.projectId.trim() === '') {
      toast.error('Masukkan Project ID terlebih dahulu.', { id: 'flush-no-project' });
      set({ isSaving: false });
      return;
    }

    let currentDesignId = state.designId;
    if (!currentDesignId) {
      const calcInputs = state.calcInputs as Record<string, unknown> | null;
      // FIX 1: Require kalkulasi for new designs. If user sees this error while editing,
      // they likely have Edit Mode ON and need to turn it OFF before saving.
      if (!calcInputs?.areaType) {
        toast.error(
          'Non-aktifkan Edit Mode menjadi OFF terlebih dahulu sebelum melakukan Simpan.',
          { id: 'flush-no-design' },
        );
        set({ isSaving: false });
        return;
      }
      try {
        toast.info('Membuat draft desain baru...', { id: 'save-progress' });
        const geometry = {
          type: 'FeatureCollection',
          features: [
            ...Object.values(state.nodes).map(n => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: n.coordinates },
              properties: { kind: 'node', refId: n.refId, type: n.type, origin: n.origin, ...n.properties }
            })),
            ...Object.values(state.edges).map(e => ({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: e.coordinates },
              properties: { kind: 'edge', refId: e.refId, type: e.type, origin: e.origin, fromRef: e.fromRef, toRef: e.toRef, ...e.properties, length_m: e.properties.length_m ?? 1, route_source: e.properties.route_source ?? 'manual' }
            }))
          ]
        };
        const created = await postImpl('/design', {
          projectId: state.projectId,
          calcInputs: state.calcInputs || {},
          baseTopology: state.baseTopology || { type: 'FeatureCollection', features: [] },
          geometry,
          sketchTopology: state.sketchTopology
        }) as { id: string };
        
        currentDesignId = created.id;
        useDesignStore.setState({ designId: currentDesignId });
        toast.dismiss('save-progress');
      } catch (err: any) {
        let errMsg = 'Terjadi kesalahan, silakan coba lagi.';

        if (err.response?.data) {
          const data = err.response.data;
          if (Array.isArray(data)) {
            // Validation errors array: [{message: "..."}, ...]
            errMsg = data
              .map((e: any) => e.message || e.constraints
                ? Object.values(e.constraints || {}).join(', ')
                : JSON.stringify(e))
              .filter(Boolean)
              .join(' • ');
          } else if (typeof data === 'object' && data.message) {
            // Single error object: {message: "..."}
            errMsg = Array.isArray(data.message)
              ? data.message
                  .map((m: unknown) =>
                    typeof m === 'string' ? m : ((m as Record<string, unknown>)?.message as string | undefined) ?? JSON.stringify(m)
                  )
                  .join(' • ')
              : typeof data.message === 'string'
              ? data.message
              : JSON.stringify(data.message);
          } else if (typeof data === 'string') {
            errMsg = data;
          }
        } else if (err.message) {
          errMsg = err.message;
        }

        toast.error(`Gagal membuat desain: ${errMsg}`);
        set({ isSaving: false });
        return;
      }
    }

    try {
      // 1. Group by refId
      const commandsByRefId = new Map<string, Command[]>();
      for (const cmd of pendingPersist) {
        if (!commandsByRefId.has(cmd.refId)) {
          commandsByRefId.set(cmd.refId, []);
        }
        commandsByRefId.get(cmd.refId)!.push(cmd);
      }

      const ready: Command[][] = [];
      const deferred: Command[] = [];

      // 2. Resolve intent per refId
      const refIds = Array.from(commandsByRefId.keys());
      for (const refId of refIds) {
        const group = commandsByRefId.get(refId)!;
        if (inFlight.has(refId)) {
          deferred.push(...group);
          continue;
        }

        let hasAdd = false;
        let hasDelete = false;
        let lastMove: MoveNodeCommand | null = null;
        let addCmd: AddNodeCommand | null = null;
        let deleteCmd: DeleteNodeCommand | null = null;
        let addEdgeCmd: AddEdgeCommand | null = null;
        let deleteEdgeCmd: DeleteEdgeCommand | null = null;
        let lastUpdateNode: UpdateNodeCommand | null = null;
        let lastUpdateEdge: UpdateEdgeCommand | null = null;

        for (const cmd of group) {
          if (cmd.type === 'AddNode') {
            hasAdd = true;
            addCmd = cmd as AddNodeCommand;
          } else if (cmd.type === 'DeleteNode') {
            hasDelete = true;
            deleteCmd = cmd as DeleteNodeCommand;
          } else if (cmd.type === 'MoveNode') {
            lastMove = cmd as MoveNodeCommand;
          } else if (cmd.type === 'AddEdge') {
            addEdgeCmd = cmd as AddEdgeCommand;
          } else if (cmd.type === 'DeleteEdge') {
            deleteEdgeCmd = cmd as DeleteEdgeCommand;
          } else if (cmd.type === 'UpdateNode') {
            lastUpdateNode = cmd as UpdateNodeCommand;
          } else if (cmd.type === 'UpdateEdge') {
            lastUpdateEdge = cmd as UpdateEdgeCommand;
          }
        }

        if (hasDelete) {
          if (hasAdd) {
            // Net-zero, drop from network
          } else {
            ready.push([deleteCmd!]);
          }
        } else if (hasAdd) {
          const seq: Command[] = [addCmd!];
          if (lastMove) seq.push(lastMove);
          ready.push(seq);
        } else if (lastMove) {
          ready.push([lastMove]);
        } else if (addEdgeCmd) {
          ready.push([addEdgeCmd]);
        } else if (deleteEdgeCmd) {
          ready.push([deleteEdgeCmd]);
        } else if (lastUpdateNode) {
          ready.push([lastUpdateNode]);
        } else if (lastUpdateEdge) {
          ready.push([lastUpdateEdge]);
        }
      }

      // 3. SORT ready queue: AddNode/MoveNode must happen before AddEdge
      // Priority: Nodes (Add/Move) = 1, Edges (Add/Move) = 2, Deletes = 3 (order doesn't strictly matter for deletes here but let's keep it clean)
      ready.sort((a, b) => {
        const aType = a[0]!.type;
        const bType = b[0]!.type;
        
        const getPriority = (type: string) => {
          if (type.includes('Node')) return 1;
          if (type.includes('Edge')) return 2;
          return 3;
        };
        
        return getPriority(aType) - getPriority(bType);
      });

      if (ready.length === 0) {
        clientDebugLog('GIS_FLUSH', {
          projectId: state.projectId ?? '',
          pendingCommandCount: pendingPersist.length,
          readyGroupCount: 0,
          deferredCount: deferred.length,
          interaction,
        });
        const showReadyEmptyToast =
          interaction === 'toolbar-save' ||
          interaction === 'edit-mode-exit' ||
          interaction === 'panel-refresh';
        if (showReadyEmptyToast) {
          toast.info('Tidak ada perubahan untuk disimpan', { id: 'flush-ready-empty' });
        }
        set({ pendingPersist: deferred, isSaving: false });
        return;
      }

      clientDebugLog('GIS_FLUSH', {
        projectId: state.projectId ?? '',
        pendingCommandCount: pendingPersist.length,
        readyGroupCount: ready.length,
        interaction,
      });

      const newInFlightRefIds = ready.map((seq) => seq[0]!.refId);
      set({
        pendingPersist: deferred,
        inFlight: new Set([...Array.from(inFlight), ...newInFlightRefIds]),
      });

      toast.loading('Menyimpan perubahan...', { id: toastId });

      // 3. Sequential processing to satisfy "halts on error" and queue resilience
      for (let i = 0; i < ready.length; i++) {
        const seq = ready[i]!;
        const refId = seq[0]!.refId;

        try {
          // Use currentDesignId established above
          const designId = currentDesignId;
          if (!designId) throw new Error('No designId - cannot persist');

          for (const cmd of seq) {
            if (cmd.type === 'AddNode') {
              const addCmd = cmd as AddNodeCommand;
              await postImpl(`/design/${designId}/nodes`, {
                refId: addCmd.refId,
                type: addCmd.nodeType,
                origin: 'MANUAL',
                coordinates: addCmd.coordinates,
                properties: {},
              });
            } else if (cmd.type === 'DeleteNode') {
              await deleteImpl(`/design/${designId}/nodes/${cmd.refId}`);
            } else if (cmd.type === 'MoveNode') {
              const moveCmd = cmd as MoveNodeCommand;
              await patchImpl(`/design/${designId}/nodes/${moveCmd.refId}`, {
                coordinates: moveCmd.toCoords,
              });
            } else if (cmd.type === 'AddEdge') {
              const edgeCmd = cmd as AddEdgeCommand;
              await postImpl(`/design/${designId}/edges`, {
                refId: edgeCmd.refId,
                fromRef: edgeCmd.fromRef,
                toRef: edgeCmd.toRef,
                type: edgeCmd.edgeType,
                origin: 'MANUAL',
                coordinates: edgeCmd.coordinates,
                properties: {},
                length_m: 1,
                route_source: 'manual',
              });
            } else if (cmd.type === 'DeleteEdge') {
              await deleteImpl(`/design/${designId}/edges/${cmd.refId}`);
            } else if (cmd.type === 'UpdateNode') {
              const updateCmd = cmd as UpdateNodeCommand;
              await patchImpl(`/design/${designId}/nodes/${updateCmd.refId}`, {
                properties: updateCmd.newProperties,
              });
            } else if (cmd.type === 'UpdateEdge') {
              const updateCmd = cmd as UpdateEdgeCommand;
              await patchImpl(`/design/${designId}/edges/${updateCmd.refId}`, {
                properties: updateCmd.newProperties,
              });
            }
          }

          set((s) => {
            const nextInFlight = new Set(s.inFlight);
            nextInFlight.delete(refId);
            return { inFlight: nextInFlight };
          });

        } catch (error: any) {
          const errorData = error.response?.data || error;
          
          // 1. Force the raw error into the browser console so we can inspect it
          console.error("🔥 RAW BACKEND ERROR:", JSON.stringify(errorData, null, 2));

          // 2. Try to parse it for the toast safely
          let errMsg = "Cek Console (F12) untuk detail error.";
          if (errorData?.message) {
            if (Array.isArray(errorData.message)) {
              errMsg = errorData.message.map((m: any) => typeof m === 'object' ? JSON.stringify(m) : m).join(" | ");
            } else {
              errMsg = typeof errorData.message === 'object' ? JSON.stringify(errorData.message) : errorData.message;
            }
          }
          
          toast.error(`Gagal menyimpan: ${errMsg}`, { id: toastId });

          // FAIL: Stop and put remaining 'ready' items back into pendingPersist
          const remainingReady = ready.slice(i);
          const remainingCommands: Command[] = [];
          remainingReady.forEach(group => remainingCommands.push(...group));

          set((s) => {
            const nextInFlight = new Set(s.inFlight);
            ready.forEach(group => nextInFlight.delete(group[0]!.refId));
            return {
              pendingPersist: [...remainingCommands, ...s.pendingPersist],
              inFlight: nextInFlight,
              isSaving: false,
            };
          });
          return; 
        }
      }

      // Save sketch topology
      try {
        await patchImpl(`/design/${currentDesignId}`, {
          sketchTopology: state.sketchTopology
        });
      } catch (err) {
        console.warn("Gagal menyimpan sketch topology:", err);
        // Do not halt the whole save process just for the sketch
      }

      set({ isSaving: false });
      clientDebugLog('GIS_FLUSH', {
        phase: 'success',
        designId: currentDesignId ?? '',
        projectId: state.projectId ?? '',
        batches: ready.length,
        interaction,
      });
      toast.success('Desain berhasil disimpan', { id: toastId });

      // FIX: Clear designId after successful save so next Simpan creates a NEW record
      useDesignStore.setState({ designId: null });

      if (get().pendingPersist.length > 0) {
        scheduleDebouncedFlush();
      }
    } catch (err) {
      set({ isSaving: false });
      toast.error('Terjadi kesalahan sistem saat menyimpan', { id: toastId });
    }
  },

  clearStacks: () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    set({
      applied: [],
      undone: [],
      pendingPersist: [],
      inFlight: new Set<string>(),
    });
  },
}));

export function __setCommandStoreApiPatchForTest(nextPatchImpl: ApiPatchFn): void {
  patchImpl = nextPatchImpl;
}
export function __setCommandStoreApiPostForTest(nextPostImpl: ApiPostFn): void {
  postImpl = nextPostImpl;
}
export function __setCommandStoreApiDeleteForTest(nextDeleteImpl: ApiDeleteFn): void {
  deleteImpl = nextDeleteImpl;
}

export function __resetCommandStoreApiPatchForTest(): void {
  patchImpl = apiPatch;
  postImpl = apiPost;
  deleteImpl = apiDelete;
}

// React to useDesignStore.clear() - when designId clears, clear our stacks too.
// This avoids a circular import (useCommandStore already imports useDesignStore).
useDesignStore.subscribe((state, prev) => {
  if (state.designId === null && prev.designId !== null) {
    useCommandStore.getState().clearStacks();
  }
});
