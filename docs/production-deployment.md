# Production deployment — PermaTrack

Catatan operasional untuk VPS monolit (API + web + Postgres + Redis). Lengkapi dengan secret management dan backup sesuai kebijakan organisasi Anda.

---

## Database connection pool sizing

PermaTrack memakai **Prisma**; ukuran pool koneksi ke PostgreSQL sangat penting agar beban ~100 pengguna konkuren tidak menyebabkan kehabisan koneksi (`too many clients`).

### Rumus

- **PM2 instances** = jumlah worker Node yang menjalankan API (mis. `instances: 'max'` pada VPS 8 core ≈ 8 worker).
- **Per-worker pool** = nilai `connection_limit` pada query string `DATABASE_URL`.
- **Total koneksi aplikasi ke Postgres** ≈ `workers × connection_limit` ditambah margin untuk admin, migrasi, monitoring, dan koneksi lain.
- Total harus **≤ `max_connections`** di PostgreSQL (dan idealnya ada margin nyaman).

### Konfigurasi yang disarankan

**VPS 8 core tanpa PgBouncer** (contoh: 8 worker PM2, `max_connections` Postgres 200):

```text
?connection_limit=5&pool_timeout=20
```

Perkiraan: 8 × 5 = **40** koneksi dari aplikasi; sisa untuk alat DBA, migrasi, dan puncak singkat.

**VPS dengan PgBouncer (disarankan untuk skala 100+ atau banyak worker)**:

```text
?connection_limit=2&pool_timeout=20
```

PgBouncer mode transaksi mengantre klien aplikasi ke jumlah koneksi Postgres yang lebih kecil.

**Pengembangan lokal (satu proses `nest start`)**:

```text
?connection_limit=10&pool_timeout=20
```

### Verifikasi setelah deploy

Di PostgreSQL:

```sql
SELECT count(*), state, application_name
FROM pg_stat_activity
WHERE datname = 'permatrack'
GROUP BY state, application_name
ORDER BY count(*) DESC;
```

Pastikan total sesuai ekspektasi dan tidak menekan batas `max_connections` secara berkelanjutan.

---

## PM2 (API cluster)

- Konfigurasi utama: `ecosystem.config.js` di root monorepo (`permatrax-api` + `permatrax-web`).
- **`PM2_INSTANCES`**: override jumlah worker API jika koneksi DB terlalu padat, mis. `PM2_INSTANCES=4 pm2 start ecosystem.config.js --env production`.
- Log API: `apps/api/logs/` (pastikan direktori ada di server atau sesuaikan `error_file` / `out_file`).

## Redis & Bull

- **`REDIS_URL`** dipakai untuk JWT blacklist, adapter Socket.IO, cache map, antrean Bull (PDF BA Open / BAKP / SLA), dan **antrean email** (`mail-queue`).
- Pastikan `REDIS_URL` di `.env` produksi mengarah ke instance Redis yang sama dapat dijangkau dari semua worker PM2.

## Migrasi database

Setelah pull yang menyertakan indeks baru (`PermitCluster` status + `createdAt`), jalankan migrasi di lingkungan Anda:

```bash
cd packages/db && npx prisma migrate deploy
```

---

## Referensi cepat

- Contoh `DATABASE_URL` dengan komentar: `apps/api/.env.example`
- PM2: `ecosystem.config.js` di root monorepo
- Tuning Postgres (Docker): `docker-compose.yml` — service `db` memakai `shm_size` + `command` override (`shared_buffers`, `max_connections`, dll.). **Catatan dev**: jika container gagal start karena memori, turunkan `shared_buffers` lokal atau gunakan [Compose override file](https://docs.docker.com/compose/extends/).
- Load test (k6): folder `loadtest/`
