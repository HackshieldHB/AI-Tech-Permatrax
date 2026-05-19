'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** FIX: legacy /order-barang/new → /orders/new (bukan /orders saja) */
export default function Redirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/orders/new');
  }, [router]);

  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
      }}
    >
      Mengalihkan...
    </div>
  );
}
