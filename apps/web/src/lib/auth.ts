import { useAuthStore } from '../store/authStore';

/** Server-side only: URL to Nest including `/api` (Next.js Route Handlers, RSC). */
function getServerApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:3001/api';
}

/**
 * Browser API URL pointing to the Nest backend.
 * - Dev (localhost): same-origin `/api` so Next.js rewrites handle the proxy.
 * - Production (public host): uses NEXT_PUBLIC_API_URL so requests go directly
 *   to the correct path (e.g. /Permatrax/api) rather than the app root /api.
 */
function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (process.env.NODE_ENV === 'production' && envUrl?.includes('localhost:3001')) {
      throw new Error('INVALID API CONFIG: NEXT_PUBLIC_API_URL leaks localhost:3001 in production');
    }
    // Production: use the full configured API URL so basePath is respected
    if (process.env.NODE_ENV === 'production' && envUrl) {
      return envUrl;
    }
    return '/api';
  }
  return getServerApiUrl();
}

/**
 * Base path prefix for Next.js Route Handlers (set-cookie, clear-cookie, refresh).
 * In dev this is '' (empty) so `/api/auth/set-cookie` works as-is.
 * In production with basePath (e.g. /Permatrax) it must be prepended so the
 * browser reaches the correct Next.js route handler instead of the root app.
 */
export const NEXT_ROUTE_BASE = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || '';

/**
 * Host for Socket.IO / MapLibre tile URLs / legacy absolute file URLs.
 * - localhost dev: Nest on :3001 (WS + tiles do not go through Next fetch).
 * - ngrok / public host: same browser origin so HTTP tile URLs hit Next → rewrite `/api/*`.
 */
export function getExternalApiHost(): string {
  if (typeof window === 'undefined') {
    return getServerApiUrl().replace(/\/api\/?$/, '');
  }
  const { protocol, hostname, port } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3001`;
  }
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
}

/** Base URL including `/api` (matches Nest global prefix). */
export const API_URL = getApiUrl();

// FIX: read from in-memory Zustand store only — never localStorage — to prevent XSS token theft
export const getAccessToken = (): string | null =>
  typeof window === 'undefined' ? null : (useAuthStore.getState().accessToken ?? null);

export const clearTokens = async (): Promise<void> => {
  // Clean up any stale tokens from previous versions that may still be in storage
  if (typeof window !== 'undefined') {
    localStorage.removeItem('accessToken');
    sessionStorage.removeItem('accessToken');
  }
  useAuthStore.getState().setToken('');
  await fetch(`${NEXT_ROUTE_BASE}/api/auth/clear-cookie`, { method: 'POST' });
};

function persistRefreshedAccessToken(token: string) {
  if (typeof window === 'undefined') return;
  // FIX: store in memory only (Zustand state), not localStorage
  useAuthStore.getState().setToken(token);
}

export const refreshAccessToken = async (userId: string): Promise<string | null> => {
  try {
    const res = await fetch(`${NEXT_ROUTE_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.accessToken) {
      persistRefreshedAccessToken(data.accessToken);
    }
    return data.accessToken ?? null;
  } catch {
    return null;
  }
};

// FIX: wrap raw `fetch` with a helpful error when the backend is unreachable
async function fetchOrExplain(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    // FIX: browsers throw TypeError("Failed to fetch") when the network layer can't reach the server
    const message =
      `Tidak dapat terhubung ke backend.\n` +
      `URL: ${API_URL}\n\n` +
      `Solusi:\n` +
      `1. Pastikan backend jalan: cd apps/api && npm run start:dev\n` +
      `2. Jika pakai ngrok: .\\scripts\\start-ngrok.ps1\n` +
      `3. Restart frontend setelah ngrok/URL berubah`;
    const wrapped = new Error(message) as Error & { cause?: unknown; isNetworkError?: boolean };
    wrapped.cause = err;
    wrapped.isNetworkError = true;
    throw wrapped;
  }
}

// Attach to every API call — auto-refresh if 401
export const apiFetch = async (
  path: string,
  options: RequestInit = {},
  userId?: string
): Promise<Response> => {
  const base = getApiUrl();
  const fullUrl = `${base}${path}`;
  if (
    typeof window !== 'undefined' &&
    process.env.NODE_ENV === 'production' &&
    fullUrl.includes('localhost:3001')
  ) {
    throw new Error('INVALID API CONFIG: leaking backend URL');
  }

  const token = getAccessToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    // Don't set Content-Type for FormData — browser must set it with the multipart boundary
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    'ngrok-skip-browser-warning': 'true', // FIX 4: bypass ngrok browser interstitial on API calls
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let res = await fetchOrExplain(fullUrl, { ...options, headers });

  if (process.env.NEXT_PUBLIC_DEBUG_API === 'true') {
    // eslint-disable-next-line no-console -- gated fail-safe for ngrok / proxy debugging
    console.log('API CALL ->', fullUrl);
  }

  if (res.status === 401 && userId) {
    const newToken = await refreshAccessToken(userId);
    if (newToken) {
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      res = await fetchOrExplain(fullUrl, { ...options, headers: retryHeaders }); // FIX: same guard on refresh retry
    }
  }

  return res;
};
