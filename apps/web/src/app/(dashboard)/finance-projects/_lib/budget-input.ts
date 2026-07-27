/** Parse Indonesian / loose budget input to a number (supports decimals).
 * Examples: "1.500.000,50" → 1500000.5 | "250000,75" → 250000.75 | "1000.5" → 1000.5
 */
export function parseBudgetInput(display: string): number {
  const raw = display.trim().replace(/\s/g, '');
  if (!raw) return 0;
  if (raw.includes(',')) {
    const [intPart, ...rest] = raw.split(',');
    const dec = rest.join('').replace(/\D/g, '').slice(0, 2);
    const int = intPart.replace(/\./g, '').replace(/[^\d-]/g, '');
    if (!int && !dec) return 0;
    return Number(`${int || '0'}.${dec || '0'}`) || 0;
  }
  // No comma: if multiple dots → thousand separators; single trailing decimal → US-style
  const dots = (raw.match(/\./g) ?? []).length;
  if (dots > 1) {
    return Number(raw.replace(/\./g, '').replace(/[^\d-]/g, '')) || 0;
  }
  if (dots === 1) {
    const [a, b = ''] = raw.split('.');
    // Treat as decimal when fractional part is 1–2 digits; else thousand sep
    if (b.length > 0 && b.length <= 2 && /^\d+$/.test(b) && a.replace(/\D/g, '').length <= 3) {
      return Number(`${a.replace(/[^\d-]/g, '') || '0'}.${b}`) || 0;
    }
    if (b.length > 0 && b.length <= 2 && /^\d+$/.test(b)) {
      // Ambiguous large int with ,xx via dot — prefer decimal for budget precision
      return Number(`${a.replace(/[^\d-]/g, '') || '0'}.${b}`) || 0;
    }
    return Number(raw.replace(/\./g, '').replace(/[^\d-]/g, '')) || 0;
  }
  return Number(raw.replace(/[^\d-]/g, '')) || 0;
}

/** Live format while typing: keep digits + optional decimal comma, format thousands. */
export function formatBudgetInput(raw: string): string {
  const cleaned = raw.replace(/[^\d,.]/g, '');
  if (!cleaned) return '';
  // Normalize: prefer comma as decimal if present
  let intDigits = '';
  let decDigits = '';
  if (cleaned.includes(',')) {
    const idx = cleaned.indexOf(',');
    intDigits = cleaned.slice(0, idx).replace(/\D/g, '');
    decDigits = cleaned.slice(idx + 1).replace(/\D/g, '').slice(0, 2);
  } else if (cleaned.includes('.')) {
    // Allow typing decimal with last dot when short fraction
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1].length <= 2 && parts[0].replace(/\D/g, '').length > 0) {
      intDigits = parts[0].replace(/\D/g, '');
      decDigits = parts[1].replace(/\D/g, '').slice(0, 2);
    } else {
      intDigits = cleaned.replace(/\D/g, '');
    }
  } else {
    intDigits = cleaned.replace(/\D/g, '');
  }
  if (!intDigits && !decDigits) return '';
  const intFormatted = intDigits
    ? Number(intDigits).toLocaleString('id-ID')
    : '0';
  if (cleaned.includes(',') || (cleaned.includes('.') && decDigits.length > 0)) {
    // Keep trailing comma while user is typing decimals
    if (raw.endsWith(',') || raw.endsWith('.')) return `${intFormatted},`;
    return decDigits.length > 0 ? `${intFormatted},${decDigits}` : intFormatted;
  }
  return intFormatted;
}
