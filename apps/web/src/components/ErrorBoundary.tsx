'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import Link from 'next/link';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

// NEW: Catches render errors in dashboard subtree
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV === 'development';
      return (
        <div className="min-h-[40vh] flex flex-col items-center justify-center p-8 text-center">
          <h1 className="text-xl font-black text-slate-900">Terjadi kesalahan</h1>
          <p className="text-slate-500 mt-2 max-w-md">
            {isDev ? this.state.message : 'Silakan muat ulang halaman atau kembali ke beranda.'}
          </p>
          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 rounded-xl bg-[#0F1B2D] text-white font-bold text-sm"
            >
              Coba lagi
            </button>
            <Link href="/dashboard" className="px-4 py-2 rounded-xl border border-slate-200 font-bold text-sm text-slate-700">
              Kembali ke Dashboard
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
