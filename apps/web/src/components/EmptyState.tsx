'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

// NEW: Empty list placeholder
export function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-slate-500">
      <Icon className="w-12 h-12 text-slate-300 mb-3" strokeWidth={1.25} />
      <h3 className="text-lg font-bold text-slate-800">{title}</h3>
      <p className="text-sm mt-1 max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2 rounded-xl bg-[#0F1B2D] text-white text-sm font-bold"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
