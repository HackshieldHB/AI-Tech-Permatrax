'use client';

import React from 'react';

/** Alur utama Phase 3 — beda untuk PROJECT_REQUEST vs STOCK_RESTOCK */

type Trigger = 'PROJECT_REQUEST' | 'STOCK_RESTOCK';

const PROJECT_STEPS = [
  { key: 'draft', label: 'Draft', icon: '📝' },
  { key: 'admin', label: 'Admin Stok', icon: '📋' },
  { key: 'purchasing', label: 'Purchasing', icon: '🏷️' },
  { key: 'ops', label: 'Ops', icon: '⚙️' },
  { key: 'gm', label: 'GM', icon: '👑' },
  { key: 'finance', label: 'Finance / PO', icon: '💳' },
  { key: 'purchased', label: 'Dibeli', icon: '🚚' },
  { key: 'verify', label: 'Verifikasi', icon: '🔍' },
  { key: 'done', label: 'Selesai', icon: '✅' },
] as const;

const RESTOCK_STEPS = [
  { key: 'draft', label: 'Draft', icon: '📝' },
  { key: 'purchasing', label: 'Purchasing', icon: '🏷️' },
  { key: 'gm', label: 'GM', icon: '👑' },
  { key: 'finance', label: 'Finance / PO', icon: '💳' },
  { key: 'purchased', label: 'Dibeli', icon: '🚚' },
  { key: 'verify', label: 'Verifikasi', icon: '🔍' },
  { key: 'done', label: 'Selesai', icon: '✅' },
] as const;

function statusStepIndex(trigger: Trigger, status: string): number {
  if (status === 'CANCELLED') return -3;
  if (status.startsWith('REJECTED')) return -2;

  if (trigger === 'STOCK_RESTOCK') {
    const S = RESTOCK_STEPS;
    switch (status) {
      case 'DRAFT':
        return 0;
      case 'PENDING_PURCHASING_INPUT':
        return 1;
      case 'PENDING_GM_APPROVAL':
      case 'REJECTED_BY_GM':
        return 2;
      case 'PENDING_PAYMENT_RECEIPT':
      case 'PENDING_FINANCE':
        return 3;
      case 'PURCHASED':
        return 4;
      case 'PENDING_VERIFICATION':
        return 5;
      case 'FULFILLED':
        return 6;
      default:
        return 1;
    }
  }

  const P = PROJECT_STEPS;
  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
    case 'STOCK_AVAILABLE':
    case 'PARTIAL_STOCK':
    case 'NO_STOCK':
      return 0;
    case 'PENDING_ADMIN_STOCK':
      return 1;
    case 'PENDING_PURCHASING_INPUT':
      return 2;
    case 'PENDING_OPS_APPROVAL':
    case 'REJECTED_BY_OPS':
      return 3;
    case 'PENDING_GM_APPROVAL':
    case 'REJECTED_BY_GM':
      return 4;
    case 'PENDING_PAYMENT_RECEIPT':
    case 'PENDING_FINANCE':
      return 5;
    case 'PURCHASED':
      return 6;
    case 'PENDING_VERIFICATION':
      return 7;
    case 'FULFILLED':
      return 8;
    default:
      return 0;
  }
}

export function OrderWorkflowStepper({
  orderTrigger,
  status,
  cancelReason,
}: {
  orderTrigger: Trigger;
  status: string;
  cancelReason?: string | null;
}) {
  const steps = orderTrigger === 'STOCK_RESTOCK' ? RESTOCK_STEPS : PROJECT_STEPS;
  let activeIdx = statusStepIndex(orderTrigger, status);

  if (status === 'CANCELLED') {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-bold text-amber-900">Order dibatalkan</p>
        {cancelReason ? <p className="text-amber-800 mt-1">Alasan: {cancelReason}</p> : null}
      </div>
    );
  }

  if (status.startsWith('REJECTED')) {
    const ops = status.includes('OPS');
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm mb-4">
        <p className="font-bold text-red-900">{ops ? 'Ditolak Ops' : 'Ditolak GM'}</p>
        <p className="text-red-800 mt-1">Silakan revisi dari Admin Stok sesuai alasan di atas.</p>
      </div>
    );
  }

  if (activeIdx < 0) activeIdx = 0;

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 overflow-x-auto mb-6">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">
        Alur {orderTrigger === 'STOCK_RESTOCK' ? 'Restock Gudang' : 'Proyek'}
      </p>
      <div className="flex items-center gap-1 min-w-max">
        {steps.map((s, i, arr) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1 max-w-[88px]">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm border-2 transition-colors ${
                    isDone ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : isActive ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white text-slate-400'
                  }`}
                  title={`${s.label}${isDone ? ' — selesai' : ''}${isActive ? ' — aktif' : ''}`}
                >
                  {isDone ? '✓' : s.icon}
                </div>
                <span className="text-[9px] font-medium text-slate-600 text-center leading-tight">{s.label}</span>
              </div>
              {i < arr.length - 1 ? (
                <div className={`w-4 md:w-6 h-0.5 mb-5 shrink-0 ${isDone ? 'bg-emerald-500' : 'bg-slate-200'}`} />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
