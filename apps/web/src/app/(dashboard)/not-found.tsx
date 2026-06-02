import Link from 'next/link';

export default function DashboardNotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 32 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 64, fontWeight: 800, color: '#0969DA', marginBottom: 8 }}>404</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Halaman Tidak Ditemukan</h2>
        <p style={{ margin: '0 0 24px', color: '#57606a', fontSize: 14 }}>
          Halaman yang Anda cari tidak ada atau telah dipindahkan.
        </p>
        <Link
          href="/home"
          style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 8, background: '#0969DA', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
        >
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  );
}
