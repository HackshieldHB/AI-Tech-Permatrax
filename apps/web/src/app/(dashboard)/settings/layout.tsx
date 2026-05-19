'use client';

import { useAuthStore } from '../../../store/authStore';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const isProfileRoute = pathname === '/settings/profile' || pathname?.startsWith('/settings/profile/');

  useEffect(() => {
    if (!user) return;
    if (isProfileRoute) return;
    if (user.role !== 'GENERAL_MANAGER') {
      router.replace('/map');
    }
  }, [user, router, isProfileRoute]);

  if (!user) return null;
  if (!isProfileRoute && user.role !== 'GENERAL_MANAGER') return null;

  return <>{children}</>;
}
