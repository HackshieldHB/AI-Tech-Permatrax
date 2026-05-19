import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** Map-only state. Auth lives in useAuthStore (`permatrax-auth`). */
interface AppState {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  mapViewState: MapViewState;
  setMapViewState: (state: Partial<MapViewState>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      projectId: null,
      setProjectId: (id) => set({ projectId: id }),
      mapViewState: {
        longitude: 106.8272,
        latitude: -6.1751,
        zoom: 12,
      },
      setMapViewState: (newState) =>
        set((state) => ({ mapViewState: { ...state.mapViewState, ...newState } })),
    }),
    {
      name: 'permatrack-map-storage',
      partialize: (state) => ({
        projectId: state.projectId,
        mapViewState: state.mapViewState,
      }),
    },
  ),
);
