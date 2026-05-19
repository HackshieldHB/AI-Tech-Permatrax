'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global Application Error Catch:', error);
  }, [error]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 border-4 border-red-500/20 absolute inset-0 z-[1000]">
      <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-lg w-full text-center">
        <h2 className="text-3xl font-bold text-slate-800 mb-2">Frontend Crashed</h2>
        <p className="text-slate-500 mb-6 font-medium">A critical client-side error occurred in the React DOM hierarchy.</p>
        
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-left overflow-x-auto text-sm font-mono mb-8 border border-red-100 shadow-inner">
          {error.message || 'Unknown generic client mismatch error'}
        </div>

        <button
          onClick={() => reset()}
          className="bg-primary hover:bg-primary-hover text-white font-semibold py-3 px-8 rounded-lg shadow-md transition-colors w-full"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
