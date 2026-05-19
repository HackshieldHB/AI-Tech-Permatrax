'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../../store/authStore';
import { apiGet } from '../../../lib/api';
import { toast } from 'sonner';

export type PurchasingDashboardKpi = {
  pendingPriceInput: number;
  pendingPoSendEmail: number;
  invoicesAwaitingAck: number;
  totalSuppliers: number;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    orderTrigger: string;
    createdAt: string;
    totalAmount: string;
  }>;
};

export default function DashboardPurchasingPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [kpi, setKpi] = useState<PurchasingDashboardKpi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<PurchasingDashboardKpi>('/dashboard/purchasing');
        if (!cancelled) setKpi(data);
      } catch (e: unknown) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Gagal memuat dashboard');
          setKpi(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const kpis = [
    {
      label: 'Menunggu Input Harga',
      value: kpi?.pendingPriceInput ?? 0,
      sub: 'order perlu harga dari Purchasing',
      icon: '🏷️',
      color: '#0D9488',
      href: '/purchasing',
      urgent: (kpi?.pendingPriceInput ?? 0) > 0,
    },
    {
      label: 'PO Belum Dikirim (email)',
      value: kpi?.pendingPoSendEmail ?? 0,
      sub: 'menunggu pembayaran, email PO belum terkirim',
      icon: '📧',
      color: '#F59E0B',
      href: '/orders',
    },
    {
      label: 'Tagihan Menunggu ACK',
      value: kpi?.invoicesAwaitingAck ?? 0,
      sub: 'status Terkirim ke Supplier',
      icon: '🧾',
      color: '#3B82F6',
      href: '/supplier-invoices',
    },
    {
      label: 'Supplier Aktif',
      value: kpi?.totalSuppliers ?? 0,
      sub: 'master supplier',
      icon: '🏭',
      color: '#8B5CF6',
      href: '/suppliers',
    },
  ];

  return (
    <div>
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
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
            Dashboard Purchasing
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            {today} · Selamat datang, {user?.name ?? '—'}
          </p>
        </div>
        <span
          style={{
            padding: '5px 14px',
            borderRadius: 20,
            background: '#0D948815',
            color: '#0F766E',
            fontSize: 12,
            fontWeight: 600,
            border: '0.5px solid #0D948630',
          }}
        >
          Purchasing
        </span>
      </div>

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
            role="presentation"
            style={{
              padding: '20px 22px',
              borderRadius: 14,
              background: `${card.color}12`,
              border: `0.5px solid ${card.color}25`,
              cursor: 'pointer',
              transition: 'transform 150ms',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'none';
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>{card.icon}</div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: card.urgent ? '#EF4444' : card.color,
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
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--color-text-primary)' }}>
          Aksi cepat
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { label: 'Antrian input harga', href: '/purchasing', icon: '🏷️' },
            { label: 'Daftar order', href: '/orders', icon: '🛒' },
            { label: 'Tagihan supplier', href: '/supplier-invoices', icon: '🧾' },
            { label: 'Master supplier', href: '/suppliers', icon: '🏭' },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => router.push(action.href)}
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
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          borderRadius: 14,
          padding: 20,
          overflow: 'auto',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--color-text-primary)' }}>
          Order terkait purchasing (10 terbaru)
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Memuat…</div>
        ) : !kpi || kpi.recentOrders.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Belum ada order di antrian terkait.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-tertiary)', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>No. Order</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>Trigger</th>
                <th style={{ padding: '8px 10px' }}>Total</th>
                <th style={{ padding: '8px 10px' }}>Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {kpi.recentOrders.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/orders/${row.id}`)}
                  style={{ borderBottom: '1px solid var(--color-border-tertiary)', cursor: 'pointer' }}
                >
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.orderNumber}</td>
                  <td style={{ padding: '8px 10px' }}>{row.status}</td>
                  <td style={{ padding: '8px 10px' }}>{row.orderTrigger}</td>
                  <td style={{ padding: '8px 10px' }}>
                    Rp{' '}
                    {Number(row.totalAmount || 0).toLocaleString('id-ID', {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)' }}>
                    {new Date(row.createdAt).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
