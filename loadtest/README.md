# PermaTrack — skenario beban (k6)

## Prasyarat

- [k6](https://k6.io/docs/get-started/installation/) terpasang di PATH.
- API berjalan (mis. `pnpm run start:prod` di `apps/api` atau PM2).
- Akun uji di database (`TEST_EMAIL` / `TEST_PASSWORD`).

## Menjalankan

PowerShell:

```powershell
$env:BASE_URL = "http://127.0.0.1:3001/api"
$env:TEST_EMAIL = "loadtest@example.com"
$env:TEST_PASSWORD = "ganti-password-anda"
k6 run loadtest/scenarios/01-login-storm.js
```

Semua skenario:

```powershell
Get-ChildItem loadtest/scenarios/*.js | ForEach-Object { k6 run $_.FullName }
```

## Kriteria lulus (target audit)

- p95 latency HTTP < 1000 ms untuk mayoritas endpoint
- p99 < 3000 ms
- Tingkat gagal < 1%
- CPU Postgres stabil < ~70% di puncak skenario
- Memori proses Node sesuai batas PM2

## Catatan

- Sesuaikan path login (`/auth/login` vs `/api/auth/login`) dengan prefix global Nest Anda.
- Skenario socket (notifikasi) di `05-notification.js` adalah placeholder polling HTTP; WebSocket load perlu tooling terpisah.
