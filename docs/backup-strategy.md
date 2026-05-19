# PermaTrack — Strategi Backup

## Pemilik proses

- **Backup owner**: pemilik proyek / tim operasional.
- **Frekuensi**:
  - Manual: sebelum deploy produksi dan sebelum migrasi schema berisiko.
  - Otomatis (disarankan): snapshot mingguan (jadwalkan `scripts/backup.ps1` lewat Task Scheduler).
- **Retensi**: 7 hari rolling untuk backup harian; snapshot bulanan disimpan 12 bulan (sesuaikan kebijakan penyimpanan).

## Yang di-backup

1. **PostgreSQL** — seluruh data aplikasi + riwayat migrasi (`_prisma_migrations`).
2. **File upload** — folder `apps/api/uploads/` (atau bucket cloud setelah deploy).
3. **Konfigurasi** — salinan aman file `.env` (jangan commit ke git); template tetap di `.env.example`.

## Prosedur manual (pre-deploy / pre-migration)

Gunakan skrip repositori:

```powershell
cd "D:\Projects\AI Tech\PermaTrack"
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
```

Variabel opsional:

- `PERMATRACK_BACKUP_ROOT` — folder induk backup (default `D:\backups`).
- `DATABASE_URL` — jika tidak di-set, skrip mencoba membaca `packages\db\.env`.

Skrip menghasilkan folder `PermaTrack_yyyyMMdd_HHmm` berisi:

- `project_partial.zip` — salinan sumber tanpa `node_modules`, `.next`, `dist`, `.git`.
- `database.sql` — jika `pg_dump` tersedia dan URL DB terbaca.
- `uploads.zip` — jika folder uploads ada.

## Jadwal otomatis (Windows)

1. Task Scheduler → Create Basic Task.
2. Trigger: Weekly (mis. Senin 03:00).
3. Action: `powershell.exe -ExecutionPolicy Bypass -File "D:\Projects\AI Tech\PermaTrack\scripts\backup.ps1"`.

## Restore

### Folder proyek

Ekstrak `project_partial.zip` ke lokasi kerja baru, lalu `pnpm install`, `pnpm exec prisma migrate deploy`, build ulang.

### Database

**Merusak data yang ada.** Drop/create database kosong, lalu:

```bash
psql -U postgres -d permatrack -f "D:\backups\PermaTrack_YYYYMMDD_HHMM\database.sql"
```

### Uploads

Ekstrak `uploads.zip` ke `apps\api\uploads\`.

## Checklist disaster recovery

1. Hentikan API dan web.
2. Pilih backup terakhir yang valid di folder backup.
3. Verifikasi ukuran/isi arsip dan `database.sql`.
4. Restore database (lihat atas).
5. Restore kode/uploads bila perlu.
6. `cd packages/db` → `pnpm exec prisma migrate deploy`.
7. `pnpm exec prisma migrate status` harus menunjukkan schema up to date.
8. Jalankan ulang layanan; smoke test: login, order, stok.
9. Post-mortem: catat akar masalah dan perbaikan proses.

## Verifikasi bulanan

- Restore ke DB staging dari backup terbaru.
- Smoke test ringkas.
- Perbarui dokumentasi ini jika prosedur berubah.

## Keamanan migrasi

1. **Wajib** `pg_dump` sebelum migrasi destruktif.
2. Uji di staging bila tersedia.
3. Komunikasi maintenance window bila downtime.

## Peningkatan ke depan

- Managed DB (RDS, dll.) dengan snapshot otomatis.
- Backup off-site (S3, Blob).
- Alert jika job backup gagal.
