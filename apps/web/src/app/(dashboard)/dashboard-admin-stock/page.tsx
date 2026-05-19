'use client'; // FIX: Admin Stock dashboard — layout konsisten + KPI lengkap

import { useState, useEffect } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { apiGet } from '../../../lib/api'; // FIX

export default function AdminStockDashboard() {
  const { user } = useAuthStore(); // FIX
  const router = useRouter(); // FIX
  const [stats, setStats] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX

  useEffect(() => {
    apiGet('/dashboard/admin-stock') // FIX
      .then((d) => setStats(d)) // FIX
      .catch(() => setStats({})) // FIX
      .finally(() => setLoading(false)); // FIX
  }, []);

  const s = stats || {}; // FIX
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }); // FIX

  const logs = s.recentLogs ?? []; // FIX

  const kpis = [
    {
      label: 'Total Item Stok', // FIX
      value: s.totalItems ?? 0, // FIX
      sub: 'SKU aktif terdaftar', // FIX
      icon: '📦', // FIX
      color: '#3B82F6', // FIX
      href: '/stock', // FIX
    },
    {
      label: 'Stok Rendah', // FIX
      value: s.lowStockItems ?? 0, // FIX
      sub: 'di bawah min. atau ≤10 unit', // FIX
      icon: '⚠️', // FIX
      color: (s.lowStockItems ?? 0) > 0 ? '#EF4444' : '#22C55E', // FIX
      href: '/stock', // FIX
    },
    {
      label: 'Request Menunggu', // FIX
      value: s.pendingOrderVerification ?? 0,
      sub: 'konfirmasi barang masuk', // FIX
      icon: '🚚', // FIX
      color: '#F59E0B', // FIX
      href: '/orders', // Phase 3: unified orders
    },
    {
      label: 'Total Order Aktif', // FIX
      value: s.activeOrders ?? 0, // FIX
      sub: 'belum fulfilled', // FIX
      icon: '🛒', // FIX
      color: '#8B5CF6', // FIX
      href: '/orders', // FIX
    },
  ]; // FIX

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', marginBottom: 28,
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0,
            color: 'var(--color-text-primary)' }}>
            Dashboard Admin Stok {/* FIX */}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)',
            margin: '4px 0 0' }}>
            {today} · Selamat datang, {user?.name ?? '—'} {/* FIX */}
          </p>
        </div>
        <span style={{
          padding: '5px 14px', borderRadius: 20,
          background: '#14B8A615', color: '#0D9488',
          fontSize: 12, fontWeight: 600,
          border: '0.5px solid #14B8A630',
        }}>
          Admin Stok {/* FIX */}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 16, marginBottom: 28,
      }}>
        {kpis.map((card) => (
          <div
            key={card.label}
            onClick={() => router.push(card.href)}
            role="presentation"
            style={{
              padding: '20px 22px', borderRadius: 14,
              background: `${card.color}12`,
              border: `0.5px solid ${card.color}25`,
              cursor: 'pointer',
              transition: 'transform 150ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'none'; }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{card.icon}</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: card.color,
              lineHeight: 1 }}>
              {loading ? '—' : card.value}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600,
              color: 'var(--color-text-primary)', marginTop: 6 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 11,
              color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {(s.lowStockItems ?? 0) > 0 && (
        <div style={{
          padding: '14px 18px', borderRadius: 12, marginBottom: 20,
          background: '#EF444412', border: '1px solid #EF444430',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#EF4444' }}>
              {s.lowStockItems} item perlu perhatian stok {/* FIX */}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)',
              marginTop: 2 }}>
              Cek minimum stok atau pengadaan {/* FIX */}
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/stock')}
            style={{
              marginLeft: 'auto', padding: '7px 16px', borderRadius: 8,
              border: 'none', background: '#EF4444', color: 'white',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            Lihat Stok → {/* FIX */}
          </button>
        </div>
      )}

      <div style={{
        background: 'var(--color-background-primary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 14, padding: 20, marginBottom: 24,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14,
          color: 'var(--color-text-primary)' }}>
          Aksi Cepat {/* FIX */}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Lihat Stok Barang', href: '/stock', icon: '📦' },
            { label: 'Request Stok Masuk', href: '/orders', icon: '🚚' },
            { label: 'Order Barang', href: '/orders', icon: '🛒' },
            { label: 'Surat Jalan', href: '/surat-jalan', icon: '📋' },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => router.push(action.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 16px', borderRadius: 10, border: 'none',
                background: 'var(--color-background-secondary)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
                transition: 'background 150ms',
                fontSize: 13, fontWeight: 500,
                color: 'var(--color-text-primary)',
              }}
            >
              <span style={{ fontSize: 18 }}>{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 14,
          border: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-primary)',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--color-text-primary)' }}>
          Gerakan stok terbaru {/* FIX */}
        </div>
        {logs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Belum ada log</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {logs.map((l: any) => (
              <li key={l.id} style={{ marginBottom: 6, color: 'var(--color-text-primary)' }}>
                {l.stockItem?.name ?? l.stockItemId} · {l.type} · {l.qtyChange > 0 ? '+' : ''}
                {l.qtyChange}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
