'use client'; // NEW: interactive admin dashboard

import { useCallback, useEffect, useState } from 'react'; // NEW: hooks
import Link from 'next/link'; // NEW: navigation
import { useAuthStore } from '../../../store/authStore'; // NEW: auth
import { apiGet, API_HOST } from '../../../lib/api'; // NEW: API + FIX: centralized host for socket.io
import type { AdminDashboard } from '../../../types/api.types'; // NEW: types
import { io, Socket } from 'socket.io-client'; // NEW: realtime
import { toast } from 'sonner'; // NEW: toasts
import { formatDistanceToNow } from 'date-fns'; // NEW: relative time
import { id as idLocale } from 'date-fns/locale'; // NEW: Indonesian locale
import { CheckCircle2 } from 'lucide-react'; // NEW: icon
import { PageLoader } from '../../../components/PageLoader'; // NEW: loading UI

function actionDotClass(action: string) {
  // NEW: timeline dot color from action text
  const a = action.toLowerCase();
  if (a.includes('reject') || a.includes('tolak')) return 'bg-red-500';
  if (a.includes('approv') || a.includes('setujui') || a.includes('disetujui')) return 'bg-emerald-500';
  if (a.includes('submit') || a.includes('ajukan')) return 'bg-primary';
  return 'bg-slate-400';
}

export default function DashboardAdminPage() {
  const { user, accessToken } = useAuthStore(); // NEW: current user + FIX: token from in-memory store (no longer in localStorage)
  const [data, setData] = useState<AdminDashboard | null>(null); // NEW: dashboard payload
  const [loading, setLoading] = useState(true); // NEW: loading flag

  const load = useCallback(async () => {
    // NEW: fetch admin dashboard
    try {
      const d = await apiGet<AdminDashboard>('/dashboard/admin');
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
    // NEW: Socket.IO — BAKP queue + visit request refetch
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
    s.on('bakp:submittedForValidation', () => {
      toast.info('BAKP baru menunggu validasi');
      setData((prev) =>
        prev
          ? {
              ...prev,
              pendingValidations: {
                ...prev.pendingValidations,
                bakpValidations: prev.pendingValidations.bakpValidations + 1,
                total: prev.pendingValidations.total + 1,
              },
            }
          : prev
      );
    });
    s.on('visitRequest:submitted', () => {
      load();
    });
    return () => {
      s.disconnect();
    };
  }, [user, accessToken, load]);

  if (!user) return <PageLoader rows={5} columns={2} />;

  if (loading && !data) {
    return <PageLoader rows={8} columns={2} />;
  }

  const pv = data?.pendingValidations ?? { visitRequests: 0, bakpValidations: 0, total: 0 };
  const cr = data?.constructionReadyThisMonth ?? 0;
  const docIsp = data?.documentsReadyForIsp ?? 0; // FIX: angka selaras Daftar Dokumen (BAKP approved)
  const activity = (data?.recentApprovals ?? []).slice(0, 10);

  return (
    <div className="max-w-[960px] mx-auto space-y-8 pb-12 px-1">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard Admin</h1>
        <p className="text-sm text-slate-500 mt-1">Antrian validasi & persetujuan</p>
      </header>

      {/* NEW: validation queue */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Visit Request</div>
          <div
            className={`mt-2 text-4xl font-bold ${
              pv.visitRequests > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {pv.visitRequests}
          </div>
          <p className="text-xs text-slate-500 mt-1">menunggu persetujuan admin</p>
          {pv.visitRequests > 0 ? (
            <Link
              href="/visit-requests?status=ADMIN_REVIEW"
              className="mt-4 inline-flex rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
            >
              Tinjau →
            </Link>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">BAKP Validasi</div>
          <div
            className={`mt-2 text-4xl font-bold ${
              pv.bakpValidations > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {pv.bakpValidations}
          </div>
          <p className="text-xs text-slate-500 mt-1">bundle dokumen menunggu validasi</p>
          {pv.bakpValidations > 0 ? (
            <Link
              href="/permit-clusters"
              className="mt-4 inline-flex rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Validasi →
            </Link>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Tugas</div>
          <div className={`mt-2 text-4xl font-bold ${pv.total > 0 ? 'text-red-600' : 'text-teal-600'}`}>
            {pv.total}
          </div>
          <p className="text-xs text-slate-500 mt-1">tugas menunggu persetujuan</p>
          {pv.total === 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
              Semua clear!
            </div>
          ) : null}
        </div>
      </section>

      {/* FIX: pisahkan metrik konstruksi vs dokumen ISP (selaras document-list) */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="text-3xl font-bold text-slate-800">{cr}</div>
          <p className="text-sm text-slate-600 mt-1">Cluster selesai (siap konstruksi) bulan ini</p>
          {cr > 0 ? (
            <Link href="/permit-clusters?status=COMPLETED" className="mt-3 inline-flex rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
              Lihat di Pipeline →
            </Link>
          ) : (
            <p className="text-xs text-slate-400 mt-2">Belum ada cluster completed bulan ini</p>
          )}
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-6 py-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-3xl font-bold text-emerald-700">{docIsp}</div>
            <p className="text-sm text-emerald-900 mt-1">Dokumen BAKP approved — siap kirim ke ISP</p>
          </div>
          {docIsp > 0 ? (
            <Link href="/document-list" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Kirim ke ISP →
            </Link>
          ) : (
            <span className="text-xs text-emerald-800">Belum ada bundel BAKP approved</span>
          )}
        </div>
      </section>

      {/* NEW: recent activity timeline */}
      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Aktivitas Terbaru</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada aktivitas</p>
        ) : (
          <ul className="space-y-0 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {activity.map((item) => (
              <li key={item.id} className="flex gap-3 px-4 py-3">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${actionDotClass(item.action)}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{item.action}</p>
                  <p className="text-xs text-slate-500">{item.actor?.name ?? '—'}</p>
                  {item.notes ? <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.notes}</p> : null}
                </div>
                <time
                  className="shrink-0 text-xs text-slate-400"
                  dateTime={item.createdAt}
                  title={item.createdAt}
                >
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: idLocale })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
