'use client';

// GIS Issue 1: panduan awal (onboarding tour) untuk user baru — slider yang
// memperkenalkan semua fitur peta sebelum mulai bekerja. Muncul otomatis pada
// kunjungan pertama (localStorage) dan bisa dibuka lagi lewat tombol "?".

import { useEffect, useState } from 'react';

const TOUR_STORAGE_KEY = 'permatrax-gis-tour-v1';

type TourStep = {
  icon: string;
  title: string;
  desc: string;
  tips?: string[];
};

const TOUR_STEPS: TourStep[] = [
  {
    icon: '🗺️',
    title: 'Selamat datang di GIS PermaTrax',
    desc: 'Peta interaktif untuk perencanaan jaringan FTTH: upload KMZ, kalkulasi topologi otomatis (OLT–ODC–ODP), gambar manual, dan export ke Google Earth / Excel.',
    tips: ['Geser peta dengan drag, zoom dengan scroll', 'Cari lokasi lewat kotak pencarian di atas'],
  },
  {
    icon: '🛰️',
    title: 'Ganti Basemap',
    desc: 'Tombol di kiri atas mengganti tampilan peta antara OpenStreetMap dan Satelit. Desain dan layer Anda TETAP tampil saat berganti basemap — aman bolak-balik.',
  },
  {
    icon: '📂',
    title: 'Upload KMZ / KML',
    desc: 'Panel "KMZ Layers" untuk mengunggah file KMZ/KML. Setiap layer bisa diganti warna, disembunyikan, dihapus, dan di-zoom kembali dengan tombol 🔍.',
    tips: ['Tombol 👥 menjadikan titik-titik KMZ sebagai titik pelanggan pada kalkulasi'],
  },
  {
    icon: '🧮',
    title: 'Kalkulasi FTTH',
    desc: 'Panel "Kalkulasi": pilih mode area (radius/polygon), lalu klik peta untuk menandai titik BACKBONE (OLT) dan area TARGET. Sistem menghitung topologi, BOQ, dan estimasi biaya otomatis.',
    tips: ['Kapasitas ODP (1:8 / 1:16) dan jarak tiang bisa diatur sebelum kalkulasi', 'Tombol Batalkan tidak menghapus desain yang sudah ada'],
  },
  {
    icon: '🕸️',
    title: 'Hasil Topologi',
    desc: 'Setelah kalkulasi, peta menampilkan OLT, ODC, ODP, kabel feeder (merah), distribusi (biru), drop wire, tiang, dan homepass. Klik objek untuk melihat detail.',
    tips: ['Garis putus-putus oranye = rute fallback garis lurus, perlu verifikasi lapangan'],
  },
  {
    icon: '✏️',
    title: 'Mode Sketch (Gambar Manual)',
    desc: 'Toolbar bawah menyediakan mode Sketch untuk menggambar garis, area, dan titik secara bebas di atas peta.',
    tips: ['Hapus objek: klik objek yang ingin dihapus, lalu klik ikon 🗑 di kanan atas peta (atau tekan tombol Delete)'],
  },
  {
    icon: '🛠️',
    title: 'Edit Mode',
    desc: 'Edit Mode untuk memindahkan/menambah/menghapus node dan kabel hasil kalkulasi satu per satu. Mendukung Undo/Redo (Ctrl+Z / Ctrl+Y).',
  },
  {
    icon: '💾',
    title: 'Simpan & Muat Desain',
    desc: 'Panel "Saved Designs" menyimpan hasil kalkulasi maupun sketch (tanpa harus kalkulasi dulu) sebagai draft per Project ID, dan memuatnya kembali kapan saja.',
  },
  {
    icon: '📤',
    title: 'Export',
    desc: 'Hasil desain bisa di-export ke KMZ (Google Earth — lengkap dengan kabel sampai drop wire ke rumah), Excel (Data Homepass per ODP), dan PDF.',
    tips: ['Buka panduan ini lagi kapan saja lewat tombol ? di kanan bawah'],
  },
];

export function MapTourOverlay() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_STORAGE_KEY)) setOpen(true);
    } catch {
      /* localStorage tidak tersedia */
    }
  }, []);

  const close = () => {
    setOpen(false);
    setStep(0);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, 'done');
    } catch {
      /* ignore */
    }
  };

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Tombol buka ulang tour */}
      <button
        type="button"
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
        title="Panduan penggunaan peta"
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          zIndex: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: '#0F1B2D',
          color: 'white',
          fontSize: 16,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        }}
      >
        ?
      </button>

      {open && current && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 50,
            background: 'rgba(15,27,45,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={close}
        >
          <div
            style={{
              width: 'min(420px, 92vw)',
              background: 'white',
              borderRadius: 16,
              padding: '26px 24px 20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 44, marginBottom: 10 }}>{current.icon}</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 800, color: '#0F1B2D' }}>
              {current.title}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4B5563', lineHeight: 1.6 }}>
              {current.desc}
            </p>
            {current.tips && (
              <div
                style={{
                  textAlign: 'left',
                  background: '#F0FDFA',
                  border: '1px solid #99F6E4',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 14,
                }}
              >
                {current.tips.map((t, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#0F766E', lineHeight: 1.7 }}>
                    💡 {t}
                  </div>
                ))}
              </div>
            )}

            {/* Dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
              {TOUR_STEPS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Langkah ${i + 1}`}
                  style={{
                    width: i === step ? 20 : 8,
                    height: 8,
                    borderRadius: 4,
                    border: 'none',
                    background: i === step ? '#00D4B4' : '#E5E7EB',
                    cursor: 'pointer',
                    transition: 'all 200ms',
                    padding: 0,
                  }}
                />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={close}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 10,
                  border: '1px solid #E5E7EB',
                  background: 'white',
                  color: '#6B7280',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Lewati
              </button>
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  style={{
                    flex: 1,
                    padding: '9px 0',
                    borderRadius: 10,
                    border: '1px solid #E5E7EB',
                    background: 'white',
                    color: '#374151',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ← Kembali
                </button>
              )}
              <button
                type="button"
                onClick={() => (isLast ? close() : setStep((s) => s + 1))}
                style={{
                  flex: 1.4,
                  padding: '9px 0',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #00D4B4, #00B89E)',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isLast ? 'Mulai Menggunakan 🚀' : 'Lanjut →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
