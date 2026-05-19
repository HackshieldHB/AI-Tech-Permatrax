'use client'; // NEW: interactive PM dashboard

import { useCallback, useEffect, useMemo, useState } from 'react'; // NEW: hooks
import Link from 'next/link'; // NEW: navigation
import { useAuthStore } from '../../../store/authStore'; // NEW: auth
import { apiGet, API_HOST } from '../../../lib/api'; // NEW: API + FIX: centralized host for socket.io
import type { PmDashboard } from '../../../types/api.types'; // NEW: types
import { PHASE_LABELS } from '../../../types/api.types'; // NEW: phase labels
import { io, Socket } from 'socket.io-client'; // NEW: realtime
import { toast } from 'sonner'; // NEW: toasts
import { Folder, ShoppingCart, FileText, ChevronRight } from 'lucide-react'; // NEW: icons
import { formatDistanceToNow } from 'date-fns'; // NEW: relative time
import { id as idLocale } from 'date-fns/locale'; // NEW: Indonesian locale
import { PageLoader } from '../../../components/PageLoader'; // NEW: loading UI

const PHASE_COLORS: Record<string, string> = {
  // NEW: phase accent colors for badges and chart
  APD_DRAFTING: '#6B7280',
  DRM_REVIEW: '#3B82F6',
  ABD_SUBMISSION: '#8B5CF6',
  ABD_REVISION: '#F59E0B',
  SOCIALIZATION: '#14B8A6',
  COMPENSATION_NEGOTIATION: '#F97316',
  BAK_APPROVAL: '#EC4899',
  SIGNATURE_COLLECTION: '#6366F1',
  SCOM: '#06B6D4',
  BAKP_COMPILATION: '#84CC16',
  BAKP_VALIDATION: '#EAB308',
  CONSTRUCTION_READY: '#22C55E',
};

function getGreeting() {
  // NEW: time-of-day greeting
  const h = new Date().getHours();
  if (h < 12) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function phaseLabel(phase: string) {
  // NEW: Indonesian label with fallback
  return (PHASE_LABELS as Record<string, string>)[phase] ?? phase;
}

export default function DashboardPmPage() {
  const { user, accessToken } = useAuthStore(); // NEW: current user + FIX: token from in-memory store (no longer in localStorage)
  const [data, setData] = useState<PmDashboard | null>(null); // NEW: dashboard payload
  const [loading, setLoading] = useState(true); // NEW: initial load

  const load = useCallback(async () => {
    // NEW: fetch PM dashboard
    try {
      const d = await apiGet<PmDashboard>('/dashboard/pm');
      setData(d);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal memuat dashboard';
      toast.error(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // NEW: Socket.IO — refetch on pipeline / surat jalan events
    if (!user) return;
    // FIX: accessToken lives in memory now (XSS hardening) — read from zustand store
    const token = accessToken;
    if (!token) return;
    // FIX: API_HOST resolves via window.location for remote ngrok clients (no localhost fallback)
    // FIX: include polling fallback + ngrok bypass header so ngrok-free clients don't get the interstitial
    const s: Socket = io(API_HOST, {
      auth: { token },
      transports: ['websocket', 'polling'],
      extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
    });
    s.on('connect', () => s.emit('register', { userId: user.id, role: user.role }));
    const bump = () => load();
    s.on('permitCluster:phaseAdvanced', bump);
    s.on('order:suratJalanReady', () => {
      toast.success('Surat jalan siap diunduh');
      bump();
    });
    return () => {
      s.disconnect();
    };
  }, [user, accessToken, load]);

  const dateStr = useMemo(
    () =>
      new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    []
  );

  const pendingList = data?.pendingActions ?? [];
  const maxWait = useMemo(
    () => (pendingList.length ? Math.max(...pendingList.map((a) => a.daysWaiting)) : 0),
    [pendingList]
  );

  const phaseRows = useMemo(() => {
    const rows = [...(data?.clustersByPhase ?? [])].sort((a, b) => b.count - a.count).slice(0, 6);
    const maxC = Math.max(...rows.map((r) => r.count), 1);
    return rows.map((r) => ({ ...r, pct: (r.count / maxC) * 100 }));
  }, [data?.clustersByPhase]);

  const recentFive = useMemo(() => (data?.recentClusters ?? []).slice(0, 5), [data?.recentClusters]);

  if (!user) return <PageLoader rows={6} columns={4} />;

  if (loading && !data) {
    return <PageLoader rows={8} columns={4} />;
  }

  const stats = data?.stats;
  const paCount = stats?.pendingActions ?? 0;

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 pb-12 px-1">
      {/* NEW: page header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {getGreeting()}, {user.name}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {user.fiberType ?? '—'} Construction Pipeline • {dateStr}
        </p>
      </div>

      {/* NEW: stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Cluster Aktif</div>
          <div className="mt-1 text-3xl font-semibold text-primary">{stats?.activeClusters ?? '—'}</div>
          {stats?.totalClusters != null ? (
            <div className="mt-1 text-xs text-slate-500">Total (fiber): {stats.totalClusters}</div>
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Butuh Tindakan</div>
          <div
            className={`mt-1 text-3xl font-semibold ${
              paCount === 0 ? 'text-emerald-600' : maxWait > 7 ? 'text-red-600' : 'text-amber-500'
            }`}
          >
            {stats?.pendingActions ?? '—'}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Order Pending</div>
          <div className="mt-1 text-3xl font-semibold text-amber-600">{stats?.pendingOrders ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Selesai Bulan Ini</div>
          <div className="mt-1 text-3xl font-semibold text-emerald-600">{stats?.completedThisMonth ?? '—'}</div>
        </div>
      </div>

      {/* NEW: pending actions */}
      <section>
        {pendingList.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-6 text-emerald-800">
            ✓ Semua cluster berjalan lancar. Tidak ada tindakan yang diperlukan.
          </div>
        ) : (
          <div
            className={`rounded-xl border-l-4 bg-white p-5 shadow-sm ${
              maxWait > 7 ? 'border-l-red-500 border border-slate-200' : 'border-l-amber-400 border border-slate-200'
            }`}
          >
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              ⚠ {pendingList.length} Tindakan Diperlukan
            </h2>
            <ul className="space-y-3">
              {pendingList.slice(0, 5).map((a) => {
                const dot =
                  a.daysWaiting > 7 ? 'bg-red-500' : a.daysWaiting >= 3 ? 'bg-amber-500' : 'bg-slate-400';
                return (
                  <li
                    key={`${a.clusterId}-${a.type}`}
                    className="flex flex-wrap items-center gap-3 justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                      <div>
                        <div className="font-medium text-slate-900">{a.label}</div>
                        <div className="text-sm text-slate-600">
                          <Link href={`/permit-clusters/${a.clusterId}`} className="text-primary hover:underline">
                            {a.clusterCode}
                          </Link>
                          <span className="text-slate-500"> ({a.daysWaiting} hari)</span>
                        </div>
                      </div>
                    </div>
                    <Link
                      href={a.href}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-teal-600 hover:text-teal-700 shrink-0"
                    >
                      Tindak Sekarang <ChevronRight className="w-4 h-4" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {pendingList.length > 5 && (
              <p className="mt-4 text-sm text-slate-500">
                Lihat {pendingList.length - 5} lainnya di{' '}
                <Link href="/permit-clusters" className="font-semibold text-teal-600 hover:underline">
                  pipeline →
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      {/* NEW: two columns — recent clusters + phase distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Cluster Terbaru</h2>
            <Link href="/permit-clusters" className="text-sm font-semibold text-teal-600 hover:underline">
              Lihat semua →
            </Link>
          </div>
          {recentFive.length === 0 ? (
            <p className="text-slate-500 text-sm">Belum ada cluster</p>
          ) : (
            <ul className="space-y-3">
              {recentFive.map((c: Record<string, unknown>, idx: number) => {
                const id = String(c.id ?? idx);
                const code = String(c.clusterCode ?? c.code ?? '—');
                const phase = String(c.currentPhase ?? c.phase ?? '');
                const updatedAt = String(c.updatedAt ?? new Date().toISOString());
                const vr = c.visitRequest as { cleanList?: { siteName?: string } } | undefined;
                const site = vr?.cleanList?.siteName ?? String(c.siteName ?? '—');
                const color = PHASE_COLORS[phase] ?? '#64748b';
                return (
                  <li key={id}>
                    <Link
                      href={`/permit-clusters/${id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          {code}{' '}
                          <span className="text-slate-500 font-normal">· {site}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
                            style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
                          >
                            {phaseLabel(phase)}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDistanceToNow(new Date(updatedAt), { addSuffix: true, locale: idLocale })}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Distribusi Phase</h2>
          {phaseRows.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada data fase</p>
          ) : (
            <div className="space-y-3">
              {phaseRows.map((row) => {
                const col = PHASE_COLORS[row.phase] ?? '#64748b';
                return (
                  <div key={row.phase}>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span className="truncate pr-2">{phaseLabel(row.phase)}</span>
                      <span className="font-semibold text-slate-900">{row.count}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${row.pct}%`, background: col }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* NEW: quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/permit-clusters"
          className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-teal-300 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Folder className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Pipeline Aktif</div>
            <div className="text-sm text-teal-600 font-medium mt-1">Lihat semua cluster →</div>
          </div>
        </Link>
        <Link
          href="/orders/new"
          className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-teal-300 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Order Barang</div>
            <div className="text-sm text-teal-600 font-medium mt-1">Buat order baru →</div>
          </div>
        </Link>
        <Link
          href="/surat-jalan"
          className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-teal-300 transition-colors"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">Surat Jalan</div>
            <div className="text-sm text-teal-600 font-medium mt-1">Unduh surat jalan →</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
