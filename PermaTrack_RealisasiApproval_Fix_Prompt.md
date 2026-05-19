# PermaTrack — Realisasi Approval "Invalid state transition" Fix
> Paste seluruh isi file ini ke Cursor Chat (Agent mode).
> **Scope**: 2 file — `apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts` dan `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`
> **Tujuan**: Fix error "Invalid state transition" yang muncul saat approver klik Approve/Reject di alur realisasi.
> **Aturan**: Jangan ubah production logic, schema, atau routing. Hanya ubah pola transaction dan error handling.

---

## ROOT CAUSE

Ada 2 root cause yang saling memperparah:

### Root Cause 1 — Backend: Notification call non-transactional bisa membuat DB "half-updated"

Method-method seperti `approveByOps`, `approveByGm`, `rejectByOps`, dll. melakukan:
1. `await prisma.cashOperationRequest.update(...)` → **sukses, DB status berubah**
2. `await this.notifications.createForRole(...)` → **gagal/throw → API return 500**

Hasilnya: DB sudah di-update ke status baru, tapi frontend menerima error 500. User klik lagi → status di DB sudah bukan yang diharapkan → **"Invalid state transition"**.

Fix: Jadikan semua notification call **fire-and-forget** (hapus `await`, tambah `.catch(() => {})`). Notification gagal = tidak apa-apa, yang penting DB-nya benar.

Untuk method yang punya **multiple DB writes** (step update + cashOp update), wrap dalam `this.prisma.$transaction()` agar atomik.

### Root Cause 2 — Frontend: UI tidak refresh saat ada error

Handler Pattern A (approve) punya `return` di dalam catch, yang mencegah `refreshAfterApproval` berjalan:
```typescript
} catch (e) {
  toast.error(...);
  return; // ← BUG: refreshAfterApproval di bawah tidak pernah dipanggil
}
await refreshAfterApproval(...); // tidak tercapai saat error
```

Handler Pattern B (reject) menaruh `loadDetail`/`loadBundle` di dalam try, sehingga tidak berjalan saat error:
```typescript
try {
  await apiPost(...);
  await loadDetail();  // ← hanya jalan kalau tidak error
  await loadBundle();  // ← hanya jalan kalau tidak error
} catch (e) {
  toast.error(...);
  // tidak ada refresh di sini
}
```

Akibatnya: UI menampilkan status lama → user klik lagi → 400 "Invalid state transition" karena DB sudah berubah.

Fix: **Selalu panggil refresh setelah try/catch**, baik sukses maupun gagal.

---

## FILE 1: `apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts`

### Fix 1 — `approveByPm` (sekitar baris 82)

**BEFORE:**
```typescript
async approveByPm(cashOpId: string, actorId: string, notes?: string): Promise<void> {
  await this.assertActorRole(actorId, Role.PM_SENIOR);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
  if (cashOp.status !== 'REALISASI_PENDING_PM') {
    throw realisasiStateError('approveByPm', cashOp.status, ['REALISASI_PENDING_PM']);
  }
  await this.prisma.cashOperationRequest.update({
    where: { id: cashOpId },
    data: {
      status: 'REALISASI_PENDING_OPS',
      realisasiStatus: 'PENDING_OPS_REVIEW',
      realisasiCurrentStepRole: Role.OPERATIONAL_MANAGER,
      realisasiRejectedAt: null,
      realisasiRejectedById: null,
      realisasiRejectedReason: null,
    },
  });
  await this.notifications.createForRole(Role.OPERATIONAL_MANAGER, {
    title: 'Realisasi Cash Advance Menunggu Approval',
    message: `Realisasi CA ${cashOp.requestNumber} telah disetujui PM Senior dan menunggu review Ops Manager.${notes ? ` Catatan: ${notes}` : ''}`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOpId}`,
    entityId: cashOpId,
  });
}
```

**AFTER:**
```typescript
async approveByPm(cashOpId: string, actorId: string, notes?: string): Promise<void> {
  await this.assertActorRole(actorId, Role.PM_SENIOR);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
  if (cashOp.status !== 'REALISASI_PENDING_PM') {
    throw realisasiStateError('approveByPm', cashOp.status, ['REALISASI_PENDING_PM']);
  }
  await this.prisma.cashOperationRequest.update({
    where: { id: cashOpId },
    data: {
      status: 'REALISASI_PENDING_OPS',
      realisasiStatus: 'PENDING_OPS_REVIEW',
      realisasiCurrentStepRole: Role.OPERATIONAL_MANAGER,
      realisasiRejectedAt: null,
      realisasiRejectedById: null,
      realisasiRejectedReason: null,
    },
  });
  this.notifications.createForRole(Role.OPERATIONAL_MANAGER, {
    title: 'Realisasi Cash Advance Menunggu Approval',
    message: `Realisasi CA ${cashOp.requestNumber} telah disetujui PM Senior dan menunggu review Ops Manager.${notes ? ` Catatan: ${notes}` : ''}`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOpId}`,
    entityId: cashOpId,
  }).catch(() => {});
}
```

Perubahan: hapus `await` dari `this.notifications.createForRole(...)`, tambah `.catch(() => {})`.

---

### Fix 2 — `rejectByPm` (sekitar baris 108)

**BEFORE:**
```typescript
  await this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak PM Senior',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOpId}`,
    entityId: cashOpId,
  });
```

**AFTER:**
```typescript
  this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak PM Senior',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOpId}`,
    entityId: cashOpId,
  }).catch(() => {});
```

---

### Fix 3 — `approveByOps` (sekitar baris 136)

Method ini punya 2 DB writes (step update + cashOp update) — perlu transaction atomik + fire-and-forget notification.

**BEFORE:**
```typescript
async approveByOps(realisasiId: string, actorId: string, notes?: string): Promise<void> {
  await this.assertActorRole(actorId, Role.OPERATIONAL_MANAGER);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
  if (!OPS_PENDING_STATUSES.includes(cashOp.status)) {
    throw realisasiStateError('approveByOps', cashOp.status, OPS_PENDING_STATUSES);
  }
  const opsStep = await this.prisma.cashOpRealisasiStep.findFirst({
    where: { cashOpRequestId: realisasiId, approverRole: Role.OPERATIONAL_MANAGER, status: 'PENDING' },
  });
  if (opsStep) {
    await this.prisma.cashOpRealisasiStep.update({
      where: { id: opsStep.id },
      data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: notes ?? null },
    });
  }
  await this.prisma.cashOperationRequest.update({
    where: { id: realisasiId },
    data: {
      status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
      realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
      realisasiCurrentStepRole: Role.FINANCE,
      realisasiRejectedAt: null,
      realisasiRejectedById: null,
      realisasiRejectedReason: null,
    },
  });
  await this.notifications.createForRole(Role.FINANCE, {
    title: 'Realisasi Cash Advance Siap Diperiksa',
    message: `Realisasi CA ${cashOp.requestNumber} telah disetujui Ops Manager dan menunggu review Finance.${notes ? ` Catatan: ${notes}` : ''}`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  });
}
```

**AFTER:**
```typescript
async approveByOps(realisasiId: string, actorId: string, notes?: string): Promise<void> {
  await this.assertActorRole(actorId, Role.OPERATIONAL_MANAGER);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: realisasiId } });
  if (!OPS_PENDING_STATUSES.includes(cashOp.status)) {
    throw realisasiStateError('approveByOps', cashOp.status, OPS_PENDING_STATUSES);
  }
  await this.prisma.$transaction(async (tx) => {
    const opsStep = await tx.cashOpRealisasiStep.findFirst({
      where: { cashOpRequestId: realisasiId, approverRole: Role.OPERATIONAL_MANAGER, status: 'PENDING' },
    });
    if (opsStep) {
      await tx.cashOpRealisasiStep.update({
        where: { id: opsStep.id },
        data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: notes ?? null },
      });
    }
    await tx.cashOperationRequest.update({
      where: { id: realisasiId },
      data: {
        status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
        realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
        realisasiCurrentStepRole: Role.FINANCE,
        realisasiRejectedAt: null,
        realisasiRejectedById: null,
        realisasiRejectedReason: null,
      },
    });
  });
  this.notifications.createForRole(Role.FINANCE, {
    title: 'Realisasi Cash Advance Siap Diperiksa',
    message: `Realisasi CA ${cashOp.requestNumber} telah disetujui Ops Manager dan menunggu review Finance.${notes ? ` Catatan: ${notes}` : ''}`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  }).catch(() => {});
}
```

Perubahan: wrap DB calls dalam `$transaction`, hapus `await` dari notification, tambah `.catch(() => {})`.

---

### Fix 4 — `rejectByOps` (sekitar baris 171)

**BEFORE:**
```typescript
  await this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak Ops Manager',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  });
```

**AFTER:**
```typescript
  this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak Ops Manager',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  }).catch(() => {});
```

---

### Fix 5 — `approveByGm` (sekitar baris 199)

Method ini punya 4 DB calls (2 findFirst + 2 updates) — perlu transaction + fire-and-forget.

**BEFORE:**
```typescript
async approveByGm(
  cashOpId: string,
  actorId: string,
  dto: { gmSignatureUrl?: string; notes?: string },
): Promise<void> {
  await this.assertActorRole(actorId, Role.GENERAL_MANAGER);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
  if (cashOp.status !== ('REALISASI_PENDING_GM' as CashOpStatus)) {
    throw realisasiStateError('approveByGm', cashOp.status, ['REALISASI_PENDING_GM']);
  }

  // Mark GM step as approved
  const gmStep = await this.prisma.cashOpRealisasiStep.findFirst({
    where: { cashOpRequestId: cashOpId, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
  });
  if (gmStep) {
    await this.prisma.cashOpRealisasiStep.update({
      where: { id: gmStep.id },
      data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: dto.notes ?? null },
    });
  }

  // Check if there is a next step after GM
  const nextStep = await this.prisma.cashOpRealisasiStep.findFirst({
    where: { cashOpRequestId: cashOpId, status: 'PENDING' },
    orderBy: { stepOrder: 'asc' },
  });

  await this.prisma.cashOperationRequest.update({
    where: { id: cashOpId },
    data: {
      ...(dto.gmSignatureUrl?.trim() ? { gmSignatureUrl: dto.gmSignatureUrl.trim() } : {}),
      gmApprovedAt: new Date(),
      gmApprovedById: actorId,
      realisasiRejectedAt: null,
      realisasiRejectedById: null,
      realisasiRejectedReason: null,
      ...(nextStep
        ? {
            status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
            realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
            realisasiCurrentStepRole: nextStep.approverRole as Role,
          }
        : {
            status: 'REALISASI_DONE' as CashOpStatus,
            realisasiStatus: 'DONE' as RealisasiStatus,
            realisasiCurrentStepRole: null,
            realisasiCompletedAt: new Date(),
          }),
    },
  });

  if (nextStep) {
    await this.notifications.createForRole(nextStep.approverRole as Role, {
      title: 'Realisasi Cash Advance Siap Diperiksa',
      message: `Realisasi CA ${cashOp.requestNumber} telah disetujui GM dan menunggu review Anda.${dto.notes ? ` Catatan: ${dto.notes}` : ''}`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    });
  } else {
    await this.notifications.createForUser(cashOp.requestedBy, {
      title: 'Realisasi Selesai Disetujui',
      message: `Realisasi ${cashOp.requestNumber} telah disetujui semua pihak.`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    });
  }
}
```

**AFTER:**
```typescript
async approveByGm(
  cashOpId: string,
  actorId: string,
  dto: { gmSignatureUrl?: string; notes?: string },
): Promise<void> {
  await this.assertActorRole(actorId, Role.GENERAL_MANAGER);
  const cashOp = await this.prisma.cashOperationRequest.findUniqueOrThrow({ where: { id: cashOpId } });
  if (cashOp.status !== ('REALISASI_PENDING_GM' as CashOpStatus)) {
    throw realisasiStateError('approveByGm', cashOp.status, ['REALISASI_PENDING_GM']);
  }

  let nextStep: { approverRole: string } | null = null;

  await this.prisma.$transaction(async (tx) => {
    // Mark GM step as approved
    const gmStep = await tx.cashOpRealisasiStep.findFirst({
      where: { cashOpRequestId: cashOpId, approverRole: Role.GENERAL_MANAGER, status: 'PENDING' },
    });
    if (gmStep) {
      await tx.cashOpRealisasiStep.update({
        where: { id: gmStep.id },
        data: { status: 'APPROVED', approverId: actorId, approvedAt: new Date(), notes: dto.notes ?? null },
      });
    }

    // Check if there is a next step after GM
    nextStep = await tx.cashOpRealisasiStep.findFirst({
      where: { cashOpRequestId: cashOpId, status: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });

    await tx.cashOperationRequest.update({
      where: { id: cashOpId },
      data: {
        ...(dto.gmSignatureUrl?.trim() ? { gmSignatureUrl: dto.gmSignatureUrl.trim() } : {}),
        gmApprovedAt: new Date(),
        gmApprovedById: actorId,
        realisasiRejectedAt: null,
        realisasiRejectedById: null,
        realisasiRejectedReason: null,
        ...(nextStep
          ? {
              status: 'REALISASI_PENDING_FINANCE' as CashOpStatus,
              realisasiStatus: 'PENDING_FINANCE_REVIEW' as RealisasiStatus,
              realisasiCurrentStepRole: nextStep.approverRole as Role,
            }
          : {
              status: 'REALISASI_DONE' as CashOpStatus,
              realisasiStatus: 'DONE' as RealisasiStatus,
              realisasiCurrentStepRole: null,
              realisasiCompletedAt: new Date(),
            }),
      },
    });
  });

  if (nextStep) {
    this.notifications.createForRole(nextStep.approverRole as Role, {
      title: 'Realisasi Cash Advance Siap Diperiksa',
      message: `Realisasi CA ${cashOp.requestNumber} telah disetujui GM dan menunggu review Anda.${dto.notes ? ` Catatan: ${dto.notes}` : ''}`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    }).catch(() => {});
  } else {
    this.notifications.createForUser(cashOp.requestedBy, {
      title: 'Realisasi Selesai Disetujui',
      message: `Realisasi ${cashOp.requestNumber} telah disetujui semua pihak.`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOpId}`,
      entityId: cashOpId,
    }).catch(() => {});
  }
}
```

Perubahan: deklarasi `nextStep` di luar transaction, wrap semua DB calls dalam `$transaction`, hapus `await` dari keduanya notification calls, tambah `.catch(() => {})`.

---

### Fix 6 — `rejectByFinance` (sekitar baris 374)

**BEFORE:**
```typescript
  await this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak Finance',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  });
```

**AFTER:**
```typescript
  this.notifications.createForUser(cashOp.requestedBy, {
    title: 'Realisasi Ditolak Finance',
    message: `Realisasi Anda ditolak: ${reason.trim()}. Silakan revisi dan ajukan ulang.`,
    type: 'CASH_OP',
    link: `/cash-operation/${cashOp.id}`,
    entityId: cashOp.id,
  }).catch(() => {});
```

---

### Fix 7 — `editAndApproveByFinance` (sekitar baris 355, setelah closing `}`  dari `$transaction`)

**BEFORE:**
```typescript
    });
    if (nextStep) {
      await this.notifications.createForRole(nextStep.approverRole as Role, {
        title: 'Realisasi Cash Advance Siap Diperiksa',
        message: `Realisasi CA ${cashOp.requestNumber} telah disetujui Finance dan menunggu review Anda.`,
        type: 'CASH_OP',
        link: `/cash-operation/${realisasiId}`,
        entityId: realisasiId,
      });
    } else {
      await this.notifications.createForUser(cashOp.requestedBy, {
        title: 'Realisasi Selesai',
        message: 'Realisasi Anda telah selesai disetujui semua pihak.',
        type: 'CASH_OP',
        link: `/cash-operation/${cashOp.id}`,
        entityId: cashOp.id,
      });
    }
```

**AFTER:**
```typescript
    });
    if (nextStep) {
      this.notifications.createForRole(nextStep.approverRole as Role, {
        title: 'Realisasi Cash Advance Siap Diperiksa',
        message: `Realisasi CA ${cashOp.requestNumber} telah disetujui Finance dan menunggu review Anda.`,
        type: 'CASH_OP',
        link: `/cash-operation/${realisasiId}`,
        entityId: realisasiId,
      }).catch(() => {});
    } else {
      this.notifications.createForUser(cashOp.requestedBy, {
        title: 'Realisasi Selesai',
        message: 'Realisasi Anda telah selesai disetujui semua pihak.',
        type: 'CASH_OP',
        link: `/cash-operation/${cashOp.id}`,
        entityId: cashOp.id,
      }).catch(() => {});
    }
```

---

### Fix 8 — `resubmitRealisasi` (sekitar baris 476, setelah `$transaction` selesai)

**BEFORE:**
```typescript
    await this.notifications.createForRole(firstRole as Role, {
      title: 'Realisasi Cash Advance Diajukan Ulang',
      message: `Realisasi ${cashOp.requestNumber} menunggu review Anda.`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOp.id}`,
      entityId: cashOp.id,
    });
```

**AFTER:**
```typescript
    this.notifications.createForRole(firstRole as Role, {
      title: 'Realisasi Cash Advance Diajukan Ulang',
      message: `Realisasi ${cashOp.requestNumber} menunggu review Anda.`,
      type: 'CASH_OP',
      link: `/cash-operation/${cashOp.id}`,
      entityId: cashOp.id,
    }).catch(() => {});
```

---

### Fix 9 — `submit` (sekitar baris 610, setelah `runSerializableTransaction` selesai)

**BEFORE:**
```typescript
    const firstRole = updated.realisasiCurrentStepRole as Role;
    await this.notifications.createForRole(firstRole, {
      title: 'Realisasi Cash Advance',
      message: `Realisasi ${updated.requestNumber} dari ${requesterName} menunggu review Anda`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    });
```

**AFTER:**
```typescript
    const firstRole = updated.realisasiCurrentStepRole as Role;
    this.notifications.createForRole(firstRole, {
      title: 'Realisasi Cash Advance',
      message: `Realisasi ${updated.requestNumber} dari ${requesterName} menunggu review Anda`,
      type: 'CASH_OP_REALISASI_PENDING',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
```

---

### Fix 10 — `approve` (sekitar baris 751, setelah `runSerializableTransaction` selesai)

**BEFORE:**
```typescript
    if (updated.status === 'REALISASI_DONE') {
      ...
      await this.notifications.createForUser(updated.requestedBy, {
        ...
      });
      this.notifications.emitRealtime(...);
    } else {
      const nextRole = updated.realisasiCurrentStepRole as Role;
      await this.notifications.notifyUsersByRole(nextRole, {
        ...
      });
    }
```

**AFTER:**
```typescript
    if (updated.status === 'REALISASI_DONE') {
      ...
      this.notifications.createForUser(updated.requestedBy, {
        ...
      }).catch(() => {});
      this.notifications.emitRealtime(...);
    } else {
      const nextRole = updated.realisasiCurrentStepRole as Role;
      this.notifications.notifyUsersByRole(nextRole, {
        ...
      }).catch(() => {});
    }
```

Hanya hapus `await` dari `createForUser` dan `notifyUsersByRole`, tambah `.catch(() => {})`. `emitRealtime` sudah synchronous, tidak perlu diubah.

---

### Fix 11 — `reject` (sekitar baris 844, setelah `runSerializableTransaction` selesai)

**BEFORE:**
```typescript
    await this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Perlu Revisi',
      message: `Realisasi ${updated.requestNumber} ditolak ${roleLabel}: ${reason}`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    });
```

**AFTER:**
```typescript
    this.notifications.createForUser(updated.requestedBy, {
      title: 'Realisasi Perlu Revisi',
      message: `Realisasi ${updated.requestNumber} ditolak ${roleLabel}: ${reason}`,
      type: 'CASH_OP_REALISASI_REJECTED',
      link: `/cash-operation/${updated.id}`,
      entityId: updated.id,
    }).catch(() => {});
```

---

## FILE 2: `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`

### Pola fix untuk semua handler

**Pattern A — approve handlers** (punya `return` di catch yang memblokir refresh):
Hapus baris `return;` dari dalam catch block. `refreshAfterApproval` sudah di luar try/catch, jadi akan selalu berjalan.

**Pattern B — reject handlers** (refresh di dalam try, tidak berjalan saat error):
Pindahkan `await loadDetail()` + `await loadBundle()` ke luar try/catch. Ganti dengan panggilan `await refreshAfterApproval(() => loadDetail(), loadBundle)` setelah try/catch.

---

### Fix 12 — `handleOpsApprove` (sekitar baris 292) — Pattern A

**BEFORE:**
```typescript
  const handleOpsApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-ops`, { notes: opsNotes.trim() || undefined });
        toast.success('Realisasi disetujui Ops Manager');
        setOpsNotes('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        return;
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };
```

**AFTER:**
```typescript
  const handleOpsApprove = async () => {
    if (!id) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/approve-ops`, { notes: opsNotes.trim() || undefined });
        toast.success('Realisasi disetujui Ops Manager');
        setOpsNotes('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };
```

Perubahan: hapus baris `return;` dari dalam catch.

---

### Fix 13 — `handleOpsReject` (sekitar baris 307) — Pattern B

**BEFORE:**
```typescript
  const handleOpsReject = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-ops`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Ops Manager');
        setOpsRejectOpen(false);
        setRealisasiRejectReason('');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
    });
  };
```

**AFTER:**
```typescript
  const handleOpsReject = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-ops`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Ops Manager');
        setOpsRejectOpen(false);
        setRealisasiRejectReason('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };
```

Perubahan: pindahkan refresh keluar dari try, ganti `await loadDetail() + await loadBundle()` dengan `refreshAfterApproval`.

---

### Fix 14 — `handleMarketingHeadApprove` (sekitar baris 326) — Pattern A

**BEFORE:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        return;
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

**AFTER:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

---

### Fix 15 — `handleMarketingHeadReject` (sekitar baris 343) — Pattern B

**BEFORE:**
```typescript
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject`, {
          reason: realisasiRejectReason.trim(),
        });
        toast.success('Realisasi ditolak Marketing Head');
        setMarketingHeadRejectOpen(false);
        setRealisasiRejectReason('');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
    });
```

**AFTER:**
```typescript
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject`, {
          reason: realisasiRejectReason.trim(),
        });
        toast.success('Realisasi ditolak Marketing Head');
        setMarketingHeadRejectOpen(false);
        setRealisasiRejectReason('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
```

---

### Fix 16 — `handleFinanceApprove` (sekitar baris 364) — Pattern A

**BEFORE:**
```typescript
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Gagal memproses approval');
        return;
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

**AFTER:**
```typescript
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

---

### Fix 17 — `handleFinanceReject` (sekitar baris 385) — Pattern B

**BEFORE:**
```typescript
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Finance');
        setFinanceRejectOpen(false);
        setRealisasiRejectReason('');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
    });
```

**AFTER:**
```typescript
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Finance');
        setFinanceRejectOpen(false);
        setRealisasiRejectReason('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
```

---

### Fix 18 — `handlePmApprove` (sekitar baris 404) — Pattern A

**BEFORE:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        return;
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

**AFTER:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

---

### Fix 19 — `handlePmReject` (sekitar baris 419) — Pattern B

**BEFORE:**
```typescript
  const handlePmReject = async (reason: string) => {
    if (!id || !reason.trim()) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-pm`, { reason: reason.trim() });
        toast.success('Realisasi ditolak PM');
        setShowPmRejectModal(false);
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
    });
  };
```

**AFTER:**
```typescript
  const handlePmReject = async (reason: string) => {
    if (!id || !reason.trim()) return;
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-pm`, { reason: reason.trim() });
        toast.success('Realisasi ditolak PM');
        setShowPmRejectModal(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };
```

---

### Fix 20 — `handleGmApprove` (sekitar baris 434) — Pattern A

**BEFORE:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
        return;
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

**AFTER:**
```typescript
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
```

---

### Fix 21 — Inline GM reject onClick (sekitar baris 1262) — Pattern A

Ini adalah handler inline di dalam JSX untuk tombol "Konfirmasi Tolak" di `gmRejectOpen` modal.

**BEFORE:**
```typescript
                onClick={async () => {
                    if (!id || !realisasiRejectReason.trim()) return;
                    await runExclusive(async () => {
                      try {
                        await apiPost(`/cash-operation/${id}/realisasi/reject-gm`, {
                          reason: realisasiRejectReason.trim(),
                        });
                        toast.success('Realisasi ditolak GM');
                        setGmRejectOpen(false);
                        setRealisasiRejectReason('');
                      } catch (e: unknown) {
                        toast.error(e instanceof Error ? e.message : 'Gagal');
                        return;
                      }
                      await refreshAfterApproval(() => loadDetail(), loadBundle);
                    });
                  }}
```

**AFTER:**
```typescript
                onClick={async () => {
                    if (!id || !realisasiRejectReason.trim()) return;
                    await runExclusive(async () => {
                      try {
                        await apiPost(`/cash-operation/${id}/realisasi/reject-gm`, {
                          reason: realisasiRejectReason.trim(),
                        });
                        toast.success('Realisasi ditolak GM');
                        setGmRejectOpen(false);
                        setRealisasiRejectReason('');
                      } catch (e: unknown) {
                        toast.error(e instanceof Error ? e.message : 'Gagal');
                      }
                      await refreshAfterApproval(() => loadDetail(), loadBundle);
                    });
                  }}
```

Perubahan: hapus baris `return;` dari dalam catch.

---

### Fix 22 — `onRealisasiRejectFinance` (sekitar baris 273) — Pattern B

**BEFORE:**
```typescript
  const onRealisasiRejectFinance = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Finance');
        setRealisasiRejectOpen(false);
        setRealisasiRejectReason('');
        await loadDetail();
        await loadBundle();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
    });
  };
```

**AFTER:**
```typescript
  const onRealisasiRejectFinance = async () => {
    if (!id || !realisasiRejectReason.trim()) {
      toast.error('Alasan wajib diisi');
      return;
    }
    await runExclusive(async () => {
      try {
        await apiPost(`/cash-operation/${id}/realisasi/reject-finance`, { reason: realisasiRejectReason.trim() });
        toast.success('Realisasi ditolak Finance');
        setRealisasiRejectOpen(false);
        setRealisasiRejectReason('');
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Gagal');
      }
      await refreshAfterApproval(() => loadDetail(), loadBundle);
    });
  };
```

---

## SUMMARY OF ALL CHANGES

| Fix | File | Location | Change |
|-----|------|----------|--------|
| 1 | service.ts | `approveByPm` | Notification fire-and-forget |
| 2 | service.ts | `rejectByPm` | Notification fire-and-forget |
| 3 | service.ts | `approveByOps` | Wrap DB in `$transaction` + notification fire-and-forget |
| 4 | service.ts | `rejectByOps` | Notification fire-and-forget |
| 5 | service.ts | `approveByGm` | Wrap DB in `$transaction` + notification fire-and-forget |
| 6 | service.ts | `rejectByFinance` | Notification fire-and-forget |
| 7 | service.ts | `editAndApproveByFinance` | Notification fire-and-forget (DB already transactional) |
| 8 | service.ts | `resubmitRealisasi` | Notification fire-and-forget |
| 9 | service.ts | `submit` | Notification fire-and-forget |
| 10 | service.ts | `approve` | Notification fire-and-forget |
| 11 | service.ts | `reject` | Notification fire-and-forget |
| 12 | page.tsx | `handleOpsApprove` | Remove `return` from catch (Pattern A) |
| 13 | page.tsx | `handleOpsReject` | Move refresh outside try (Pattern B) |
| 14 | page.tsx | `handleMarketingHeadApprove` | Remove `return` from catch (Pattern A) |
| 15 | page.tsx | `handleMarketingHeadReject` | Move refresh outside try (Pattern B) |
| 16 | page.tsx | `handleFinanceApprove` | Remove `return` from catch (Pattern A) |
| 17 | page.tsx | `handleFinanceReject` | Move refresh outside try (Pattern B) |
| 18 | page.tsx | `handlePmApprove` | Remove `return` from catch (Pattern A) |
| 19 | page.tsx | `handlePmReject` | Move refresh outside try (Pattern B) |
| 20 | page.tsx | `handleGmApprove` | Remove `return` from catch (Pattern A) |
| 21 | page.tsx | Inline GM reject `onClick` | Remove `return` from catch (Pattern A) |
| 22 | page.tsx | `onRealisasiRejectFinance` | Move refresh outside try (Pattern B) |

**Files edited**: `apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts`, `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`
**No other files changed.**

---

## VERIFICATION

Setelah apply semua fixes, jalankan:

```bash
# 1. TypeScript check — harus 0 error di kedua file
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit

# 2. Test flow manual:
# - Login sebagai Ops Manager
# - Buka request CA yang sedang PENDING_OPS_REVIEW
# - Klik Approve
# - Status harus langsung update ke PENDING_FINANCE_REVIEW tanpa perlu re-login
# - Tidak ada error "Invalid state transition"
```

Jika masih muncul "Invalid state transition", cek:
1. Apakah ada `await` yang tersisa sebelum `this.notifications.createForRole(...)` atau `createForUser(...)` di service?
2. Apakah ada `return` yang tersisa di dalam catch block di handler-handler page.tsx?
3. Apakah `refreshAfterApproval` dipanggil di luar try/catch (bukan di dalam try)?
