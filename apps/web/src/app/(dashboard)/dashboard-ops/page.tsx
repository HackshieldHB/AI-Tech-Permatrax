'use client'; // FIX: Ops dashboard — clean KPI grid + quick actions

import { useState, useEffect } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { apiGet } from '../../../lib/api'; // FIX

export default function OpsDashboard() {
  const { user } = useAuthStore(); // FIX
  const router = useRouter(); // FIX
  const [stats, setStats] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX

  useEffect(() => {
    apiGet('/dashboard/ops') // FIX
      .then((d) => setStats(d)) // FIX
      .catch(() => setStats({})) // FIX
      .finally(() => setLoading(false)); // FIX
  }, []);

  const s = stats || {}; // FIX
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }); // FIX

  const kpis = [
    {
      label: 'SKOM Pending', // FIX
      value: s.pendingSkoms ?? 0, // FIX
      sub: 'menunggu approval Ops', // FIX
      icon: '📊', // FIX
      color: '#F59E0B', // FIX
      href: '/permit-clusters', // FIX
    },
    {
      label: 'PO Stock Pending', // FIX
      value: s.pendingStockPOs ?? 0, // FIX
      sub: 'perlu disetujui', // FIX
      icon: '📋', // FIX
      color: '#3B82F6', // FIX
      href: '/orders', // FIX
    },
    {
      label: 'Cash Op Pending', // FIX
      value: s.pendingCashOps ?? 0, // FIX
      sub: 'menunggu approval Ops', // FIX
      icon: '💰', // FIX
      color: '#8B5CF6', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Cluster Aktif', // FIX
      value: s.activeClusters ?? 0, // FIX
      sub: 'sedang berjalan', // FIX
      icon: '🏘️', // FIX
      color: '#22C55E', // FIX
      href: '/permit-clusters', // FIX
    },
  ]; // FIX

  return (
    <div>
      {/* Header */} {/* FIX */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: 28,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              color: 'var(--color-text-primary)',
            }}
          >
            Dashboard Operational Manager {/* FIX */}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              margin: '4px 0 0',
            }}
          >
            {today} · Selamat datang, {user?.name} {/* FIX */}
          </p>
        </div>
        <span
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            background: '#F59E0B15',
            color: '#F59E0B',
            fontSize: 12,
            fontWeight: 600,
            border: '0.5px solid #F59E0B30',
          }}
        >
          Operational Manager {/* FIX */}
        </span>
      </div>

      {/* KPI Cards */} {/* FIX */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        {kpis.map((card) => (
          <div
            key={card.label}
            onClick={() => router.push(card.href)}
            style={{
              padding: '20px 22px',
              borderRadius: 14,
              background: `${card.color}12`,
              border: `0.5px solid ${card.color}25`,
              cursor: 'pointer',
              transition: 'transform 150ms',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.transform = 'none')
            }
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{card.icon}</div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: card.color,
                lineHeight: 1,
              }}
            >
              {loading ? '—' : card.value}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                marginTop: 6,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                marginTop: 2,
              }}
            >
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */} {/* FIX */}
      <div
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 14,
            color: 'var(--color-text-primary)',
          }}
        >
          Aksi Cepat {/* FIX */}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'SKOM Budget Pending', href: '/permit-clusters', icon: '📊' },
            { label: 'Order Barang (PO)', href: '/orders', icon: '📦' },
            { label: 'Cash Operation Inbox', href: '/cash-operation', icon: '💰' },
            { label: 'Pipeline Perizinan', href: '/permit-clusters', icon: '🔄' },
            { label: 'Order / PO', href: '/orders', icon: '📋' },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => router.push(a.href)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 16px',
                borderRadius: 10,
                border: 'none',
                background: 'var(--color-background-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                transition: 'background 150ms',
              }}
            >
              <span style={{ fontSize: 18 }}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
