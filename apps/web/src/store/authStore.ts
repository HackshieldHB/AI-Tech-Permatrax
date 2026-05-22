import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch, NEXT_ROUTE_BASE } from '../lib/auth';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  fiberType: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
  address?: string | null;
  signatureUrl?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  featureAccess: string[];
  featureAccessReady: boolean;
  setUser: (user: AuthUser) => void;
  setToken: (token: string) => void;
  setAuth: (token: string, user: AuthUser) => void;
  setFeatureAccess: (keys: string[]) => void;
  setFeatureAccessReady: (v: boolean) => void;
  canAccess: (featureKey: string) => boolean;
  fetchFeatureAccess: () => Promise<void>;
  resetFeatureAccess: () => void;
  hydrate: () => void;
  logout: () => Promise<void>;
  setLoading: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,
      featureAccess: [],
      featureAccessReady: false,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ accessToken: token }),
      setAuth: (token, user) => set({ accessToken: token, user }),
      setFeatureAccess: (keys) => set({ featureAccess: keys }),
      setFeatureAccessReady: (v) => set({ featureAccessReady: v }),
      canAccess: (featureKey: string) => {
        const { featureAccess, featureAccessReady } = get();
        if (!featureAccessReady) return false;
        return featureAccess.includes(featureKey);
      },
      resetFeatureAccess: () => set({ featureAccess: [], featureAccessReady: false }),
      fetchFeatureAccess: async () => {
        const flagsRes = await apiFetch('/feature-flags/my-access');
        if (flagsRes.ok) {
          const body = await flagsRes.json();
          const keys = Array.isArray(body.features) ? body.features : [];
          set({ featureAccess: keys, featureAccessReady: true });
        } else {
          set({ featureAccess: [], featureAccessReady: false });
        }
      },
      setLoading: (v) => set({ isLoading: v }),

      hydrate: async () => {
        if (typeof window === 'undefined') return;
        // FIX: access token is no longer persisted in localStorage (XSS risk).
        // Clean up any stale tokens left by previous versions, then silently refresh
        // from the HttpOnly refresh-token cookie to restore the in-memory access token.
        localStorage.removeItem('accessToken');
        sessionStorage.removeItem('accessToken');
        const userId = get().user?.id;
        if (!userId) return;
        try {
          const res = await fetch(`${NEXT_ROUTE_BASE}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.accessToken) set({ accessToken: data.accessToken });
          }
        } catch {
          // silent fail — user will be redirected to login on the next 401
        }
      },

      logout: async () => {
        await fetch(`${NEXT_ROUTE_BASE}/api/auth/clear-cookie`, { method: 'POST' }).catch(() => {});
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          sessionStorage.removeItem('accessToken');
          localStorage.removeItem('permatrack-auth-storage');
        }
        set({ user: null, accessToken: null, featureAccess: [], featureAccessReady: false });
      },
    }),
    {
      name: 'permatrax-auth',
      // FIX: accessToken intentionally excluded from persistence — storing JWTs in
      // localStorage exposes them to XSS. Token lives in memory only; hydrate() silently
      // refreshes it from the HttpOnly refresh-token cookie on page load.
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
);
