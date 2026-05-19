# Cash Advance Refactor Manual Test Checklist

## Pre-condition

- [ ] DB seeded user FINANCE, GM, ADMIN, PM, Surveyor
- [ ] Apps running: API + Web
- [ ] Browser/Postman ready, 2 tabs untuk multi-role test

## Skenario CA-1: Cash Advance Stage 1 Happy Path

- [ ] Login as Surveyor
- [ ] Klik "Buat Request" → "Cash Advance"
- [ ] Fill: title, notes, amount Rp 1.000.000, periodeFrom 1 Mar 2026, periodeTo 5 Mar 2026
- [ ] Verify: form TIDAK ada lineItems / foto
- [ ] Submit
- [ ] Expected: status DRAFT, redirect ke detail
- [ ] Klik "Submit untuk Approval"
- [ ] Expected: status SUBMITTED, chain dimulai
- [ ] DB verify: SELECT amount, "periodeFrom", "periodeTo", status FROM "CashOperationRequest" WHERE id = '<id>';

## Skenario CA-2: Approval Chain dengan Lower Amount

- [ ] Login as PM (next approver di chain)
- [ ] Open detail Cash Advance
- [ ] Klik "Setujui"
- [ ] Modal muncul: "Nominal pengajuan: Rp 1.000.000", input pre-filled 1.000.000
- [ ] Ubah ke 800.000
- [ ] Klik "Setujui"
- [ ] DB verify: SELECT "approvedAmount" FROM "CashOpApprovalStep" WHERE "stepOrder" = 2;
- [ ] Login as Admin → approve dengan amount 800.000 (no change)
- [ ] Login as Ops Manager → approve dengan amount 700.000
- [ ] Login as GM (karena amount 700.000 ≤ 1jt sebelum lowered, masih lewat GM? cek logic) → approve 700.000
- [ ] Login as Finance → approve 700.000
- [ ] Expected: status APPROVED, finalApprovedAmount = 700.000
- [ ] DB verify: SELECT "finalApprovedAmount", status FROM "CashOperationRequest";
- [ ] Verify: BudgetLedger entry DEDUCT_JASA dengan amount 700.000

## Skenario CA-3: Approval Try Raise Above Ceiling

- [ ] Setup: Cash Advance lain, step PM sudah approve dengan 800.000
- [ ] Login as Admin → klik Setujui → coba input 900.000 (raise above)
- [ ] Expected: button "Setujui" disabled atau klik return 400 error "Nominal disetujui tidak boleh melebihi nominal step sebelumnya"

## Skenario CA-4: Approval Reject di Tengah Chain

- [ ] Setup: Cash Advance, step PM approved
- [ ] Login as Admin → klik "Tolak"
- [ ] Modal alasan, input "Anggaran tidak cukup"
- [ ] Expected: status REJECTED, finalApprovedAmount tetap null, no DEDUCT_JASA entry

## Skenario CA-5: Realisasi Window H+1 — Sebelum Open

- [ ] Setup: Cash Advance APPROVED, periodeTo = besok (date dynamic)
- [ ] Login as creator (Surveyor)
- [ ] Open detail
- [ ] Expected: banner "✓ Disetujui", text "Tombol Lapor Realisasi tersedia mulai {tanggal H+1} 00:00 WIB"
- [ ] Tombol "Lapor Realisasi" disabled atau hidden
- [ ] Try direct call POST /cash-operation/:id/realisasi/draft → expected 400 "Realisasi baru dapat dilaporkan setelah..."

## Skenario CA-6: Realisasi Window H+1 — Sudah Open (Periode Lewat)

- [ ] Setup: Cash Advance APPROVED, periodeTo = kemarin atau lebih lama
- [ ] Login as creator
- [ ] Expected: tombol "Lapor Realisasi" enabled
- [ ] Klik tombol → form muncul

## Skenario CA-7: Realisasi Form Submit Happy Path

- [ ] Setup: Cash Advance APPROVED, finalApprovedAmount = 700.000, window open
- [ ] Login as creator
- [ ] Buka form realisasi
- [ ] Add 3 items: deskripsi + tanggal + amount + foto
- [ ] Total: 600.000 (di bawah finalApproved)
- [ ] Klik "Simpan Draft"
- [ ] DB verify: SELECT "realisasiStatus", "realisasiTotal" FROM "CashOperationRequest"; → DRAFT, 600000
- [ ] Klik "Ajukan Realisasi"
- [ ] Expected: status REALISASI_IN_PROGRESS, realisasiStatus PENDING_FINANCE_REVIEW
- [ ] Notif Finance terkirim (cek 2nd browser sebagai Finance)

## Skenario CA-8: Realisasi Total > finalApprovedAmount (Warning)

- [ ] Setup: Cash Advance APPROVED, finalApproved 700.000
- [ ] Add items total = 800.000 (lebih dari approved)
- [ ] Expected: warning banner "Total realisasi melebihi nominal disetujui. Selisih akan menjadi beban pribadi..."
- [ ] Submit tetap allowed (per OQ2 lock)

## Skenario CA-9: Finance Approve Realisasi

- [ ] Login as Finance
- [ ] Buka detail Cash Advance dengan realisasiStatus PENDING_FINANCE_REVIEW
- [ ] Klik "Setujui Realisasi"
- [ ] Expected: realisasiStatus PENDING_GM_REVIEW, notif GM
- [ ] Cek timeline: Finance step approved

## Skenario CA-10: GM Approve Realisasi (Partial Refund)

- [ ] Setup: realisasiStatus PENDING_GM_REVIEW, finalApproved 700.000, realisasiTotal 600.000
- [ ] Login as GM
- [ ] Klik "Setujui Realisasi"
- [ ] Expected: status DONE, realisasiCompletedAt terisi
- [ ] Notif ke creator: "Realisasi selesai. Selisih Rp 100.000 dikembalikan ke budget."
- [ ] DB verify: SELECT * FROM "BudgetLedger" WHERE "sourceId" = '<cashOpId>' AND "entryType" = 'REFUND_JASA';
- [ ] Expected: 1 row, amount = 100000, metadata.partialRefundType = 'REALISASI_VARIANCE'
- [ ] Verify FinanceProject.jasaSpent decremented oleh 100.000

## Skenario CA-11: GM Reject Realisasi

- [ ] Setup: realisasiStatus PENDING_GM_REVIEW
- [ ] Login as GM → klik Tolak → input alasan "Bukti tidak lengkap"
- [ ] Expected: realisasiStatus REJECTED, realisasiRejectionReason terisi
- [ ] Notif ke creator
- [ ] Login as creator → buka detail → form realisasi reappear (editable, allow revisi)
- [ ] H+1 bypass: meski periode sudah lewat lama, tetap bisa edit (sesuai design)

## Skenario CA-12: Resubmit dari REJECTED

- [ ] Setup: realisasiStatus REJECTED
- [ ] Edit items, save draft → submit ulang
- [ ] Expected: realisasiStatus PENDING_FINANCE_REVIEW (back to start, sesuai design)

## Skenario REIM-1: Reimbursement Variance Refund

- [ ] Login as Surveyor → buat Reimbursement: amount Rp 500.000, lineItems + foto wajib
- [ ] Submit, full chain approval
- [ ] Setup: PM approve dengan amount 400.000 (variance 100.000)
- [ ] Sampai chain selesai (Finance) approve dengan 400.000
- [ ] Expected: status APPROVED, finalApprovedAmount = 400.000
- [ ] DB verify: BudgetLedger entries:
  - 1x DEDUCT_JASA amount 500.000 (full request)
  - 1x REFUND_JASA amount 100.000, metadata.partialRefundType = 'REIMBURSEMENT_VARIANCE'
- [ ] Net jasaSpent = +500.000 - 100.000 = +400.000

## Skenario REIM-2: Disburse Endpoint Block

- [ ] Setup: Reimbursement APPROVED (post-Phase 2, finalApprovedAmount filled)
- [ ] Try POST /cash-operation/:id/disburse
- [ ] Expected: 400 "Reimbursement otomatis disetujui setelah approval, tidak perlu pencairan terpisah"

## Skenario LEGACY-1: Existing Disbursed Record

- [ ] Setup: Cash Advance/Reimbursement old data, status DISBURSED, finalApprovedAmount NULL (legacy)
- [ ] Login as Finance
- [ ] Try disburse → expected: pre-existing behavior (legacy record dengan finalApprovedAmount NULL bisa di-disburse, atau already DISBURSED)
- [ ] Detail page render legacy view (lineItems lama tampil read-only)

## Skenario EDGE-1: finalApprovedAmount = 0 Block

- [ ] Try approve dengan amount 0
- [ ] Expected: 400 "Nominal disetujui harus lebih dari 0"

## Skenario EDGE-2: Race Condition 2 Approver

- [ ] Setup: 2 PM users yang sama-sama valid approver di chain (kalau ada di chain logic)
- [ ] Both klik approve dalam window <1s
- [ ] Expected: 1 sukses, 1 gagal dengan 400/409
