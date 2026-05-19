'use client'; // NEW: client redirect page

import { useEffect } from 'react'; // NEW: redirect side effect
import { useRouter } from 'next/navigation'; // NEW: routing
import { useAuthStore } from '../../../store/authStore'; // NEW: auth store

export default function HomePage() { // NEW: smart role redirect page
  const { user } = useAuthStore(); // NEW: current user
  const router = useRouter(); // NEW: router instance

  useEffect(() => { // NEW: role-aware redirect logic
    if (!user) return;
    switch (user.role) {
      case 'GENERAL_MANAGER':
        router.replace('/dashboard-gm');
        break;
      case 'PM_SENIOR':
        router.replace('/dashboard-pm');
        break;
      case 'PM_FTTH':
      case 'PM_FTTB':
      case 'PM_FTTT':
        router.replace('/dashboard-pm');
        break;
      case 'SURVEYOR_FTTH':
      case 'SURVEYOR_FTTB':
      case 'SURVEYOR_FTTT':
        router.replace('/dashboard-surveyor');
        break;
      case 'ADMIN':
        router.replace('/dashboard-admin');
        break;
      case 'ADMIN_STOCK':
        router.replace('/dashboard-admin-stock'); // FIX: dedicated stock dashboard
        break;
      case 'FINANCE':
        router.replace('/dashboard-finance'); // FIX
        break;
      case 'MARKETING': // NEW: cash operation role redirect
      case 'MARKETING_HEAD': // NEW: cash operation role redirect
        router.replace('/dashboard-marketing'); // FIX
        break;
      case 'OPERATIONAL_MANAGER': // NEW: cash operation role redirect
        router.replace('/dashboard-ops'); // FIX
        break;
      case 'DESIGNER': // FIX Issue 4B: send designers straight to their dedicated dashboard
        router.replace('/dashboard-designer'); // FIX Issue 4B: avoid fall-through to /map where they lacked data
        break;
      case 'PURCHASING':
        router.replace('/dashboard-purchasing');
        break;
      default:
        router.replace('/map');
    }
  }, [user, router]);

  return ( // NEW: loading fallback while redirecting
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '60vh',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: '3px solid #00D4B4',
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <p style={{ color: '#64748B', fontSize: '14px' }}>Mengarahkan...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
