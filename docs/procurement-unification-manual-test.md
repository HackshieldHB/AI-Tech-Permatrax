# Procurement Unification (Phase 3) Manual Test Checklist

## Pre-condition

- DB seeded: PURCHASING user, ADMIN_STOCK user, GM, Finance, PM
- Apps running: API + Web
- INVENTORY project seeded (restock auto-project)
- Browser/Postman ready, multi-tab untuk multi-role test

## Skenario PROC-1: Order PROJECT_REQUEST Happy Path

- [ ] Login PM → buat Order PROJECT_REQUEST dengan items
- [ ] Submit → status PENDING_ADMIN_STOCK
- [ ] Login Admin Stock → validate items submit → status PENDING_PURCHASING_INPUT
- [ ] Login Purchasing → buka inbox → submit price (pilih supplier, isi unitPrice)
- [ ] Status → PENDING_OPS_APPROVAL, total_amount calculated
- [ ] Login Ops Manager → approve → status PENDING_GM_APPROVAL
- [ ] Login GM → approve → DEDUCT BUDGET happens, status PENDING_PAYMENT_RECEIPT
- [ ] Verify ledger: BudgetLedger entry DEDUCT_MATERIAL dengan amount = total
- [ ] Verify FinanceProject.materialSpent decremented oleh totalAmount
- [ ] Verify PO PDF generated automatically: poNumber, poFileUrl set
- [ ] Login Purchasing → Send PO Email → verify supplier email received
- [ ] Login Finance → Upload Tagihan + payment method (TERMIN dengan due date)
- [ ] Status SupplierInvoice: DRAFT → Send to supplier → SENT_TO_SUPPLIER
- [ ] Login Finance → Mark Supplier ACK → APPROVED_BY_SUPPLIER
- [ ] Login Finance → financeProcess (upload receipt URL) → status PURCHASED (no additional deduct)
- [ ] Login Admin Stock → verify items received → status FULFILLED

## Skenario PROC-2: Order STOCK_RESTOCK

- [ ] Login Admin Stock → buat Order restock (`/orders/restock` atau entry UI setara)
- [ ] Verify: status langsung PENDING_PURCHASING_INPUT (skip Admin Stock submit)
- [ ] Verify: financeProjectId auto-assigned ke INVENTORY project
- [ ] Test override: createRestock dengan financeProjectId other → pakai project itu (Q6 lock)
- [ ] Login Purchasing → submit price
- [ ] Verify: status PENDING_GM_APPROVAL (skip Ops, Q4 lock)
- [ ] Login GM → approve → DEDUCT happens
- [ ] Continue Finance receipt flow

## Skenario PROC-3: Cancel Pre-Deduct

- [ ] Order di status DRAFT, PENDING_ADMIN_STOCK, PENDING_PURCHASING_INPUT, PENDING_OPS_APPROVAL, PENDING_GM_APPROVAL
- [ ] Cancel → status CANCELLED, NO refund (deduct never happened)

## Skenario PROC-4: Cancel Post-Deduct

- [ ] Order di status PENDING_PAYMENT_RECEIPT (post-GM approve, deduct happened)
- [ ] Cancel → status CANCELLED, refundForOrder dipanggil
- [ ] Verify ledger: REFUND_MATERIAL entry, materialSpent restored

## Skenario PROC-5: Cancel Post-PURCHASED — BLOCKED

- [ ] Order status PURCHASED
- [ ] Try cancel → 400 (Q4 lock: PURCHASED final)

## Skenario PROC-6: Reject by Ops/GM Pre-Deduct

- [ ] Order di status PENDING_OPS_APPROVAL → reject by Ops → REJECTED_BY_OPS, no refund
- [ ] Order di status PENDING_GM_APPROVAL → reject by GM → REJECTED_BY_GM, no refund (deduct happens in commit, reject = abort)

## Skenario PROC-7: Purchasing Submit Price Edge Cases

- [ ] Purchasing input price untuk Order yang sudah past PENDING_PURCHASING_INPUT → 400
- [ ] Submit price tanpa supplier → 400
- [ ] Submit price dengan supplier inactive → 400
- [ ] Submit price dengan duplicate orderItemId → 400 (validation strict)
- [ ] Submit price dengan items count != order.items count → 400 (must be 1:1)

## Skenario PROC-8: Supplier Master CRUD

- [ ] Create supplier baru → SUP-YYYY-NNN code generated
- [ ] Update supplier
- [ ] Deactivate supplier → isActive: false
- [ ] Try pick deactivated supplier saat submit price → 400
- [ ] Reactivate supplier → bisa dipilih lagi

## Skenario PROC-9: Supplier Invoice Flow

- [ ] Upload Tagihan untuk Order PENDING_PAYMENT_RECEIPT → DRAFT
- [ ] Try upload kedua untuk Order yang sama → 400 (1:1 constraint)
- [ ] Upload TERMIN tanpa paymentDueDate → 400
- [ ] Send to supplier → email sent, status SENT_TO_SUPPLIER
- [ ] Mark Supplier Reject dengan reason → REJECTED_BY_SUPPLIER
- [ ] Edit invoice → status reset DRAFT (Q3 lock)
- [ ] Send ulang → SENT_TO_SUPPLIER
- [ ] Mark Supplier ACK → APPROVED_BY_SUPPLIER

## Skenario PROC-10: PO Generation & Email

- [ ] gmApprove sukses → poNumber + poFileUrl auto-set
- [ ] Download PO PDF → file valid, content correct (supplier info, items, total)
- [ ] PO email send dengan supplier email valid → email received with PDF attachment
- [ ] PO email send dengan supplier email null → 400 dengan pesan jelas
- [ ] Resend PO email → success (no idempotency check)

## Skenario PROC-11: StockOut Flow

- [ ] Login PM → buat StockOut request, pilih StockItem dari autocomplete (halaman baru)
- [ ] Status PENDING, notif Admin Stock (bell + sidebar badge + socket toast)
- [ ] Login Admin Stock → fulfill → stock decremented, StockLog OUT_ORDER created, notif requester
- [ ] Try fulfill StockOut yang sudah FULFILLED → 400
- [ ] Stock insufficient saat fulfill → 400 dengan info qty
- [ ] Reject dengan reason → REJECTED, notif requester (socket user room)
- [ ] Login Admin Stock → buat StockOut request sendiri (Q12) → no audit safeguard, sukses

## Skenario PROC-12: StockRequest Pensiun Verification

- [ ] Try call /stock-request (or POST) → 404 (module dropped)
- [ ] Frontend dashboard link → tidak mengarah ke modul pensiunan; Order Barang menggantikan alur pembelian
- [ ] No regression untuk Visit Request, Cash Op, Phase 1 Finance Dashboard

## Realtime UI (socket)

- [ ] Purchasing: toast `order:pendingPurchasing` + refresh badge inbox
- [ ] Ops / GM / Finance / Admin Stok: toast sesuai event Phase 3 (lihat layout dashboard)
- [ ] Supplier invoice: Purchasing & Finance mendapat toast ACK / reject sesuai room

## Edge Cases

- [ ] Concurrent gmApprove paralel (race) → 1 success, 1 retry
- [ ] PO generation fail saat gmApprove → Order tetap disetujui (cek log — PO regenerate manual tertunda)
- [ ] Storage download fail saat send email → email sent tanpa lampiran (cek log warning)
