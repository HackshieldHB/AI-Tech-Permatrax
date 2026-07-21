import { apiFetch, API_URL, getExternalApiHost, NEXT_ROUTE_BASE } from './auth';
import { useAuthStore } from '../store/authStore';
import { notify } from './toast';
import type { PaginatedResponse } from '../types/api.types';

// FIX: single source of truth for API URLs — re-exported so every module can import from one place
/** Base API URL including `/api` (matches Nest global prefix). */
export const API_BASE: string = API_URL;
/** Origin for Socket.IO / tiles / absolute file bases (browser: ngrok origin OR localhost:3001). */
export const API_HOST: string =
  typeof window !== 'undefined' ? getExternalApiHost() : API_URL.replace(/\/api$/, '');
/** Files base URL — serves locally uploaded assets. */
export const FILES_BASE: string =
  process.env.NEXT_PUBLIC_FILES_URL || `${API_HOST}/api/files`;

function getUserId() {
  return useAuthStore.getState().user?.id;
}

// FIX Issue 3/4: rewrite stored localhost:3001 / localhost:3000 URLs to current API host so
// files uploaded on the server (e.g. saved with http://localhost:3001 in DB) remain reachable
// when the frontend is served via ngrok, LAN IP, or a different host.
export function fixFileUrl(url: string | null | undefined): string {
  if (!url) return ''; // FIX: null-safe
  if (url.startsWith('/')) return `${API_HOST}${url}`; // FIX: relative path → prepend API host
  if (url.includes('localhost:3001')) {
    return url.replace(/https?:\/\/localhost:3001/g, API_HOST); // FIX: rewrite legacy localhost:3001
  }
  if (url.includes('localhost:3000')) {
    return url.replace(/https?:\/\/localhost:3000/g, API_HOST); // FIX: rewrite legacy localhost:3000
  }
  if (url.includes('127.0.0.1:3001')) {
    return url.replace(/https?:\/\/127\.0\.0\.1:3001/g, API_HOST); // FIX: rewrite 127.0.0.1:3001 too
  }
  return url;
}

async function parseResponseBody<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn('[api] Failed to parse JSON response body', e);
    return null;
  }
}

async function handle<T>(res: Response, opts?: { silentForbidden?: boolean }): Promise<T> {
  if (res.status === 401) {
    await useAuthStore.getState().logout();
    // C7.3: Use basePath-aware redirect — NEXT_ROUTE_BASE = '/Permatrax' on dev VPS, '' locally
    if (typeof window !== 'undefined') window.location.href = `${NEXT_ROUTE_BASE}/login`;
    throw new Error('Unauthorized');
  }
  if (res.status === 403) {
    if (!opts?.silentForbidden) notify.unauthorized(); // FIX: optional — designer bootstrap must not spam access toasts
    const err = new Error('Forbidden') as Error & { status?: number };
    err.status = 403; // FIX: callers can branch without toast
    throw err;
  }
  if (res.status >= 500) {
    notify.networkError();
    const t = await res.text();
    throw new Error(t || 'Server error');
  }
  if (!res.ok) {
    const err = (await parseResponseBody<Record<string, unknown>>(res)) ?? {};
    const message = typeof err.message === 'string'
      ? err.message
      : res.statusText;
    const wrappedError = new Error(message) as Error & { response?: unknown; status?: number }; // FIX: preserve API error body for UI field-level parsing
    wrappedError.response = err;
    wrappedError.status = res.status; // FIX: let callers treat 404 as “not initialized” vs hard failure
    throw wrappedError;
  }
  const body = await parseResponseBody<T>(res);
  return (body ?? ({} as T));
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean>,
  options?: { silentForbidden?: boolean },
): Promise<T> {
  let q = '';
  if (params && Object.keys(params).length > 0) {
    const sp = new URLSearchParams(); // FIX: stringify all param values safely
    Object.entries(params).forEach(([k, v]) => sp.set(k, String(v)));
    q = `?${sp.toString()}`;
  }
  const res = await apiFetch(`${path}${q}`, {}, getUserId());
  return handle<T>(res, options);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(
    path,
    { method: 'POST', body: JSON.stringify(body) },
    getUserId()
  );
  return handle<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(
    path,
    { method: 'PATCH', body: JSON.stringify(body) },
    getUserId()
  );
  return handle<T>(res);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(
    path,
    { method: 'PUT', body: JSON.stringify(body) },
    getUserId()
  );
  return handle<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await apiFetch(path, { method: 'DELETE' }, getUserId());
  return handle<T>(res);
}

/** POST multipart/form-data (file uploads) — Content-Type boundary set by the browser. */
export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: formData }, getUserId());
  return handle<T>(res);
}

/** Upload foto profil (multipart) — POST /auth/avatar */
export async function uploadAvatarFile(file: File): Promise<{ success: boolean; data: Record<string, unknown> }> {
  const storeModule = await import('../store/authStore');
  const accessToken = storeModule.useAuthStore.getState().accessToken;
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/auth/avatar`, {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'ngrok-skip-browser-warning': 'true',
    },
    body: formData,
  });

  return handle<{ success: boolean; data: Record<string, unknown> }>(res);
}

/** FIX: Unduh PDF/binary dengan JWT — hindari window.open + Origin null */
export async function downloadAuthenticatedBlob(path: string): Promise<Blob> {
  const storeModule = await import('../store/authStore'); // FIX: hindari circular import
  const accessToken = storeModule.useAuthStore.getState().accessToken; // FIX
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'ngrok-skip-browser-warning': 'true', // FIX
    },
  });
  if (!res.ok) {
    const t = await res.text(); // FIX
    throw new Error(t || `Download gagal (${res.status})`); // FIX
  }
  return res.blob(); // FIX
}

/** Trigger browser download from authenticated GET (finance reports, etc.). */
export async function apiDownload(path: string, filename?: string): Promise<void> {
  const storeModule = await import('../store/authStore');
  const accessToken = storeModule.useAuthStore.getState().accessToken;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'ngrok-skip-browser-warning': 'true',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Download gagal (${res.status})`);
  }
  const cd = res.headers.get('Content-Disposition');
  const m = cd?.match(/filename="?([^";]+)"?/i);
  const fromHeader = m?.[1]?.trim();
  const finalName = filename ?? fromHeader ?? 'unduhan';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function uploadFile( // FIX: Upload a file to local storage via PermaTrax API
  file: File,
  module: string,
  subfolder?: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '.bin';
  const key = subfolder
    ? `${module}/${year}/${subfolder}/${Date.now()}-${file.name}`
    : `${module}/${year}/${Date.now()}-${file.name}`;
  void ext;

  const formData = new FormData();
  formData.append('file', file);

  const apiBase = API_BASE; // FIX: use centralized API_BASE — no duplicate fallback strings

  const storeModule = await import('../store/authStore'); // FIX: dynamic import to avoid circular dependency
  const accessToken = storeModule.useAuthStore.getState().accessToken; // FIX: use named zustand store export

  let res: Response;
  try {
    res = await fetch(
      `${apiBase}/storage/upload?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'ngrok-skip-browser-warning': 'true', // FIX 4: bypass ngrok interstitial for multipart uploads
          // FIX: never set Content-Type for FormData — browser must send multipart boundary
        },
        body: formData,
      },
    );
  } catch {
    // FIX: explain network errors for uploads the same way we do for JSON API calls
    throw new Error(
      `Upload gagal: backend tidak terjangkau.\n` +
      `URL: ${apiBase}\n` +
      `Periksa backend / ngrok lalu coba lagi.`,
    );
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const msg =
      typeof err.message === 'string'
        ? err.message
        : Array.isArray(err.message)
          ? err.message.join(', ')
          : `Upload gagal (${res.status})`;
    throw new Error(msg);
  }

  const data = (await res.json()) as { url: string };
  return data.url;
}

export async function apiGetPaginated<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>
): Promise<PaginatedResponse<T>> {
  const searchParams = new URLSearchParams(); // MODIFIED: explicit serialization for mixed param types
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') { // FIX: skip empty values
        searchParams.set(k, String(v));
      }
    });
  }
  const url = searchParams.size > 0 ? `${path}?${searchParams.toString()}` : path; // NEW: pass built URL directly
  return apiGet<PaginatedResponse<T>>(url);
}

export type { PaginatedResponse };
