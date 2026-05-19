'use client'; // FIX: Marketing dashboard — split cash advance vs reimbursement

import { useState, useEffect } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { apiGet } from '../../../lib/api'; // FIX

export default function MarketingDashboard() {
  const { user } = useAuthStore(); // FIX
  const router = useRouter(); // FIX
  const [stats, setStats] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX

  useEffect(() => {
    apiGet('/dashboard/marketing') // FIX
      .then((d) => setStats(d)) // FIX
      .catch(() => setStats({})) // FIX
      .finally(() => setLoading(false)); // FIX
  }, []);

  const s = stats ?? {}; // FIX
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }); // FIX

  const kpis = [
    {
      label: 'Cash Advance Pending', // FIX
      value: s.pendingCashOps ?? 0, // FIX
      sub: 'draft / submitted / review', // FIX
      icon: '💵', // FIX
      color: '#00D4B4', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Reimbursement Pending', // FIX
      value: s.pendingReimburse ?? 0, // FIX
      sub: 'pengajuan klaim', // FIX
      icon: '🧾', // FIX
      color: '#3B82F6', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Disetujui', // FIX
      value: s.approvedCashOps ?? 0, // FIX
      sub: 'total cash op disetujui', // FIX
      icon: '✅', // FIX
      color: '#22C55E', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Total Cluster', // FIX
      value: s.totalClusters ?? 0, // FIX
      sub: 'seluruh pipeline', // FIX
      icon: '🏘️', // FIX
      color: '#8B5CF6', // FIX
      href: '/permit-clusters', // FIX
    },
  ]; // FIX

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 28, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
            Dashboard Marketing {/* FIX */}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            {today} · {user?.name ?? '—'} {/* FIX */}
          </p>
        </div>
        <span style={{
          padding: '5px 14px', borderRadius: 20,
          background: '#00D4B418', color: '#0F766E',
          fontSize: 12, fontWeight: 600,
          border: '0.5px solid #00D4B440',
        }}>
          Marketing {/* FIX */}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        {kpis.map((row) => (
          <div
            key={row.label}
            onClick={() => router.push(row.href)}
            role="presentation"
            style={{
              padding: 20,
              borderRadius: 14,
              border: `0.5px solid ${row.color}30`,
              background: `${row.color}10`,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{row.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: row.color }}>
              {loading ? '—' : row.value}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6, color: 'var(--color-text-primary)' }}>
              {row.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{row.sub}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 14,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary)' }}>
          Aksi Cepat {/* FIX */}
        </div>
        {[
          { label: 'Cash Advance', href: '/cash-operation', icon: '💵' },
          { label: 'Reimbursement', href: '/cash-operation', icon: '🧾' },
          { label: 'Pipeline Cluster', href: '/permit-clusters', icon: '🏘️' },
        ].map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => router.push(a.href)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--color-background-secondary)',
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: 8,
              fontSize: 13,
              color: 'var(--color-text-primary)',
            }}
          >
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
