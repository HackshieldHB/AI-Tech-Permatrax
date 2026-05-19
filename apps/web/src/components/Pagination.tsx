'use client';

import React from 'react'; // MODIFIED: explicit React import for CSSProperties typing

type PaginationProps = {
  total: number;
  page: number;
  limit: number;
  onPageChange: (p: number) => void;
  onLimitChange?: (l: number) => void;
};

// MODIFIED: richer pagination controls + consistent styling
export function Pagination({ total, page, limit, onPageChange, onLimitChange }: PaginationProps) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1 && total <= limit) return null;

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  const pages: Array<number | '...'> = []; // NEW: compact page list with ellipsis
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i += 1) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const btnStyle = (active: boolean, disabled?: boolean): React.CSSProperties => ({ // NEW: single button style builder
    minWidth: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    fontSize: 13,
    border: active
      ? '1.5px solid var(--color-border-info)'
      : '0.5px solid var(--color-border-tertiary)',
    background: active ? 'var(--color-background-info)' : 'none',
    color: active
      ? 'var(--color-text-info)'
      : disabled
        ? 'var(--color-border-secondary)'
        : 'var(--color-text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    padding: '0 8px',
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
        fontSize: 13,
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <span style={{ color: 'var(--color-text-secondary)' }}>
        Menampilkan {start}–{end} dari {total} data
      </span>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => page > 1 && onPageChange(page - 1)}
          disabled={page <= 1}
          style={btnStyle(false, page <= 1)}
        >
          ←
        </button>

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dot-${String(i)}`} style={{ padding: '0 4px', color: 'var(--color-text-secondary)' }}>
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPageChange(p)}
              style={btnStyle(p === page)}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => page < totalPages && onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={btnStyle(false, page >= totalPages)}
        >
          →
        </button>
      </div>

      {onLimitChange ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Per halaman:</span>
          <select
            value={limit}
            onChange={(e) => {
              onLimitChange(Number(e.target.value));
              onPageChange(1);
            }}
            style={{ padding: '4px 8px', borderRadius: 6, fontSize: 13 }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
