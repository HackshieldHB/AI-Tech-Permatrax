# Phase 3 — Production Readiness Status

## Completed

- Schema unification: Drop StockRequest, extend Order, new Supplier + SupplierInvoice + StockOut models
- Order workflow refactor: orderTrigger branching, deduct moved to gmApprove
- Purchasing layer: role + module + inbox + submitPrice
- Supplier master CRUD
- PO generation: PDF + email
- Tagihan / SupplierInvoice flow
- StockOut module
- refundForOrder wired (Phase 1 tech debt)
- Frontend: order detail stepper + PO section + Purchasing panel + Finance tagihan + socket toasts + stock-out autocomplete + filter orderTrigger di daftar order
- API tests: jalankan suite penuh sebelum GO (baseline M6 + perubahan M7 gateway/DTO)

## Outstanding (Pre-Prod Required)

- Manual smoke test Phase 3 (`docs/procurement-unification-manual-test.md`)
- Storage download support cloud (S3) — verify `FILE_BASE_URL` / storage adapter untuk lampiran PO & tagihan
- PO regenerate endpoint (jika auto-gen gagal pada gmApprove — terdokumentasi sebagai backlog)
- Audit safeguard StockOut (Q12 deferred — request ≠ fulfill validation)

## Recommended Future Hardening

- Email retry queue (Bull/Redis) untuk reliability
- Supplier ACK self-service link (token-based)
- SLA tracking (PO ack response time)
- Master Supplier import bulk (Excel)
- Tagihan version history (jika pola reset DRAFT tidak lagi cukup)

## Recommendation

Production readiness: GO with mandatory manual smoke test (Phase 3 checklist) sebelum deploy produksi.

## Roadmap Ringkas

- Phase 1 Finance Dashboard — selesai
- Phase 2 Cash Advance refactor — selesai
- Phase 3 Procurement unification — selesai (kode); smoke test wajib
- Phase 4 Marketing Document Tracking — berikutnya (opsional product)
