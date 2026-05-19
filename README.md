# PermaTrax

Platform manajemen perizinan dan pra-konstruksi jaringan fiber optik (FTTH / FTTB / FTTT). Mengelola siklus lengkap dari survei lapangan, perizinan cluster, desain HLD/LLD, sosialisasi, kompensasi, dokumentasi legal, hingga pelepasan konstruksi—plus modul stok, procurement, cash operation, dan dashboard keuangan.

**Monorepo:** `pnpm` + Turborepo · **API** port `3001` · **Web** port `3000`

---

## Tech stack

| Lapisan | Teknologi |
|--------|-----------|
| Backend | NestJS 10, Prisma ORM, PostgreSQL + PostGIS, Redis, Bull |
| Frontend | Next.js 14 (App Router), TailwindCSS, MapLibre GL |
| Real-time | Socket.IO (+ Redis adapter di produksi) |
| Dokumen | PDFKit, penyimpanan file lokal / S3 |
| Auth | bcrypt, Passport JWT, refresh token, blacklist Redis |

---

## Struktur proyek

```
PermaTrack/
├── apps/
│   ├── api/          # NestJS REST + WebSocket
│   └── web/          # Next.js dashboard
├── packages/
│   └── db/           # Prisma schema, migrasi, seed
├── docs/             # Panduan deploy, finance, procurement, dll.
├── docker-compose.yml
├── ecosystem.config.js   # PM2 cluster (API) + fork (Web)
├── nginx/permatrax.conf  # Nginx reverse proxy + SSL
├── start.sh / stop.sh    # PM2 start/stop
├── full-setup.sh         # Setup produksi AlmaLinux (build + DB + Nginx + SSL + PM2)
└── full-setup-ubuntu.sh  # Setup OS Ubuntu/Debian (legacy)
```

---

## Role pengguna

| Role | Deskripsi singkat |
|------|-------------------|
| `GENERAL_MANAGER` | Akses penuh, pengaturan, feature flags, clean list |
| `PM_SENIOR` | Approval DRM, BAK, monitoring pipeline |
| `PM_FTTH` / `PM_FTTB` / `PM_FTTT` | APD, alur perizinan per tipe fiber |
| `SURVEYOR_FTTH` / `FTTB` / `FTTT` | Kunjungan lapangan, input survei |
| `DESIGNER` | Upload & revisi HLD / LLD |
| `ADMIN` | Validasi dokumen, BAKP, approval admin |
| `ADMIN_STOCK` | Stok, surat jalan, verifikasi barang |
| `FINANCE` | Purchase request, pembayaran, dashboard budget |
| `OPERATIONAL_MANAGER` | Approval operasional (kontrak, cash op) |
| `MARKETING` / `MARKETING_HEAD` | Alur marketing & realisasi CA |
| `PURCHASING` | Procurement, supplier, PO |

---

## Prasyarat

- **Node.js** ≥ 18 (disarankan 20 LTS)
- **pnpm** 9 (`corepack enable`)
- **Docker** (PostgreSQL/PostGIS + Redis untuk development)
- Git

---

## Quick start (development)

### 1. Clone & install

```bash
git clone https://github.com/HackshieldHB/AI-Tech-Permatrax.git
cd AI-Tech-Permatrax
pnpm install
```

### 2. Infrastruktur lokal

```bash
docker compose up -d
```

Menyalakan PostgreSQL (PostGIS) di `localhost:5432` dan Redis di `localhost:6379`.

### 3. Environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
```

Sesuaikan minimal:

- `apps/api/.env` → `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, `FRONTEND_URL`
- `apps/web/.env.local` → `NEXT_PUBLIC_API_URL=http://localhost:3001/api`

Contoh `DATABASE_URL` development:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/permatrack?schema=public&connection_limit=10&pool_timeout=20
```

### 4. Database

```bash
cd packages/db
# salin DATABASE_URL yang sama ke packages/db/.env jika belum ada

npx prisma migrate dev
npx prisma generate
npx prisma db seed
```

**Produksi / staging:**

```bash
cd packages/db
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
```

Seed **idempotent**: 54 user dari `prisma/seed-users.json` dengan hash bcrypt asli (password tidak di-reset).

**Export ulang user dari DB:**

```bash
cd packages/db
npx tsx scripts/generate-seed-users-json.ts
```

### 5. Jalankan aplikasi

```bash
# Terminal 1
cd apps/api && pnpm start:dev

# Terminal 2
cd apps/web && pnpm dev
```

| Layanan | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Health | http://localhost:3001/api/health |

---

## Akun uji (@permatrax.com)

Password demo: **`Permatrax@2026`**

| Email | Role |
|-------|------|
| admin@permatrax.com | ADMIN |
| gm@permatrax.com | GENERAL_MANAGER |
| pm@permatrax.com | PM_SENIOR |
| pm.ftth@permatrax.com | PM_FTTH |
| designer@permatrax.com | DESIGNER |
| surveyor@permatrax.com | SURVEYOR_FTTH |
| finance@permatrax.com | FINANCE |

User `@ilt.co.id` ikut di-seed dengan password asli dari database (umumnya `Permatrack1` untuk akun bulk import).

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@permatrax.com","password":"Permatrax@2026"}'
```

---

## Perintah berguna (root)

| Perintah | Keterangan |
|----------|------------|
| `pnpm build` | Build semua app |
| `pnpm dev` | Dev mode (Turbo) |
| `pnpm db:seed` | Seed database |
| `pnpm db:studio` | Prisma Studio |

---

## Deployment produksi

### VPS AlmaLinux (hybrid — disarankan)

| Layer | Teknologi |
|-------|-----------|
| Data | Docker Compose → PostgreSQL + Redis (`127.0.0.1` only) |
| Apps | PM2 → API (:3001) + Web (:3000) |
| Edge | Nginx native + Let's Encrypt |

**Repo:** `https://github.com/HackshieldHB/AI-Tech-Permatrax.git`  
**Path server:** `/var/www/Permatrax`

```bash
# On production server (AlmaLinux)

# 1. Clone repo
git clone https://github.com/HackshieldHB/AI-Tech-Permatrax.git /var/www/Permatrax
cd /var/www/Permatrax

# 2. Copy .env from local machine
# Run this on LOCAL machine:
scp .env.production user@YOUR_SERVER_IP:/var/www/Permatrax/.env

# 3. Back on server — set permissions and run setup
chmod 600 .env
chmod +x full-setup.sh start.sh stop.sh restart.sh
./full-setup.sh
```

**Setelah update kode:**

```bash
cd /var/www/Permatrax
git pull origin main
./restart.sh
```

**Operasi harian:**

```bash
./start.sh              # start all
./stop.sh               # stop all
./restart.sh            # rebuild + reload
pm2 status              # check status
pm2 logs                # live logs
docker compose -f docker-compose.prod.yml ps   # check DB
```

| URL | Backend |
|-----|---------|
| https://permatrax.tech | Next.js :3000 |
| https://api.permatrax.tech | NestJS :3001 |

Setelah setup, jalankan perintah `sudo` dari `pm2 startup` agar app hidup lagi setelah reboot.

**File uploads (local disk, not S3):** Documents are stored under `apps/api/uploads/` and served at `https://api.permatrax.tech/api/files/…`. Include `apps/api/uploads/` in your server backup strategy. Do not delete this folder — it contains all user-uploaded documents (signatures, HLD/LLD, BAKP, evidence photos, etc.).

Detail: [`docs/production-deployment.md`](docs/production-deployment.md)

### Docker Compose (dev lokal)

```bash
docker compose up -d          # Postgres + Redis (port publik untuk dev)
```

### Checklist database di server

```bash
cd packages/db && npx prisma migrate deploy && npx prisma generate && npx prisma db seed
cd ../../apps/api && pnpm build
cd ../web && pnpm build && pnpm start
```

---

## Alur perizinan (ringkas)

1. GM import **Clean List** → Surveyor **Visit Request** → approval PM / PM Senior / Admin
2. **BA Open** + **Permit Cluster** → APD / ABD / SIP / HLD / LLD
3. Sosialisasi, kompensasi, BAK, SCOM, **BAKP**
4. PR/BR, kontrak, SKOM, claim, invoice → siap konstruksi

Modul tambahan: stok & order, procurement, cash operation, finance dashboard.

---

## Dokumentasi

| Topik | File |
|-------|------|
| Deploy & PM2 | `docs/production-deployment.md` |
| Finance | `docs/finance-dashboard-deployment.md` |
| Procurement | `docs/procurement-unification-overview.md` |
| Cash advance | `docs/cash-advance-refactor-manual-test.md` |
| Backup | `docs/backup-strategy.md` |

---

## Environment penting

| Variabel | Lokasi |
|----------|--------|
| `DATABASE_URL` | `apps/api/.env`, `packages/db/.env` |
| `REDIS_URL` | `apps/api/.env` |
| `JWT_SECRET` | `apps/api/.env` |
| `NEXT_PUBLIC_API_URL` | `apps/web/.env.local` |

Jangan commit `.env` berisi secret produksi.

---

## Lisensi

Proprietary — internal AI-Tech / ILT.
