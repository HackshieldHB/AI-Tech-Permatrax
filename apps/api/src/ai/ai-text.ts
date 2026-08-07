/** Shared text normalization for PAI NLU modules (avoids circular imports). */

export function normalizeId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
