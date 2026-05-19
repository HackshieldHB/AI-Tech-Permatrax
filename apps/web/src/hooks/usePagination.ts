'use client'; // MODIFIED: state-based pagination hook

import { useCallback, useState } from 'react'; // MODIFIED: local state only

// MODIFIED: simplified pagination state without URL coupling
export function usePagination(defaultLimit = 20) {
  const [page, setPageState] = useState(1); // NEW: local page state
  const [limit, setLimitState] = useState(defaultLimit); // NEW: local limit state

  const setPage = useCallback((p: number) => { // NEW: guard against invalid page
    setPageState(Math.max(1, p));
  }, []);

  const setLimit = useCallback((l: number) => { // NEW: reset page when limit changes
    setLimitState(Math.max(1, l));
    setPageState(1);
  }, []);

  const reset = useCallback(() => { // NEW: explicit reset helper
    setPageState(1);
  }, []);

  return { page, limit, setPage, setLimit, reset }; // MODIFIED: return simple API
}
