'use client'; // FIX: Finance dashboard — KPI + aksi cepat konsisten

import { useState, useEffect } from 'react'; // FIX
import { useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../store/authStore'; // FIX
import { apiGet, apiGetPaginated } from '../../../lib/api'; // FIX
import type { FinanceProjectListItem } from '../../../types/api.types';

type FinanceProjectWidgetAgg = {
  activeProjectCount: number;
  totalBudget: number;
  totalMaterialSpent: number;
  totalJasaSpent: number;
};

export default function FinanceDashboard() {
  const { user } = useAuthStore(); // FIX
  const router = useRouter(); // FIX
  const [stats, setStats] = useState<any>(null); // FIX
  const [fpAgg, setFpAgg] = useState<FinanceProjectWidgetAgg | null>(null);
  const [loading, setLoading] = useState(true); // FIX

  useEffect(() => {
    apiGet('/dashboard/finance') // FIX
      .then((d) => setStats(d)) // FIX
      .catch(() => setStats({})) // FIX
      .finally(() => setLoading(false)); // FIX
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const limit = 200;
        let page = 1;
        const rows: FinanceProjectListItem[] = [];
        let total = 0;
        for (;;) {
          const res = await apiGetPaginated<FinanceProjectListItem>('/finance-projects', {
            status: 'ACTIVE',
            limit,
            page,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          });
          total = res.meta.total;
          rows.push(...res.data);
          if (rows.length >= total || res.data.length === 0) break;
          page += 1;
          if (page > 50) break;
        }
        if (cancelled) return;
        const totalBudget = rows.reduce((s, p) => s + Number(p.totalBudget), 0);
        const totalMaterialSpent = rows.reduce((s, p) => s + Number(p.materialSpent), 0);
        const totalJasaSpent = rows.reduce((s, p) => s + Number(p.jasaSpent), 0);
        setFpAgg({
          activeProjectCount: total,
          totalBudget,
          totalMaterialSpent,
          totalJasaSpent,
        });
      } catch {
        if (!cancelled) setFpAgg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const s = stats ?? {}; // FIX
  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }); // FIX

  const kpis = [
    {
      label: 'Invoice Pending', // FIX
      value: s.pendingInvoices ?? 0, // FIX
      sub: 'paket invoice review', // FIX
      icon: '🧾', // FIX
      color: '#EF4444', // FIX
      href: '/permit-clusters', // FIX
    },
    {
      label: 'Cash Op Pending', // FIX
      value: s.pendingCashOps ?? 0, // FIX
      sub: 'menunggu keputusan Finance', // FIX
      icon: '💰', // FIX
      color: '#F59E0B', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Disetujui Bulan Ini', // FIX
      value: s.approvedThisMonth ?? 0, // FIX
      sub: 'cash operation', // FIX
      icon: '✅', // FIX
      color: '#22C55E', // FIX
      href: '/cash-operation', // FIX
    },
    {
      label: 'Request Stok Pending', // FIX
      value: s.pendingStockFinance ?? 0, // FIX
      sub: 'pembayaran PO stok', // FIX
      icon: '📦', // FIX
      color: '#3B82F6', // FIX
      href: '/orders', // Phase 3: unified orders (legacy /stock-request removed)
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
            Dashboard Finance {/* FIX */}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            {today} · Selamat datang, {user?.name ?? '—'} {/* FIX */}
          </p>
        </div>
        <span style={{
          padding: '5px 14px', borderRadius: 20,
          background: '#3B82F615', color: '#3B82F6',
          fontSize: 12, fontWeight: 600,
          border: '0.5px solid #3B82F630',
        }}>
          Finance {/* FIX */}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 24, color: 'var(--color-text-secondary)' }}>Memuat dashboard…</div>
      ) : null}

      {fpAgg ? (
        <div
          style={{
            marginBottom: 24,
            padding: 24,
            borderRadius: 16,
            border: '0.5px solid #00D4B440',
            background: 'linear-gradient(135deg, #00D4B415 0%, #0F1B2D08 100%)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, color: 'var(--color-text-primary)' }}>
            📊 Finance Project Dashboard
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Kelola budget per project, monitoring realisasi, dan transfer alokasi.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Proyek aktif</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{fpAgg.activeProjectCount}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Total budget</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                Rp {Number(fpAgg.totalBudget).toLocaleString('id-ID')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Total realisasi</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>
                Rp{' '}
                {(
                  fpAgg.totalMaterialSpent + fpAgg.totalJasaSpent
                ).toLocaleString('id-ID')}
                {fpAgg.totalBudget > 0 ? (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    {' '}
                    (
                    {(
                      ((fpAgg.totalMaterialSpent + fpAgg.totalJasaSpent) /
                        fpAgg.totalBudget) *
                      100
                    ).toFixed(0)}
                    %)
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/finance-projects')}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              border: 'none',
              background: '#0F1B2D',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Buka Dashboard →
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        {kpis.map((card) => (
          <div
            key={card.label}
            onClick={() => router.push(card.href)}
            role="presentation"
            style={{
              padding: '20px 22px',
              borderRadius: 14,
              background: `${card.color}12`,
              border: `0.5px solid ${card.color}25`,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color, lineHeight: 1 }}>
              {loading ? '—' : card.value}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 6 }}>
              {card.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 14,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary)' }}>
          Ringkasan pencairan {/* FIX */}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#6366F1' }}>
          Rp {Number(s.totalDisbursed ?? 0).toLocaleString('id-ID')} {/* FIX */}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          Total dicairkan (semua waktu) {/* FIX */}
        </div>
      </div>

      <div
        style={{
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
          { label: 'Cash Operation Inbox', href: '/cash-operation', icon: '💰' },
          { label: 'Pipeline Perizinan', href: '/permit-clusters', icon: '🔄' },
          { label: 'Request Stok', href: '/orders', icon: '📦' },
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
            }}
          >
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
