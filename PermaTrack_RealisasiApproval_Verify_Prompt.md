# PermaTrack — Realisasi Approval Fix Verification
> Paste ke Cursor Chat (Agent mode).
> **Tujuan**: Verifikasi bahwa semua 22 fix dari PermaTrack_RealisasiApproval_Fix_Prompt.md sudah ter-apply dengan benar.
> **Jangan ubah apapun** — hanya baca dan laporkan.

---

## CARA VERIFIKASI

Jalankan setiap perintah grep di bawah dari root repo. Bandingkan hasil dengan expected.

---

## BAGIAN 1 — `apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts`

### Check B1 — Tidak ada `await this.notifications.` yang tersisa

```bash
grep -n "await this\.notifications\." apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts
```

**Expected**: output kosong (0 baris). Kalau ada hasil → ada notification yang masih di-await → BUG.

---

### Check B2 — Semua notification call punya `.catch(() => {})`

```bash
grep -n "this\.notifications\." apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts
```

**Expected**: setiap baris yang muncul harus diakhiri dengan `.catch(() => {})` ATAU merupakan `this.notifications.emitRealtime(...)` (synchronous, tidak perlu `.catch`).

---

### Check B3 — `approveByOps` menggunakan `$transaction`

```bash
grep -n "\$transaction" apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts
```

**Expected**: minimal 3 kemunculan — satu di `approveByOps`, satu di `approveByGm`, sisanya di method yang sudah ada sebelumnya (`editAndApproveByFinance`, `resubmitRealisasi`).

---

### Check B4 — `approveByOps` tidak lagi memanggil `this.prisma.cashOpRealisasiStep` secara langsung (harus lewat `tx`)

```bash
grep -n "this\.prisma\.cashOpRealisasiStep" apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts
```

**Expected**: output kosong atau hanya di method lain. Di dalam `approveByOps` dan `approveByGm`, semua DB calls harus pakai `tx.`, bukan `this.prisma.`.

---

## BAGIAN 2 — `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`

### Check F1 — Pattern A: Tidak ada `return` di dalam catch sebelum `refreshAfterApproval`

Jalankan perintah ini dan baca hasilnya dengan cermat:

```bash
grep -n "return;" apps/web/src/app/\(dashboard\)/cash-operation/\[id\]/page.tsx
```

Untuk setiap baris `return;` yang muncul, pastikan konteksnya BUKAN di dalam catch block yang diikuti `refreshAfterApproval`. Cara cek: lihat baris sekitar hasil grep tersebut:

```bash
grep -n -A 3 -B 3 "return;" apps/web/src/app/\(dashboard\)/cash-operation/\[id\]/page.tsx
```

**Expected**: `return;` yang tersisa hanya boleh ada di:
- Guard clauses di awal fungsi (e.g. `if (!id) return;`, `if (!reason.trim()) return;`)
- Bukan di dalam catch block yang diikuti `refreshAfterApproval`

---

### Check F2 — Pattern B: `refreshAfterApproval` dipanggil di luar try block

```bash
grep -n "refreshAfterApproval" apps/web/src/app/\(dashboard\)/cash-operation/\[id\]/page.tsx
```

**Expected**: Semua handler approve/reject harus punya `refreshAfterApproval`. Handler yang harus ada:
- `handleOpsApprove` ✓
- `handleOpsReject` ✓
- `handleMarketingHeadApprove` ✓
- `handleMarketingHeadReject` ✓
- `handleFinanceApprove` ✓
- `handleFinanceReject` ✓
- `handlePmApprove` ✓
- `handlePmReject` ✓
- `handleGmApprove` ✓
- Inline GM reject onClick ✓
- `onApproveStage1` ✓ (sudah ada sebelumnya)
- `onResubmitRealisasi` ✓ (sudah ada sebelumnya)

Total minimal **12 kemunculan** `refreshAfterApproval` di file ini.

---

### Check F3 — `loadDetail()` + `loadBundle()` tidak ada di dalam try block handler approve/reject

```bash
grep -n "await loadDetail\|await loadBundle" apps/web/src/app/\(dashboard\)/cash-operation/\[id\]/page.tsx
```

**Expected**: Kemunculan `await loadDetail` / `await loadBundle` yang tersisa hanya boleh ada di:
- `onSaveRealisasiDraft` (bukan handler approval)
- `onSubmitRealisasi` (bukan handler approval)
- `onRejectStage1` (stage 1, bukan realisasi)
- `onRepairCashOpApproval`

Handler approve/reject realisasi (`handleOpsReject`, `handleMarketingHeadReject`, `handleFinanceReject`, `handlePmReject`, `onRealisasiRejectFinance`) **tidak boleh** punya `await loadDetail`/`await loadBundle` di dalam try block mereka.

---

## LAPORAN YANG DIHARAPKAN

Setelah menjalankan semua check, laporkan dalam format ini:

```
B1 — await notifications: PASS / FAIL (N baris ditemukan)
B2 — .catch(() => {}): PASS / FAIL
B3 — $transaction count: PASS (N kemunculan) / FAIL
B4 — this.prisma.* di approveByOps/approveByGm: PASS / FAIL
F1 — return; di catch handler: PASS / FAIL (list baris yang mencurigakan)
F2 — refreshAfterApproval count: PASS (N kemunculan) / FAIL
F3 — loadDetail/loadBundle di dalam try approval handlers: PASS / FAIL
```

Kalau ada FAIL, sebutkan baris yang bermasalah dan tunjukkan kode yang ada sekarang vs yang seharusnya.
