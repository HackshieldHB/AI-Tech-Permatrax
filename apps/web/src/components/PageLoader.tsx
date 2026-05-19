'use client';

import React from 'react';

type PageLoaderProps = {
  rows?: number;
  columns?: number;
};

// NEW: Skeleton shimmer for loading tables
export function PageLoader({ rows = 5, columns = 4 }: PageLoaderProps) {
  return (
    <div className="w-full space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-2">
          {Array.from({ length: columns }).map((_, ci) => (
            <div
              key={ci}
              className="h-10 flex-1 rounded-lg bg-slate-200/70 animate-pulse"
              style={{ animationDelay: `${(ri + ci) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
