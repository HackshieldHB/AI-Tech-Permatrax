# PermaTrack Load Test Results

**Date**: 2026-05-04  
**Target load (design intent)**: ~100 concurrent users (sesuai skenario k6 di repo)  
**Performance goal**: p95 < 1000 ms untuk mayoritas aksi HTTP; p99 < 3000 ms; error rate < 1%  
**Infrastructure observed**: workstation Windows, Docker `permatrack_db` (PostGIS 15), Redis container; API single process lokal (bukan PM2 cluster).

---

## 1. Executive Summary

### Overall result

- [ ] **PRODUCTION READY** — Semua skenario k6 lolos ambang  
- [x] **READY WITH CAUTION** — Migrasi + build OK; **skenario k6 tidak dijalankan** (k6 tidak terpasang di PATH mesin ini)  
- [ ] **NOT READY** — Kegagalan kritis terukur di beban

### Quick stats

| Metric | Value |
|--------|--------|
| Total scenarios run | **0 / 5** (k6 tidak tersedia) |
| Scenarios passed | N/A |
| Critical failures (k6) | N/A — tidak dieksekusi |

### Top findings

1. **Migrasi indeks `PermitCluster` berhasil diterapkan** (`20260504160000_permit_cluster_status_created_at_idx`); indeks `PermitCluster_status_createdAt_idx` terverifikasi di Postgres.  
2. **Build produksi API dan Web sukses** (`nest build`, `next build`).  
3. **k6 tidak terpasang** di lingkungan Cursor — eksekusi beban formal harus diulang setelah instalasi k6.  
4. **PM2 tidak terpasang** — API diuji dengan satu proses Node; untuk target VPS 8 core, cluster PM2 masih action item.  
5. **`pnpm run start:prod` gagal** tanpa pekerjaan tambahan: modul `multer` hanya transitif lewat `@nestjs/platform-express`; resolusi pnpm ketat membuat `require('multer')` dari kode terkompilasi gagal. Untuk sesi ini API dijalankan dengan **`pnpm exec node dist/main`** dan **`NODE_PATH`** yang memuat folder `node_modules` virtual store untuk `multer` dan `express` (workaround operasional lokal, **bukan** perbaikan permanen di repo). Rekomendasi produksi: tambahkan `multer` (dan bila perlu `express`) sebagai **dependensi langsung** `@permatrack/api` atau gunakan kebijakan hoist pnpm yang disepakati tim — **butuh keputusan/PR terpisah** (di luar cakupan “tanpa ubah kode” untuk tugas ini).  
6. **Riwayat migrasi vs DB**: sebelum `migrate deploy`, `prisma migrate status` melaporkan migrasi di DB yang **tidak ada** di folder lokal (`20260501120000_visit_request_dual_pm_gates`, terdaftar duplikat di output). `migrate deploy` tetap berhasil menerapkan migrasi lokal yang pending. Tim sebaiknya **menyelaraskan** branch/folder migrasi dengan keadaan DB agar tidak ada kebingungan di `migrate status` ke depan.

---

## 2. Setup verification

### Migration applied

| Item | Status |
|------|--------|
| `pnpm exec prisma migrate deploy` | **Berhasil** |
| Nama migrasi diterapkan | `20260504160000_permit_cluster_status_created_at_idx` |
| `pnpm exec prisma migrate status` setelah deploy | **"Database schema is up to date!"** |
| Indeks di Postgres | **`PermitCluster_status_createdAt_idx`** — 1 baris pada query verifikasi |

Query verifikasi:

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'PermitCluster' AND indexname LIKE '%status%created%';
```

### Build status

| Component | Command | Result |
|-----------|---------|--------|
| API | `pnpm --filter @permatrack/api exec nest build` | **exit 0** |
| Web | `pnpm --filter @permatrack/web exec next build` | **exit 0** |

### k6 installation

- **Tidak terpasang** (`k6` tidak dikenali di PowerShell pada mesin eksekusi).
- Instalasi disarankan: [dokumentasi resmi k6](https://k6.io/docs/get-started/installation/) atau Chocolatey: `choco install k6`.

### PM2 status

- **Tidak terpasang** (`pm2` tidak dikenali).
- Untuk produksi: `npm install -g pm2` (atau mekanisme deploy yang disepakati) + `ecosystem.config.js` di root repo.

### Test user

- **Pendekatan**: `pnpm exec tsx prisma/seed.ts` di `packages/db` (menjamin user seed).  
- **Akun dipakai untuk login API**: `gm@permatrax.com` / `GMPassword123!` (dari `prisma/seed.ts`; **hanya untuk lingkungan lokal/dev**).  
- **Role**: `GENERAL_MANAGER`.  
- **JWT**: berhasil diperoleh dari `POST http://localhost:3001/api/auth/login` — prefix token (contoh): `eyJhbGciOiJIUzI1NiIsInR5...` (token penuh tidak dicatat di dokumen ini).

### Variabel lingkungan skenario k6 (referensi)

Skrip di repo memakai **`TEST_EMAIL`** dan **`TEST_PASSWORD`** (bukan `LOGIN_EMAIL` / `LOGIN_PASSWORD`). Contoh PowerShell setelah k6 terpasang:

```powershell
$env:BASE_URL = "http://localhost:3001/api"
$env:TEST_EMAIL = "gm@permatrax.com"
$env:TEST_PASSWORD = "GMPassword123!"
k6 run loadtest/scenarios/01-login-storm.js
```

---

## 3. Per-scenario results

**Tidak ada data k6** — skenario tidak dijalankan karena k6 tidak tersedia.

| Scenario | p95 | p99 | Error rate | Iterations | Notes |
|----------|-----|-----|------------|------------|-------|
| 01-login-storm | — | — | — | — | Skip |
| 02-dashboard | — | — | — | — | Skip |
| 03-order-workflow | — | — | — | — | Skip |
| 04-map | — | — | — | — | Skip |
| 05-notification | — | — | — | — | Skip |

---

## 4. Resource utilization (snapshot lokal, tanpa beban k6)

### DB connections

| Snapshot | `count(*)` pada `pg_stat_activity` untuk `datname = 'permatrack'` |
|----------|---------------------------------------------------------------------|
| Baseline (setelah API up + login sekali) | **2** |
| Post-setup (sebelum k6; tidak ada puncak beban) | **2** |
| Pool exhaustion | **Tidak diamati** (tidak ada uji beban) |

### DB stats (`pg_stat_database`, `datname = 'permatrack'`)

Contoh satu baris pada waktu snapshot (nilai kumulatif sejak start Postgres, bukan hanya selama “test”):

| numbackends | xact_commit | xact_rollback | blks_read | blks_hit | deadlocks |
|-------------|-------------|---------------|-----------|----------|-----------|
| 2 | 133 | 3 | 392 | 8570 | 0 |

### Memory (Windows, sampel proses `node`)

Beberapa proses Node aktif di mesin (IDE, tool, dll.). Contoh RSS: ~73–157 MB untuk beberapa PID; satu proses ~1519 MB (kemungkinan besar bukan hanya API). **Tidak ada isolasi proses API murni** pada snapshot ini.

---

## 5. Bottleneck analysis

- **Tidak ada pengukuran beban HTTP** pada sesi ini → tidak ada bottleneck endpoint yang terukur dari k6.  
- **Risiko operasional**: `start:prod` standar gagal tanpa `multer` di path resolusi — berpotensi memblokir deploy “node dist/main” di layout pnpm yang sama kecuali diperbaiki di packaging/dependensi.

---

## 6. Production readiness recommendation

**Pilihan: CONDITIONAL / GO WITH MONITORING (setelah k6)**

- **GO** untuk aspek **skema DB** (indeks diterapkan) dan **artefak build** (API + web).  
- **Belum GO** untuk klaim **kapasitas ~100 user** sampai skenario k6 (minimal 01–05) dijalankan di lingkungan yang representatif (staging / mirror produksi) dan metrik p95/p99/error rate direkam.

**Rationale (Bahasa Indonesia):** Migrasi dan build menunjukkan artefak siap pakai; namun tanpa k6, tidak ada bukti kuantitatif bahwa target latensi dan error rate terpenuhi di bawah beban. Selain itu, masalah resolusi `multer` pada `start:prod` harus diselesaikan sebelum menyamakan lingkungan lokal dengan pipeline deploy produksi.

---

## 7. Action items (dari sesi ini)

1. **Instal k6** dan jalankan ulang `loadtest/scenarios/*.js` dengan `BASE_URL`, `TEST_EMAIL`, `TEST_PASSWORD` (dan `JWT_TOKEN` untuk skenario yang membutuhkannya — lihat masing-masing file).  
2. **Instal PM2** (jika produksi memakai cluster) dan sesuaikan `connection_limit` di `DATABASE_URL` dengan jumlah worker.  
3. **Perbaiki dependensi runtime API** agar `multer` (dan dependensi top-level lain yang di-`require` dari `dist/`) ter-resolve tanpa `NODE_PATH` manual — biasanya dengan dependensi langsung di `package.json` atau konfigurasi linker pnpm.  
4. **Selaraskan riwayat migrasi** antara repo dan database untuk menghilangkan entri “migrations from the database are not found locally”.  
5. **Ulangi load test di staging** dengan spesifikasi infrastruktur target (8 vCPU, 16 GB RAM, dll.) dan kumpulkan `pg_stat_activity` + APM selama puncak beban.

---

## 8. User action items (pre-production)

1. Instal **k6** di workstation atau runner CI yang akan menjalankan beban.  
2. Instal **PM2** (atau orkestrator lain) untuk mode cluster sesuai `ecosystem.config.js`.  
3. Pastikan **`REDIS_URL`** dan **`DATABASE_URL`** konsisten untuk semua worker saat PM2 cluster aktif.  
4. Konfigurasi **monitoring** (Sentry, APM, log agregasi) sebelum go-live.  
5. Setelah perbaikan `multer`/`express`, verifikasi **`pnpm run start:prod`** dari `apps/api` **tanpa** `NODE_PATH` manual.

---

## Appendix A: Raw k6 output

Tidak ada — k6 tidak dijalankan.

---

## Appendix B: Tools used

| Tool | Version / note |
|------|----------------|
| Node.js | v22.22.0 |
| PostgreSQL (container) | 15.4 (Debian image) |
| Prisma CLI | 5.22.0 (pesan upgrade ke 7.x muncul di output migrate) |
| k6 | **not installed** |
| PM2 | **not installed** |

---

## Appendix C: Verifikasi file skenario

Perintah setara: `Get-ChildItem loadtest/scenarios/*.js`

- `01-login-storm.js`  
- `02-dashboard.js`  
- `03-order-workflow.js`  
- `04-map.js`  
- `05-notification.js`  

Dokumentasi: `loadtest/README.md` (baris awal memuat prasyarat k6, variabel `TEST_EMAIL` / `TEST_PASSWORD`, dan target audit).
