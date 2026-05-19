# Finance Dashboard — Checklist Deploy Produksi

## Pra-deploy

- [ ] Milestone 1–6 (termasuk Finance Dashboard) sudah dikonfirmasi di staging.
- [ ] **Manual test** `docs/finance-dashboard-manual-test.md` skenario kritis (minimal 1, 7, 13, 14) lulus.
- [ ] Backup DB produksi: `pg_dump` (atau snapshot penyedia cloud) dengan label tanggal/waktu.
- [ ] Komunikasikan jendela maintenance jika ada downtime terencana.
- [ ] Staging: `npx prisma migrate deploy` sukses tanpa error *shadow database* jika relevan.
- [ ] Jika di environment pernah ada rename folder migrasi Prisma: pastikan baris di `_prisma_migrations` konsisten dengan nama folder yang dipakai (perbaikan manual hanya jika tim DB melaporkan mismatch — ikuti runbook migrasi internal).
- [ ] Dependensi API: `exceljs` dan `pdfkit` ada di `apps/api/package.json` (dependency, bukan hanya dev).
- [ ] Variabel lingkungan baru (jika ada untuk modul finance) terdokumentasi dan di-set di server.

## Phase 2 — Cash Advance refactor (realisasi)

- [ ] Dependensi API: **`date-fns-tz`** (sudah di `apps/api` untuk jendela realisasi WIB); `pnpm install` di root setelah pull.
- [ ] Migrasi Prisma: terapkan folder **`20260430120000_cash_advance_realisasi_refactor`** (`CashOpRealisasiItem`, `CashOpRealisasiStep`, kolom realisasi & periode pada `CashOperationRequest`, dll.).
- [ ] Permission / role: **`CASH_OP_REALISASI_FINANCE_APPROVE`** (FINANCE), **`CASH_OP_REALISASI_GM_APPROVE`** (GENERAL_MANAGER) — lihat `apps/api/src/auth/permissions.ts`.
- [ ] **Perubahan perilaku (breaking):** untuk Reimbursement **post–Phase 2** dengan `finalApprovedAmount` terisi, **`POST /cash-operation/:id/disburse`** mengembalikan **400** (alur reimbursement tanpa pencairan terpisah).
- [ ] Event socket (opsional verifikasi): `cashOp:realisasiSubmitted`, `cashOp:realisasiFinanceApproved`, `cashOp:realisasiFinanceRejected`, `cashOp:realisasiGmApproved`, `cashOp:realisasiGmRejected` — daftar uji manual: `docs/cash-advance-refactor-manual-test.md`.

## Phase 3 — Procurement unification (Order + Supplier + Tagihan + Stock Out)

- [ ] **Manual test** wajib: `docs/procurement-unification-manual-test.md` (minimal happy path PROJECT_REQUEST + RESTOCK).
- [ ] **Ringkasan arsitektur:** `docs/procurement-unification-overview.md`; **production readiness:** `docs/phase3-production-readiness.md`.
- [ ] Migrasi Prisma Phase 3: urutan seperti yang dirilis tim (hapus/pemisahan `StockRequest`, model `Supplier`, `SupplierInvoice`, `StockOut`, perluasan kolom Order). Jalankan **`npx prisma migrate deploy`** pada environment target; hindari rollback skema destructif tanpa backup.
- [ ] Seed / proyek **INVENTORY** (finance project untuk restock gudang) tersedia setelah migrate + seed sesuai skrip tim.
- [ ] Env API (email procurement): **`PROCUREMENT_FROM_EMAIL`** bersifat opsional; jika kosong digunakan **`SMTP_FROM`** lalu **`SMTP_USER`** (`ProcurementMailService`). SMTP utama tetap **`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`**.
- [ ] Permission baru: Purchasing, pemisahan jalur PROJECT_REQUEST vs STOCK_RESTOCK, endpoint `purchasing/*`, `suppliers`, `supplier-invoices`, `stock-out` — cek **`apps/api/src/auth/permissions.ts`**.
- [ ] **Perubahan perilaku (breaking):** pemotongan budget material pada **`gmApprove`**; **`POST /orders/:id/finance-process`** tidak lagi mengurangi budget (hanya mencatat bukti & status **PURCHASED**).

## Urutan deploy (penting)

1. Pull kode/tag rilis yang disetujui.
2. `pnpm install` di root monorepo (jika ada lockfile baru).
3. `cd packages/db && npx prisma generate`
4. `cd packages/db && npx prisma migrate deploy`
5. Verifikasi migrasi:  
   `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 10;`
6. Build:
   - `cd apps/api && pnpm exec nest build`
   - `cd apps/web && pnpm exec next build`
7. Restart layanan: **API terlebih dahulu**, lalu **web** (atau sesuai orkestrasi container Anda).
8. Health check: `GET /api/health` (jika tersedia).
9. Smoke test cepat: login FINANCE → buka `/finance-projects` → satu kali navigasi detail.

## Pasca-deploy

- [ ] Proyek GENERAL ada:  
  `SELECT id, code, "isDefaultUncategorized" FROM "FinanceProject" WHERE "isDefaultUncategorized" = true;`
- [ ] Entri `BUDGET_INIT` untuk GENERAL ada (cek lewat UI atau query `BudgetLedger`).
- [ ] Index/unik partial pada `BudgetLedger` sesuai migrasi terakhir (verifikasi dengan tim DB jika perlu: `\d "BudgetLedger"` di `psql`).
- [ ] Buat proyek baru lewat UI (FINANCE).
- [ ] Form Order/CashOp menampilkan picker proyek keuangan.
- [ ] Menu **Finance Projects** hanya untuk FINANCE / GM / ADMIN; peran lain tidak melihat item tersebut.

## Rollback (ringkas)

- Isu minor: hotfix branch + redeploy.
- Isu mayor aplikasi: deploy ulang image/binari versi sebelum fitur Finance **tanpa** rollback migrgsi DB jika migrasi **additive only** (tabel/kolom baru, nullable). Lihat `docs/finance-dashboard-rollback.md`.

## Verifikasi manual lanjutan

- [ ] Buka file PDF hasil export di Acrobat/browser — pastikan layout dan angka masuk akal (otomatis tes hanya memeriksa magic bytes & struktur Excel).
