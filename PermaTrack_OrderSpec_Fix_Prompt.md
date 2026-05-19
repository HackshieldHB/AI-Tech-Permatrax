# PermaTrack — Order Spec Mock Drift Fix (Category B)
> Paste seluruh isi file ini ke Cursor Chat (Agent mode).
> **Scope**: satu file saja — `apps/api/src/order/order.service.spec.ts`
> **Tujuan**: Fix 14 test failures yang disebabkan mock drift (production code berubah, spec belum di-update).
> **Aturan**: Jangan ubah production code. Hanya ubah file spec.

---

## CONTEXT

Full API test run shows **14 failures**, semuanya di `apps/api/src/order/order.service.spec.ts`.
Semua disebabkan 3 root cause mock drift — production service sudah di-refactor, spec-nya belum ikut:

| # | Root Cause | Failing Tests |
|---|-----------|---------------|
| A | `stockService.deductStock` tidak ada di mock — service sekarang memanggil `deductStock`, spec masih mock `deductInsideTransaction` | 8 tests |
| B | `prisma.$executeRaw` dan `prisma.order.findFirst` tidak ada di mock — `nextOrderNumber()` membutuhkan keduanya via `$transaction` callback | 2 tests |
| C | `prisma.order.findUniqueOrThrow` tidak di-setup return value — `findOrderRaw()` pakai `findUniqueOrThrow`, test-test ini hanya mock `findUnique` | 4 tests |

---

## ROOT CAUSE A — `deductStock` vs `deductInsideTransaction`

**Service fact** (jangan ubah):
```
// apps/api/src/order/order.service.ts, line 1118
await this.stockService.deductStock(item.stockItemId, item.availableQty, userId, order.id);
```

**Problem di spec**: mock `stockService` punya `deductInsideTransaction` tapi tidak punya `deductStock`.

### Fix A-1 — Ubah mock object `stockService` (sekitar baris 38–48)

**BEFORE:**
```typescript
const stockService = {
  checkAvailability: jest.fn(),
  deductInsideTransaction: jest.fn().mockResolvedValue({
    itemId: 's1',
    itemName: 'Item',
    newQty: 8,
    minStockQty: 0,
    unit: 'pcs',
  }),
  emitLowStockIfNeeded: jest.fn(),
};
```

**AFTER:**
```typescript
const stockService = {
  checkAvailability: jest.fn(),
  deductStock: jest.fn().mockResolvedValue({
    itemId: 's1',
    itemName: 'Item',
    newQty: 8,
    minStockQty: 0,
    unit: 'pcs',
  }),
  emitLowStockIfNeeded: jest.fn(),
};
```

### Fix A-2 — Update semua assertion yang pakai `deductInsideTransaction` → `deductStock`

Ada **6 lokasi** di file yang perlu diganti (gunakan global find-replace untuk `deductInsideTransaction` → `deductStock`):

1. **Baris ~120** (submit Case A, test 1):
   ```typescript
   // BEFORE
   expect(stockService.deductInsideTransaction).toHaveBeenCalled();
   // AFTER
   expect(stockService.deductStock).toHaveBeenCalled();
   ```

2. **Baris ~171** (submit Case B):
   ```typescript
   // BEFORE
   expect(stockService.deductInsideTransaction).not.toHaveBeenCalled();
   // AFTER
   expect(stockService.deductStock).not.toHaveBeenCalled();
   ```

3. **Baris ~201** (submit Case D, test 1):
   ```typescript
   // BEFORE
   expect(stockService.deductInsideTransaction).not.toHaveBeenCalled();
   // AFTER
   expect(stockService.deductStock).not.toHaveBeenCalled();
   ```

4. **Baris ~272** (deductAvailableItems atomicity, fail-fast test):
   ```typescript
   // BEFORE
   expect(stockService.deductInsideTransaction).not.toHaveBeenCalled();
   // AFTER
   expect(stockService.deductStock).not.toHaveBeenCalled();
   ```

5. **Baris ~300–315** (deductAvailableItems atomicity, happy-path multi-item):
   ```typescript
   // BEFORE
   stockService.deductInsideTransaction
     .mockResolvedValueOnce({ itemId: 's1', itemName: 'A', newQty: 9, minStockQty: 0, unit: 'pcs' })
     .mockResolvedValueOnce({ itemId: 's2', itemName: 'B', newQty: 8, minStockQty: 0, unit: 'pcs' });
   // AFTER
   stockService.deductStock
     .mockResolvedValueOnce({ itemId: 's1', itemName: 'A', newQty: 9, minStockQty: 0, unit: 'pcs' })
     .mockResolvedValueOnce({ itemId: 's2', itemName: 'B', newQty: 8, minStockQty: 0, unit: 'pcs' });
   ```

6. **Baris ~316** (deductAvailableItems atomicity, happy-path multi-item):
   ```typescript
   // BEFORE
   expect(stockService.deductInsideTransaction).toHaveBeenCalledTimes(2);
   // AFTER
   expect(stockService.deductStock).toHaveBeenCalledTimes(2);
   ```

> **Tip**: Setelah fix A-1, lakukan global find-replace `stockService.deductInsideTransaction` → `stockService.deductStock` di seluruh file untuk menangkap semua 6 lokasi sekaligus.

---

## ROOT CAUSE B — `$executeRaw` dan `order.findFirst` missing dari prisma mock

**Service fact** — `nextOrderNumber()` (baris 47–71 di service) dipanggil oleh `createRestock`.
Ia memakai `this.prisma.$transaction(async (tx) => { ... })` dengan callback.
Mock `$transaction` saat ini meneruskan objek `prisma` itu sendiri sebagai `tx`.
Sehingga `tx.$executeRaw` = `prisma.$executeRaw` (tidak ada → TypeError)
dan `tx.order.findFirst` = `prisma.order.findFirst` (tidak ada → TypeError).

### Fix B-1 — Tambah `$executeRaw` ke prisma mock top-level (baris ~21)

**BEFORE:**
```typescript
const prisma = {
  order: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  financeProject: { findFirst: jest.fn() },
  stockItem: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  stockLog: { findFirst: jest.fn(), create: jest.fn() },
  orderItem: { updateMany: jest.fn() },
  $transaction: jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (t: unknown) => Promise<unknown>)(prisma);
  }),
};
```

**AFTER:**
```typescript
const prisma = {
  order: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  financeProject: { findFirst: jest.fn() },
  stockItem: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  stockLog: { findFirst: jest.fn(), create: jest.fn() },
  orderItem: { updateMany: jest.fn() },
  $executeRaw: jest.fn().mockResolvedValue(undefined),
  $transaction: jest.fn((arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (t: unknown) => Promise<unknown>)(prisma);
  }),
};
```

Perubahan:
- Tambah `findFirst: jest.fn().mockResolvedValue(null)` di dalam `prisma.order` → ini buat `tx.order.findFirst(...)` di `nextOrderNumber`
- Tambah `$executeRaw: jest.fn().mockResolvedValue(undefined)` di level prisma → ini buat `tx.$executeRaw` (advisory lock)

---

## ROOT CAUSE C — `findUniqueOrThrow` tidak di-setup di test adminStockSubmit & orderTrigger

**Service fact** — `adminStockSubmit` dan `opsApprove` keduanya memanggil `findOrderRaw(id)`:
```typescript
// apps/api/src/order/order.service.ts, line 1104–1109
private async findOrderRaw(id: string) {
  return this.prisma.order.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  });
}
```

`prisma.order.findUniqueOrThrow` didefinisikan sebagai `jest.fn()` di mock, tapi tidak di-setup return valuenya di test-test ini. Sehingga ia mengembalikan `undefined`, dan ketika service mengakses `order.orderTrigger` → TypeError.

Test-test yang pakai `findUnique.mockResolvedValue(...)` perlu **tambahkan juga** `findUniqueOrThrow.mockResolvedValue(...)` dengan objek yang sama (karena `findOrderRaw` pakai `findUniqueOrThrow`, bukan `findUnique`).

### Fix C-1 — `adminStockSubmit` test 1 (sekitar baris 580)

**BEFORE:**
```typescript
it('notifies Purchasing when moving to PENDING_PURCHASING_INPUT', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'o1',
    orderTrigger: 'PROJECT_REQUEST',
    status: 'PENDING_ADMIN_STOCK',
    orderNumber: 'ORD-N',
  });
  prisma.order.update.mockResolvedValue({
    id: 'o1',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-N',
  });
```

**AFTER:**
```typescript
it('notifies Purchasing when moving to PENDING_PURCHASING_INPUT', async () => {
  const orderMock = {
    id: 'o1',
    orderTrigger: 'PROJECT_REQUEST',
    status: 'PENDING_ADMIN_STOCK',
    orderNumber: 'ORD-N',
    items: [],
  };
  prisma.order.findUnique.mockResolvedValue(orderMock);
  prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock);
  prisma.order.update.mockResolvedValue({
    id: 'o1',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-N',
  });
```

### Fix C-2 — `adminStockSubmit` test 2 (sekitar baris 614)

**BEFORE:**
```typescript
it('ISSUE 1.1: ADMIN_STOCK submits without unitPrice — no error, status moves to PENDING_PURCHASING_INPUT', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'o1',
    orderTrigger: 'PROJECT_REQUEST',
    status: 'PENDING_ADMIN_STOCK',
    orderNumber: 'ORD-N',
  });
  prisma.order.update.mockResolvedValue({
    id: 'o1',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-N',
  });
```

**AFTER:**
```typescript
it('ISSUE 1.1: ADMIN_STOCK submits without unitPrice — no error, status moves to PENDING_PURCHASING_INPUT', async () => {
  const orderMock = {
    id: 'o1',
    orderTrigger: 'PROJECT_REQUEST',
    status: 'PENDING_ADMIN_STOCK',
    orderNumber: 'ORD-N',
    items: [],
  };
  prisma.order.findUnique.mockResolvedValue(orderMock);
  prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock);
  prisma.order.update.mockResolvedValue({
    id: 'o1',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-N',
  });
```

### Fix C-3 — `orderTrigger branching` test 1: adminStockSubmit ditolak untuk STOCK_RESTOCK (sekitar baris 648)

**BEFORE:**
```typescript
it('adminStockSubmit ditolak untuk STOCK_RESTOCK', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'x1',
    orderTrigger: 'STOCK_RESTOCK',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-X',
  } as never);
```

**AFTER:**
```typescript
it('adminStockSubmit ditolak untuk STOCK_RESTOCK', async () => {
  const orderMock = {
    id: 'x1',
    orderTrigger: 'STOCK_RESTOCK',
    status: 'PENDING_PURCHASING_INPUT',
    orderNumber: 'ORD-X',
    items: [],
  };
  prisma.order.findUnique.mockResolvedValue(orderMock as never);
  prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock as never);
```

### Fix C-4 — `orderTrigger branching` test 2: opsApprove ditolak untuk STOCK_RESTOCK (sekitar baris 668)

**BEFORE:**
```typescript
it('opsApprove ditolak untuk STOCK_RESTOCK', async () => {
  prisma.order.findUnique.mockResolvedValue({
    id: 'x2',
    orderTrigger: 'STOCK_RESTOCK',
    status: 'PENDING_OPS_APPROVAL',
    orderNumber: 'ORD-Y',
  } as never);
```

**AFTER:**
```typescript
it('opsApprove ditolak untuk STOCK_RESTOCK', async () => {
  const orderMock = {
    id: 'x2',
    orderTrigger: 'STOCK_RESTOCK',
    status: 'PENDING_OPS_APPROVAL',
    orderNumber: 'ORD-Y',
    items: [],
  };
  prisma.order.findUnique.mockResolvedValue(orderMock as never);
  prisma.order.findUniqueOrThrow.mockResolvedValue(orderMock as never);
```

---

## SUMMARY OF ALL CHANGES

| Fix | Location | Change |
|-----|----------|--------|
| A-1 | `stockService` mock object | Rename `deductInsideTransaction` → `deductStock` |
| A-2 | 6 inline assertions throughout the file | Replace `deductInsideTransaction` → `deductStock` |
| B-1 | `prisma.order` mock object | Add `findFirst: jest.fn().mockResolvedValue(null)` |
| B-2 | `prisma` mock object (top level) | Add `$executeRaw: jest.fn().mockResolvedValue(undefined)` |
| C-1 | `adminStockSubmit` test 1 | Add `findUniqueOrThrow.mockResolvedValue(orderMock)` + add `items: []` to mock |
| C-2 | `adminStockSubmit` test 2 | Same as C-1 |
| C-3 | `orderTrigger branching` test 1 | Add `findUniqueOrThrow.mockResolvedValue(orderMock as never)` |
| C-4 | `orderTrigger branching` test 2 | Same as C-3 |

**File to edit**: `apps/api/src/order/order.service.spec.ts` (no other files)

---

## VERIFICATION

After applying all fixes, run:

```bash
cd apps/api && NODE_OPTIONS=--max-old-space-size=8192 npx jest order/order.service.spec.ts --runInBand --no-coverage
```

**Expected result**: All tests in the suite pass (0 failures). The test count should stay the same — we are not adding or removing tests, only fixing mocks.

If any test still fails, check:
1. Is `deductInsideTransaction` still referenced anywhere? (`grep -n deductInsideTransaction src/order/order.service.spec.ts`)
2. Did `$executeRaw` get added at the top-level of the `prisma` object (not inside `order`)?
3. Did each `adminStockSubmit` / `opsApprove` test get BOTH `findUnique.mockResolvedValue` AND `findUniqueOrThrow.mockResolvedValue` with the same mock object?
