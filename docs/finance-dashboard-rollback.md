# Finance Dashboard — Rencana Rollback Operasional

## Skenario A — Bug minor (UI / teks / kosmetik)

- Buat branch hotfix, perbaiki, jalankan `nest build` + `next build`, redeploy.
- Tidak perlu menyentuh basis data.

## Skenario B — Bug mayor (logika bisnis, integrasi)

### 1. Rollback aplikasi

- Deploy kembali versi sebelumnya (tag Git / image Docker / artefak CI) untuk **API** dan **Web**.
- Setelah rollback, endpoint Finance Dashboard tidak tersedia di UI versi lama, namun data yang sudah tertulis di DB tetap ada.

### 2. Pertimbangan basis data

- Prisma **tidak** mendukung `migrate down` otomatis di produksi.
- Migrasi Finance yang telah diterapkan seharusnya **aditif**: tabel baru (`FinanceProject`, `BudgetLedger`, `BudgetTransfer`), kolom baru nullable pada entitas yang sudah ada (`Order`, `CashOperation`, dll. sesuai skema Anda).
- **Aman secara umum:** aplikasi lama yang tidak mengenal modul finance mengabaikan tabel/kolom baru; tidak ada penghapusan data modul lama.
- **Kolom / tabel finance** boleh tetap ada pasca-rollback aplikasi; tidak mengganggu alur Visit Request atau modul lain yang terkunci dari perubahan.

### 3. Verifikasi setelah rollback app

- Uji alur kritis non-finance: Visit Request, Order lama, Cash Op (path tanpa dependensi wajib `financeProjectId` jika kolom nullable).
- Pantau log error terkait FK / constraint jika ada integrasi opsional yang diasumsikan terisi.

## Skenario C — Gagal saat `migrate deploy`

- Jika migrasi **gagal sebelum commit**: tidak ada perubahan skema permanen; perbaiki penyebab (hak akses, SQL), deploy ulang migrasi.
- Jika migrasi **sebagian terpakai**: jangan asumsikan rollback otomatis; investigasi `_prisma_migrations` dan log Postgres; libatkan DBA.

## Hard rollback (kasus terburuk)

1. Hentikan lalu lintas ke aplikasi (maintenance page / load balancer).
2. Pulihkan snapshot DB **pra-deploy** (hanya jika tim memutuskan kehilangan data pasca-snapshot dapat diterima).
3. Deploy versi kode yang cocok dengan skema snapshot tersebut.
4. Post-mortem: dokumentasikan akar masalah dan perbaikan migrasi.

## Phase 2 — Cash Advance realisasi

- Migrasi **aditif**: tidak ada `DROP`; rollback **hanya aplikasi** (deploy binary lama) umumnya **aman** tanpa restore DB.
- Tabel baru (`CashOpRealisasiItem`, `CashOpRealisasiStep`) tidak mengganggu jika build lama tidak mengakses endpoint baru.
- Kolom baru di `CashOperationRequest` (`periodeFrom` / `periodeTo`, `finalApprovedAmount`, kolom realisasi, dll.) nullable atau kompatibel dengan kode lama.
- Deteksi **legacy**: `finalApprovedAmount IS NULL` mempertahankan alur lama (termasuk disburse legacy bila berlaku).
- Endpoint realisasi Phase 2 tidak ada di rilis lama — tidak merusak modul lain.

## Phase 3 — Procurement unification

- Migrasi Phase 3 dapat mencakup **DROP TABLE** / penghapusan modul **`StockRequest`** dan penambahan banyak tabel baru. Ini **tidak reversible** secara aman hanya dengan “migrate down”; data modul StockRequest yang hilang tidak kembali.
- **Rekomendasi:** backup penuh database **sebelum** `prisma migrate deploy` Phase 3 di staging/produksi (`pg_dump` atau snapshot penyedia).
- Jalur rollback operasional: **restore dari backup** + deploy artefak kode **pra-Phase 3** yang konsisten dengan skema backup tersebut. Rollback aplikasi saja dengan DB yang sudah termigrasi dapat menyebabkan error runtime atau data orphan jika tidak disengaja.
- Jika Phase 3 hanya diuji di dev dengan data test: dokumentasikan keputusan tidak restore (acceptable loss untuk environment non-prod).

## Pesan untuk tim

- Rollback **aplikasi saja** tanpa restore DB adalah jalur default jika migrasi aditif.
- Restore DB penuh adalah langkah berat; hanya jika ada kerusakan data yang tidak dapat diperbaiki inkremental.
