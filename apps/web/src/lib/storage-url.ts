/**
 * Convert a stored file URL (or absolute URL from DB) into a path relative
 * to API_BASE so `downloadAuthenticatedBlob` can prepend API_BASE cleanly.
 *
 * The stored URL varies by environment:
 *   Prod  (no basePath): https://permatrax.tech/api/files/po/... → /files/po/...
 *   Dev VPS (basePath=/Permatrax): https://aitech-ilt.co.id/Permatrax/api/files/po/... → /files/po/...
 *
 * Strategy: strip everything up to and including the first "/api" segment.
 * This is safe because all file URLs in this codebase follow the pattern
 * [optional-basePath]/api/[resource-path], so the first "/api/" is always
 * the correct split point.
 *
 * FIX (dev VPS): the old `startsWith('/api/')` check only matched prod URLs.
 * On dev the pathname is `/Permatrax/api/files/...` which failed the check,
 * returned the full path unchanged, and then API_BASE (`…/Permatrax/api`)
 * was prepended → double-prefix → 404.
 */
export function storageUrlToApiPath(url: string): string {
  if (!url) return '';

  // Normalise to pathname only
  let p: string;
  if (url.startsWith('/')) {
    p = url;
  } else {
    try {
      p = new URL(url).pathname || '';
    } catch {
      return url;
    }
  }

  // Find the first "/api/" segment and strip everything up to and including it.
  //   /api/files/po/...            → /files/po/...  (prod, no basePath)
  //   /Permatrax/api/files/po/...  → /files/po/...  (dev, basePath=/Permatrax)
  //   /custom/base/api/files/...   → /files/...     (any other basePath)
  const apiIdx = p.indexOf('/api/');
  if (apiIdx !== -1) {
    return p.slice(apiIdx + 4); // +4 skips the "/api" part, keeps leading "/"
  }

  // Already relative (e.g. /files/po/... passed directly) — return as-is
  return p;
}
