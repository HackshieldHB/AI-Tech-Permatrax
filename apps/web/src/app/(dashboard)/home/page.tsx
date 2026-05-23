'use client'; // NEW: client redirect page

import { useEffect } from 'react'; // NEW: redirect side effect
import { useRouter } from 'next/navigation'; // NEW: routing
import Link from 'next/link'; // MAP_VIEWER: link to GIS map
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
      case 'MAP_VIEWER': // FIX: MAP_VIEWER stays on /home — no auto-redirect to /map
        break;
      default:
        router.replace('/map');
    }
  }, [user, router]);

  // FIX: MAP_VIEWER gets a proper welcome card instead of the infinite loading spinner
  if (user?.role === 'MAP_VIEWER') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ fontSize: '56px', lineHeight: 1 }}>🗺️</div>
        <h2 style={{ color: '#1E293B', fontSize: '20px', fontWeight: 600, margin: 0 }}>
          Selamat Datang, {user.name}
        </h2>
        <p style={{ color: '#64748B', fontSize: '14px', margin: 0, textAlign: 'center', maxWidth: 320 }}>
          Akses Anda terbatas pada fitur <strong>Peta GIS</strong>.<br />
          Gunakan menu di sidebar atau tombol di bawah untuk membuka peta.
        </p>
        <Link
          href="/map"
          style={{
            marginTop: '8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: '#00D4B4',
            color: '#fff',
            padding: '10px 24px',
            borderRadius: '10px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,212,180,0.3)',
            transition: 'background 150ms',
          }}
        >
          Buka Peta GIS →
        </Link>
      </div>
    );
  }

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
