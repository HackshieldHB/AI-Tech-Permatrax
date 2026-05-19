# Finance Dashboard — Daftar Uji Manual (E2E Smoke)

Gunakan checklist ini sebelum produksi atau setelah deploy. Centang setiap langkah yang sudah diverifikasi.

## Pra-kondisi

- [ ] Basis data sudah di-*seed* minimal: 1 pengguna FINANCE, 1 GENERAL_MANAGER, 1 ADMIN, 1 PM (mis. FTTH).
- [ ] Proyek GENERAL (`isDefaultUncategorized`) sudah ada.
- [ ] API berjalan (contoh port dari `.env`), Web berjalan (biasanya `3000`).
- [ ] Browser bersih atau sesi login terpisah per peran.

---

## Skenario 1 — Buat proyek (happy path)

- [ ] Login sebagai **FINANCE**.
- [ ] Buka `/finance-projects`.
- [ ] Klik **Tambah Project** (tombol tidak tampil untuk ADMIN-only view jika hanya browse — uji sebagai FINANCE).
- [ ] Isi: Nama `Test Alpha`, Total budget `100000000`, Material `60000000`, Jasa `40000000`.
- [ ] Submit.
- [ ] **Harapan:** redirect ke detail; kode `FIN-YYYY-XXX` terisi.
- [ ] (Opsional SQL) `SELECT * FROM "FinanceProject" WHERE name = 'Test Alpha';`
- [ ] **Harapan:** ada baris ledger `BUDGET_INIT` untuk proyek tersebut.

## Skenario 2 — Order auto-deduct

- [ ] Login sebagai **PM** (peran yang boleh buat order).
- [ ] Buka `/orders/new`, pilih alur katalog atau approval sesuai kebutuhan.
- [ ] Pilih proyek finance selain GENERAL (atau GENERAL jika hanya uji koneksi).
- [ ] Submit order yang memicu potongan budget (sesuai alur bisnis Anda).
- [ ] Buka `/finance-projects/[id]` tab **Transaksi**.
- [ ] **Harapan:** entri `DEDUCT_*` dengan sumber ORDER terhubung.

## Skenario 3 — Cash advance auto-deduct

- [ ] Login sebagai peran yang boleh **Cash Operation**.
- [ ] Buka `/cash-operation/new`, pilih proyek finance, ajukan request yang disetujui dan memotong budget.
- [ ] Di detail proyek keuangan, tab Transaksi.
- [ ] **Harapan:** entri sumber `CASH_OP`.

## Skenario 4 — Notifikasi ambang 80%

- [ ] Siapkan proyek dengan utilisasi material atau jasa mendekati/melewati 80% (data uji atau seed).
- [ ] Lakukan transaksi yang mendorong utilisasi ≥ 80%.
- [ ] **Harapan:** notifikasi/threshold sesuai implementasi backend (socket/in-app) terpicu untuk peran yang dituju.

## Skenario 5 — Overbudget 100%

- [ ] Dorong realisasi sehingga melewati plafon kategori atau total (sesuai aturan bisnis).
- [ ] **Harapan:** flag `isOverbudget` / tampilan **OVERBUDGET** di kartu dashboard; notifikasi jika ada.

## Skenario 6 — Penolakan edit budget (total &lt; realisasi)

- [ ] Login **FINANCE** atau **GM**, buka proyek aktif dengan realisasi &gt; 0.
- [ ] **Pengaturan** → isi total budget baru **lebih kecil** dari materialSpent + jasaSpent.
- [ ] **Harapan:** pesan error di UI; request API ditolak dengan pesan Bahasa Indonesia.

## Skenario 7 — Transfer: ajukan + GM setujui

- [ ] Login **FINANCE** → `/finance-projects/transfer/new`, isi sumber/target, nominal valid, alasan ≥ 10 karakter.
- [ ] Konfirmasi modal, submit.
- [ ] Login **GM** → buka detail transfer **Pending**, **Setujui**.
- [ ] **Harapan:** status Disetujui; alokasi proyek berubah (cek di detail kedua proyek).

## Skenario 8 — Transfer ditolak GM

- [ ] GM buka transfer pending, **Tolak** dengan alasan wajib.
- [ ] **Harapan:** status Ditolak; pengaju melihat alasan.

## Skenario 9 — Transfer dibatalkan pengaju

- [ ] FINANCE membuat transfer pending, lalu buka detail sebagai pengaju, **Batalkan**.
- [ ] **Harapan:** status Dibatalkan.

## Skenario 10 — Tampilan Forecast

- [ ] Buka detail proyek → tab **Forecast**.
- [ ] **Harapan:** kartu burn rate, estimasi habis, proyeksi; grafik garis; banner peringatan jika `isReliable: false`.

## Skenario 11 — Export Excel proyek

- [ ] Di detail proyek, tombol Export Excel (atau endpoint `/finance-reports/project/:id/excel` dengan token).
- [ ] **Harapan:** file terunduh; buka dengan Excel — ada sheet Summary, Ledger, Adjustments.

## Skenario 12 — Export PDF ringkasan / proyek

- [ ] Export PDF (ringkasan atau per proyek sesuai UI).
- [ ] **Harapan:** file dimulai dengan `%PDF-`; buka di viewer — cek nama proyek dan angka ringkas secara visual (**verifikasi manual konten teks** disarankan).

## Skenario 13 — Permission PM (tidak mengelola)

- [ ] Login **PM**, buka `/finance-projects`.
- [ ] **Harapan:** tidak ada tombol **Tambah Project** / **Transfer**; tidak ada ikon **Pengaturan** di detail; tetap bisa melihat daftar/detail jika peran ada di `FINANCE_PROJECT_VIEW`.

## Skenario 14 — Proyek GENERAL

- [ ] Buka detail proyek GENERAL.
- [ ] **Harapan:** modal Pengaturan hanya menampilkan pesan sistem; tidak bisa edit nama/deskripsi/budget.
- [ ] Di form Order/CashOp, GENERAL tampil dengan label **Belum dialokasi** (atau ekuivalen) di picker.

---

**Catatan:** Sesuaikan nomor port, path login, dan data seed dengan lingkungan Anda.
