'use client';

import { useEffect } from 'react';

/** TEMP: if this never appears in the browser console, HTML is not from this Next app (e.g. wrong ngrok upstream). */
export function AppLoadedLog() {
  useEffect(() => {
    // eslint-disable-next-line no-console -- intentional diagnostic
    console.log('NEXT APP LOADED');
  }, []);
  return null;
}
