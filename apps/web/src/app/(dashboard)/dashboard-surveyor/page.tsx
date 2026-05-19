'use client'; // NEW: interactive surveyor dashboard

import { useCallback, useEffect, useState } from 'react'; // NEW: hooks
import Link from 'next/link'; // NEW: navigation
import { useRouter } from 'next/navigation'; // FIX: KPI quick navigation
import { useAuthStore } from '../../../store/authStore'; // NEW: auth
import { apiGet, API_HOST } from '../../../lib/api'; // NEW: API + FIX: centralized host for socket.io
import type { SurveyorDashboard } from '../../../types/api.types'; // NEW: types
import { io, Socket } from 'socket.io-client'; // NEW: realtime
import { toast } from 'sonner'; // NEW: toasts
import { formatDistanceToNow } from 'date-fns'; // NEW: relative time
import { id as idLocale } from 'date-fns/locale'; // NEW: Indonesian locale
import { PageLoader } from '../../../components/PageLoader'; // NEW: loading UI

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Draft', color: '#6B7280', bg: '#6B728018' },
  PM_REVIEW_VISIT: { label: 'Review jadwal PM', color: '#F59E0B', bg: '#F59E0B18' },
  APPROVED_PENDING_DATA: { label: 'Isi data survey', color: '#0EA5E9', bg: '#0EA5E918' },
  PM_REVIEW_SURVEY: { label: 'Review hasil survey', color: '#D97706', bg: '#D9770618' },
  PM_SENIOR_REVIEW: { label: 'Review PM Senior', color: '#F97316', bg: '#F9731618' },
  ADMIN_REVIEW: { label: 'Review Admin', color: '#8B5CF6', bg: '#8B5CF618' },
  APPROVED: { label: 'Disetujui', color: '#22C55E', bg: '#22C55E18' },
  REJECTED: { label: 'Ditolak', color: '#EF4444', bg: '#EF444418' },
  EXISTING_FIBER: { label: 'Ada Fiber', color: '#6B7280', bg: '#6B728018' },
};

export default function DashboardSurveyorPage() {
  const { user, accessToken } = useAuthStore(); // NEW: current user + FIX: token from in-memory store (no longer in localStorage)
  const router = useRouter(); // FIX: KPI cards → halaman terkait
  const [data, setData] = useState<SurveyorDashboard | null>(null); // NEW: dashboard payload
  const [loading, setLoading] = useState(true); // NEW: loading flag

  const load = useCallback(async () => {
    // NEW: fetch surveyor dashboard
    try {
      const d = await apiGet<SurveyorDashboard>('/dashboard/surveyor');
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
    // NEW: Socket.IO — refresh when PM reviews
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
    const bump = () => {
      toast.message('Permintaan kunjungan diperbarui');
      load();
    };
    s.on('visitRequest:pmReviewed', bump);
    return () => {
      s.disconnect();
    };
  }, [user, accessToken, load]);

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (!user) return <PageLoader rows={6} columns={2} />;

  if (loading && !data) {
    return <PageLoader rows={8} columns={2} />;
  }

  const stats = data?.stats;
  const total = stats?.total ?? 0;
  const approvedMonth = stats?.approvedThisMonth ?? 0;
  const progressPct = total > 0 ? Math.min(100, (approvedMonth / Math.max(total, 1)) * 100) : 0;
  const available = data?.availableCleanList ?? 0;
  const recent = data?.recentRequests ?? [];

  return (
    <div className="max-w-[720px] mx-auto space-y-6 pb-12 px-1">
      {/* NEW: compact header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Halo, {user.name}</h1>
          {user.fiberType ? (
            <span className="rounded-full bg-teal-100 px-3 py-0.5 text-xs font-semibold text-teal-800">
              {user.fiberType}
            </span>
          ) : null}
          <span className="rounded-full bg-sky-100 px-3 py-0.5 text-xs font-semibold text-sky-900">
            Surveyor {/* FIX: role badge */}
          </span>
        </div>
        <p className="text-sm text-slate-500 capitalize">{today}</p>
      </header>

      {/* FIX: KPI ringkas selaras dashboard lain */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Visit Request Aktif', value: data?.stats?.activeVR ?? 0, color: '#3B82F6', href: '/visit-requests' },
          { label: 'Cluster Aktif', value: data?.stats?.activeClusters ?? 0, color: '#14B8A6', href: '/permit-clusters' },
          { label: 'Tugas Menunggu', value: data?.stats?.pendingTasks ?? 0, color: '#F59E0B', href: '/permit-clusters' },
          { label: 'Notifikasi', value: data?.stats?.unreadNotifications ?? 0, color: '#8B5CF6', href: '#' },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => {
              if (k.href === '#') {
                toast.message('Buka inbox notifikasi dari ikon lonceng'); // FIX: belum ada route dedikasi
                return;
              }
              router.push(k.href);
            }}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-teal-300 transition-colors"
          >
            <div className="text-2xl font-black" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs font-semibold text-slate-600 mt-1">{k.label}</div>
          </button>
        ))}
      </div>

      {/* NEW: hero CTA */}
      <div
        className="rounded-2xl p-6 text-white shadow-lg"
        style={{
          background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 45%, #2dd4bf 100%)',
        }}
      >
        <h2 className="text-xl font-bold">Mulai Kunjungan</h2>
        <p className="mt-2 text-sm text-white/90">{available} cluster tersedia</p>
        <Link
          href="/visit-requests/new"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-base font-bold text-teal-700 shadow-md hover:bg-teal-50 transition-colors w-full sm:w-auto"
        >
          + Pilih Cluster →
        </Link>
      </div>

      {/* NEW: stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs text-slate-500">Total</div>
          <div className="text-2xl font-bold text-primary">{stats?.total ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs text-slate-500">Review</div>
          <div className="text-2xl font-bold text-amber-500">{stats?.underReview ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs text-slate-500">Disetujui</div>
          <div className="text-2xl font-bold text-emerald-600">{stats?.approved ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div className="text-xs text-slate-500">Ditolak</div>
          <div className="text-2xl font-bold text-red-500">{stats?.rejected ?? 0}</div>
        </div>
      </div>

      {/* NEW: monthly progress */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-700">
          Bulan Ini: <span className="font-semibold text-teal-700">{approvedMonth}</span> disetujui dari{' '}
          <span className="font-semibold">{total}</span> request
        </p>
        <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* NEW: recent activity */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3">Aktivitas Terbaru</h2>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
            Belum ada request. Mulai kunjungan pertamamu!
          </div>
        ) : (
          <ul className="space-y-3">
            {recent.map((r) => {
              const cfg =
                r.status === 'DRAFT' && r.rejectionReason
                  ? { label: 'Perlu revisi jadwal', color: '#CA8A04', bg: '#FEF9C318' }
                  : STATUS_CONFIG[r.status] ?? {
                      label: r.status,
                      color: '#64748b',
                      bg: '#64748b18',
                    };
              const cl = r.cleanList;
              return (
                <li key={r.id}>
                  <Link
                    href={`/visit-requests/${r.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-teal-300 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900 min-w-0">{cl?.siteName ?? '—'}</div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono text-slate-700">{cl?.rwCode ?? '—'}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5">{cl?.ispCustomer ?? '—'}</span>
                      <span>
                        {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true, locale: idLocale })}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2 text-right">
                      {r.status === 'DRAFT' && r.rejectionReason ? (
                        <span className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                          Revisi jadwal lalu submit
                        </span>
                      ) : null}
                      {r.status === 'DRAFT' && !r.rejectionReason ? (
                        <span className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                          Submit Sekarang
                        </span>
                      ) : null}
                      {r.status === 'APPROVED' ? (
                        <span className="text-sm font-semibold text-teal-600">Lihat BA Open →</span>
                      ) : null}
                      {r.status === 'REJECTED' ? (
                        <span className="text-sm font-semibold text-red-600">Lihat Alasan →</span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
