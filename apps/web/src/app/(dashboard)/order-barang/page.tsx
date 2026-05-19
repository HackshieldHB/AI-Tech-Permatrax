'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

/** FIX: legacy /order-barang → /orders */
export default function Redirect() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();

  useEffect(() => {
    router.replace(params?.id ? `/orders/${params.id}` : '/orders');
  }, [router, params?.id]);

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
