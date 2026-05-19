/**
 * Ubah URL file di DB (biasanya .../api/files/...) menjadi path untuk fetch bertoken (API_BASE + path).
 */
export function storageUrlToApiPath(url: string): string {
  if (!url) return '';
  if (url.startsWith('/')) {
    return url.startsWith('/api/') ? url.slice(4) : url;
  }
  try {
    const u = new URL(url);
    const p = u.pathname || '';
    return p.startsWith('/api/') ? p.slice(4) : p;
  } catch {
    return url;
  }
}
