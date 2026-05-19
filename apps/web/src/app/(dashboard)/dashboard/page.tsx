'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/map');
  }, [router]);
  return (
    <div className="text-slate-500 text-sm">Mengalihkan ke peta…</div>
  );
}
