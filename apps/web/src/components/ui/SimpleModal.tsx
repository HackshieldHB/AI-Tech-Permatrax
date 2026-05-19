'use client';

import React, { type ReactNode } from 'react';

/** Minimal modal — pola M7 untuk confirm / formulir singkat */
export function SimpleModal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-modal-title"
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 id="simple-modal-title" className="font-bold text-slate-800 text-lg">
            {title}
          </h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 px-2" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
