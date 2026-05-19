'use client'; // NEW: guide uses localStorage + router

import { useMemo, useState } from 'react'; // NEW: role-based memo and checkbox state
import { useRouter } from 'next/navigation'; // NEW: navigation for quick starts
import { useAuthStore } from '../../../store/authStore'; // NEW: role context

type GuideConfig = { // NEW: guide card config type
  title: string;
  accent: string;
  points: string[];
  starts: Array<{ label: string; href: string }>;
};

function getGuide(role?: string, fiberType?: string | null): GuideConfig { // NEW: role -> guide content mapper
  if (role === 'GENERAL_MANAGER') {
    return {
      title: 'Selamat datang, General Manager',
      accent: '#7C3AED',
      points: [
        'Import clean list dari ISP (FiberStar, QBN, dll)',
        'Kelola ISP customer dan user sistem',
        'Atur akses fitur per role',
        'Monitor semua pipeline perizinan',
        'Lihat dashboard analytics lengkap',
      ],
      starts: [
        { label: 'Setup ISP Customer & User', href: '/settings' },
        { label: 'Import Data Clean List', href: '/clean-list' },
      ],
    };
  }
  if (role === 'PM_SENIOR') {
    return {
      title: 'Selamat datang, PM Senior',
      accent: '#1D4ED8',
      points: [
        'Approve DRM (Design Review Meeting)',
        'Approve BAK di atas Rp 100.000',
        'Monitor seluruh pipeline perizinan',
        'Akses dashboard analytics',
      ],
      starts: [{ label: 'Overview Pipeline', href: '/dashboard-gm' }],
    };
  }
  if (role?.startsWith('PM_')) {
    return {
      title: `Selamat datang, PM ${fiberType ?? ''}`.trim(),
      accent: '#0F766E',
      points: [
        'Buat APD di peta GIS untuk cluster yang ditetapkan',
        'Submit ABD ke ISP dan catat keputusan',
        'Monitor progress permit cluster',
        'Buat order barang untuk proyek',
      ],
      starts: [{ label: 'Lihat Cluster Aktif', href: '/permit-clusters' }],
    };
  }
  if (role?.startsWith('SURVEYOR_')) {
    return {
      title: `Selamat datang, Surveyor ${fiberType ?? ''}`.trim(),
      accent: '#374151',
      points: [
        'Cek clean list dan buat request kunjungan',
        'Input data lapangan dan foto bukti',
        'Lakukan sosialisasi dan negosiasi kompensasi',
        'Upload tanda tangan RT/RW',
      ],
      starts: [{ label: 'Pilih RW untuk Dikunjungi', href: '/clean-list' }],
    };
  }
  if (role === 'ADMIN') {
    return {
      title: 'Selamat datang, Admin',
      accent: '#B45309',
      points: [
        'Validasi dokumen BAKP',
        'Approve pipeline perizinan final',
        'Kirim dokumen ke ISP via email',
      ],
      starts: [{ label: 'Cluster Menunggu Validasi', href: '/permit-clusters' }],
    };
  }
  if (role === 'ADMIN_STOCK') {
    return {
      title: 'Selamat datang, Admin Stok',
      accent: '#C2410C',
      points: [
        'Kelola stok barang (tambah, edit, sesuaikan)',
        'Terima barang masuk dan input surat jalan',
      ],
      starts: [{ label: 'Cek Stok Sekarang', href: '/stock' }],
    };
  }
  if (role === 'FINANCE') {
    return {
      title: 'Selamat datang, Finance',
      accent: '#166534',
      points: [
        'Proses permintaan pembelian dari PM',
        'Upload bukti transfer untuk BAKP',
        'Monitor status procurement',
      ],
      starts: [{ label: 'Inbox Permintaan', href: '/purchase-requests' }],
    };
  }
  return {
    title: 'Selamat datang',
    accent: '#00D4B4',
    points: ['Navigasikan fitur melalui sidebar kiri.'],
    starts: [{ label: 'Mulai dari Peta GIS', href: '/map' }],
  };
}

function AppSignalLogo() { // NEW: shared logo glyph
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M8 24 Q24 8 40 24" stroke="#00D4B4" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M12 30 Q24 18 36 30" stroke="#00D4B4" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M16 36 Q24 28 32 36" stroke="#00D4B4" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.4" />
    </svg>
  );
}

export default function GuidePage() { // NEW: role quick-reference page
  const router = useRouter(); // NEW
  const { user } = useAuthStore(); // NEW
  const [hideNext, setHideNext] = useState(false); // NEW: "Jangan tampilkan lagi"

  const cfg = useMemo(() => getGuide(user?.role, user?.fiberType), [user?.role, user?.fiberType]); // NEW

  const handleStart = () => { // NEW: start action
    if (hideNext && user?.role) localStorage.setItem(`guide:hidden:${user.role}`, '1');
    router.push(cfg.starts[0].href);
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-[640px] rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center gap-3">
          <AppSignalLogo />
          <div>
            <h1 className="text-[20px] font-semibold text-[#0F172A]">{cfg.title}</h1>
            <p className="text-[13px] text-[#64748B]">Panduan singkat sesuai peran Anda</p>
          </div>
        </div>
        <div className="p-6">
          <div className="rounded-xl border p-4" style={{ borderColor: cfg.accent }}>
            <p className="text-[13px] font-semibold mb-3" style={{ color: cfg.accent }}>Anda dapat:</p>
            <ul className="space-y-2">
              {cfg.points.map((p) => (
                <li key={p} className="text-[14px] text-[#334155] flex items-start gap-2">
                  <span className="text-[#00D4B4] mt-[2px]">✓</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5">
            <p className="text-[13px] font-semibold text-[#0F172A] mb-2">Start here:</p>
            <div className="space-y-2">
              {cfg.starts.map((s, i) => (
                <button
                  key={s.href}
                  type="button"
                  onClick={() => router.push(s.href)}
                  className="w-full h-10 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] px-3 text-left text-[13px] text-[#0F172A] font-medium"
                >
                  {i + 1}. {s.label} → {s.href}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-5 inline-flex items-center gap-2 text-[13px] text-[#64748B]">
            <input type="checkbox" checked={hideNext} onChange={(e) => setHideNext(e.target.checked)} />
            Jangan tampilkan lagi
          </label>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleStart}
              className="h-10 rounded-lg bg-[#00D4B4] hover:bg-[#00c2a6] text-[#0A1628] px-5 text-[13px] font-semibold"
            >
              Mulai
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
