# PermaTrack — Cursor Fix Prompt
> Paste seluruh isi file ini ke Cursor Chat (Agent mode). Cursor akan membaca file-file yang relevan secara otomatis karena path sudah dicantumkan.

---

## CONTEXT — Tech Stack

This is a **Turborepo monorepo** with pnpm.
- **Frontend**: `apps/web` — Next.js 14 App Router, TypeScript, Zustand (state), Tailwind CSS, Sonner (toasts), Zod
- **Backend**: `apps/api` — NestJS, Prisma ORM, PostgreSQL, Zod validation pipes

---

## FIX 1 — GIS Map: "Simpan" Button Always Fails With "Harap muat design" Error

### Root Cause (confirmed by reading source)

`SavedDesignsPanel.tsx` → `handleLoadList()` calls `listDesigns(projectId)` which **only fetches the list** (`DesignSummary[]`) and sets `designsList` state. It never calls `loadDesign()`, so `useDesignStore.designId` stays `null`.

`useCommandStore.ts` → `flush()` checks `useDesignStore.getState().designId`. When it is `null` **and** `calcInputs` has no `areaType`, it throws:
> "Harap muat design terlebih dahulu melalui panel Desain Tersimpan sebelum menyimpan perubahan."

The toast "Design berhasil dimuat" fires on successful `listDesigns()` — it is **misleading** because no design was actually loaded.

### Files to Change

1. `apps/web/src/app/map/components/SavedDesignsPanel.tsx`
2. `apps/web/src/app/map/hooks/useDesign.ts`
3. `apps/web/src/store/useCommandStore.ts` (minor guard fix)

### Required Changes

#### A. `SavedDesignsPanel.tsx` — fix `handleLoadList`

The `SavedDesignsPanelProps` already receives `loadDesign` as a prop. After `listDesigns` succeeds:

- If the returned list has **≥ 1 item**, automatically call `loadDesign(list[0].id)` (most recent) so `designStore.designId` is populated.
- Change the success toast to a two-step message:
  - While loading: `"Memuat design..."`
  - After `loadDesign` resolves: `"Design berhasil dimuat dan siap diedit"`
- If the list is **empty** (no designs for that projectId) AND `useDesignStore.getState().calcInputs` exists (i.e. a calc has been run), call `saveDesignAsDraft` to auto-create a draft. The props already include `saveDesignAsDraft`, `calcResult`, `lastRenderedGeometry`, etc.
- The panel must show the loaded design as active (highlighted in blue) after auto-load — this already works once `loadedDesignId` is set, because the list item renders `active = loadedDesignId === item.id`.

```typescript
// BEFORE (broken):
const handleLoadList = async () => {
  if (!projectId.trim()) { toast.error('...'); return; }
  const { pendingPersist, flush } = useCommandStore.getState();
  if (pendingPersist.length > 0) { await flush({ interaction: 'panel-refresh' }); }
  try {
    await listDesigns(projectId.trim());
    toast.success('Design berhasil dimuat');   // ← misleading, no design loaded
  } catch { /* ... */ }
};

// AFTER (fix):
const handleLoadList = async () => {
  if (!projectId.trim()) { toast.error('Isi Project ID terlebih dahulu.'); return; }
  const { pendingPersist, flush } = useCommandStore.getState();
  if (pendingPersist.length > 0) { await flush({ interaction: 'panel-refresh' }); }
  try {
    await listDesigns(projectId.trim());
    // After list is fetched, check the updated designsList
    // NOTE: listDesigns updates state async; read from useDesign's returned designsList
    // We call loadDesign on the first item (most recent) if list is non-empty
    // listDesigns is async and updates local state — we need to access the list
    // The cleanest approach: return the list from listDesigns, then act on it.
  } catch { /* ... */ }
};
```

**Change `useDesign.ts` → `listDesigns`** to return the list:
```typescript
// BEFORE:
const listDesigns = useCallback(async (projectId: string): Promise<void> => {
  // ...
  const list = await apiGet<DesignSummary[]>('/design', { projectId });
  setDesignsList(list);
  // returns void
}, []);

// AFTER:
const listDesigns = useCallback(async (projectId: string): Promise<DesignSummary[]> => {
  setListLoading(true);
  setListError(null);
  try {
    const list = await apiGet<DesignSummary[]>('/design', { projectId });
    setDesignsList(list);
    return list;   // ← return the list so callers can act on it
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Gagal mengambil daftar design';
    setListError(msg);
    toast.error(msg);
    throw err;
  } finally {
    setListLoading(false);
  }
}, []);
```

Update `UseDesignReturn` interface accordingly: `listDesigns: (projectId: string) => Promise<DesignSummary[]>`

Then update `SavedDesignsPanelProps` and the `handleLoadList` in `SavedDesignsPanel.tsx`:
```typescript
const handleLoadList = async () => {
  if (!projectId.trim()) { toast.error('Isi Project ID terlebih dahulu.'); return; }
  const { pendingPersist, flush } = useCommandStore.getState();
  if (pendingPersist.length > 0) { await flush({ interaction: 'panel-refresh' }); }
  try {
    const list = await listDesigns(projectId.trim());
    if (list.length > 0) {
      // Auto-load the most recent design so designStore.designId is set
      toast.info('Memuat design...');
      await loadDesign(list[0].id);
      toast.success('Design berhasil dimuat dan siap diedit');
    } else {
      // No existing design for this projectId — notify user
      toast.info('Tidak ada design tersimpan untuk Project ID ini. Anda dapat mulai mengedit dan klik Simpan untuk membuat design baru.');
    }
  } catch {
    // errors already toasted inside listDesigns / loadDesign
  }
};
```

#### B. `useCommandStore.ts` — improve the guard message clarity

In `flush()` around line 138–143, the guard that throws "Harap muat design" currently also blocks when `calcInputs` exists (it tries to auto-create a draft in that case). Verify this auto-create path works correctly end-to-end after the fix above. If it does, no change needed here. If not, ensure the auto-create path properly calls `setProjectId` before posting to `/design`.

---

## FIX 2 — GIS Map: Move "Simpan" Button to Saved Designs Panel

### Files to Change

1. `apps/web/src/app/map/components/DesignModeToolbar.tsx`
2. `apps/web/src/app/map/components/SavedDesignsPanel.tsx`

### Required Changes

#### A. `DesignModeToolbar.tsx` — REMOVE the Simpan button

Remove the entire `<button>` block that renders the 💾 Simpan button (the one that calls `useCommandStore.getState().flush({ interaction: 'toolbar-save' })`). This is the button styled with `background: isSaving ? '#F9FAFB' : hasPending ? '#FEF3C7' : '#ffffff'`.

#### B. `SavedDesignsPanel.tsx` — ADD Simpan button between Project ID and Muat Daftar

Insert the Simpan button **after** the Project ID `<input>` block and **before** the Muat Daftar `<button>`. The button should:
- Read `hasPending` and `isSaving` from `useCommandStore`
- Call `useCommandStore.getState().flush({ interaction: 'toolbar-save' })` on click
- Be **disabled** when: Edit Mode is OFF, OR `!hasPending`, OR `isSaving`
- Styling should match the amber/warning style when there are pending changes:

```tsx
// Add at top of SavedDesignsPanel component:
const hasPending = useCommandStore((s) => s.pendingPersist.length > 0);
const isSaving = useCommandStore((s) => s.isSaving);
const editMode = useDesignStore((s) => s.editMode);

// Insert between Project ID input block and Muat Daftar button:
<button
  type="button"
  onClick={() => {
    void useCommandStore.getState().flush({ interaction: 'toolbar-save' });
  }}
  disabled={!editMode || !hasPending || isSaving}
  style={{
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #F59E0B',
    background: isSaving ? '#F9FAFB' : hasPending && editMode ? '#FEF3C7' : '#F9FAFB',
    color: isSaving ? '#9CA3AF' : hasPending && editMode ? '#92400E' : '#9CA3AF',
    cursor: (hasPending && editMode && !isSaving) ? 'pointer' : 'not-allowed',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  }}
  title={
    !editMode ? 'Aktifkan Edit Mode terlebih dahulu' :
    !hasPending ? 'Tidak ada perubahan untuk disimpan' :
    isSaving ? 'Sedang menyimpan...' : 'Simpan perubahan design'
  }
>
  <span>{isSaving ? '⏳' : '💾'}</span>
  {isSaving ? 'Menyimpan...' : 'Simpan'}
</button>
```

Final layout order in the left panel (top to bottom):
1. Label "Project ID (sementara)"
2. Project ID `<input>`
3. 💾 **Simpan** button ← new position
4. 🔄 Muat daftar button
5. Design list

---

## FIX 3 — Approve Shows "The string did not match the expected pattern" Error

### Files

- `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`
- `apps/api/src/cash-op-realisasi/cash-op-realisasi.controller.ts`
- `apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts`

### Root Cause

The approve API call **succeeds** on the backend (status IS saved — confirmed because it shows correctly after re-login). The error fires on the **frontend** when `loadDetail()` or `loadBundle()` is called after the approve POST, and the response contains a field that fails a Zod/runtime parse.

The pattern "The string did not match the expected pattern" is a native browser error from the **Date constructor** or a Zod `z.string().datetime()` validation failure when parsing a field in the refreshed detail response.

### Required Fix

In `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`, all approve handlers follow this pattern:
```typescript
await apiPost(`/cash-operation/${id}/realisasi/approve-ops`, { notes: ... });
toast.success('Realisasi disetujui ...');
await loadDetail();   // ← this throws "The string did not match the expected pattern"
await loadBundle();
```

**Fix: wrap the post-approve refresh in its own try-catch** so that a parse error on refresh doesn't mask the success:

Apply this pattern to ALL approve handlers: `onApproveStage1`, `handleOpsApprove`, `handleFinanceApprove`, `onRealisasiApproveGm`, `handleMarketingHeadApprove`, `handlePmApprove`:

```typescript
// PATTERN TO APPLY TO ALL APPROVE HANDLERS:
try {
  await apiPost(`/cash-operation/${id}/realisasi/approve-ops`, { notes: opsNotes.trim() || undefined });
  toast.success('Realisasi disetujui Ops Manager');
} catch (e: unknown) {
  toast.error(e instanceof Error ? e.message : 'Gagal memproses approval');
  return;
}

// Separate try-catch for the refresh — failure here must NOT show an error toast
// because the approval already succeeded
try {
  await loadDetail();
  await loadBundle();
} catch {
  // Refresh failed but approval succeeded — silently reload the page
  window.location.reload();
}
```

Also **investigate the root parse error**: In `loadDetail()`, after the `apiGet` returns the detail object, log the raw response and check which field fails. Likely candidates:
- `detail.periodeFrom` / `detail.periodeTo` — stored as datetime strings, may be missing timezone suffix (`Z`) in older records
- `detail.approvalSteps[].decidedAt` — same issue
- Any field passed to `new Date(someString)` where `someString` could be null/undefined

Fix those field parsers to be defensive:
```typescript
// Replace any fragile date parsing:
const date = new Date(someString);  // FRAGILE

// With:
const date = someString ? new Date(someString) : null;  // SAFE
if (date && isNaN(date.getTime())) {
  console.warn('Invalid date string:', someString);
}
```

---

## FIX 4A — Realisasi: "Tolak" Button Does Nothing

### File

`apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`

### Root Cause

The Tolak buttons call `setOpsRejectOpen(true)`, `setFinanceRejectOpen(true)`, `setRealisasiRejectOpen(true)` but the **Ops Manager reject modal** (`opsRejectOpen`) may not have its corresponding JSX rendered, or the shared `realisasiRejectReason` state is shared across multiple modals causing them to conflict/hide each other.

### Required Fix

Audit each Tolak button and ensure its corresponding modal JSX is rendered in the page. The page currently has:
- `rejectOpen` → reject modal for Stage 1 cash op approval (line ~1282) ✅ exists
- `realisasiRejectOpen` → shared modal for realisasi rejection (line ~1314) — used by GM and Finance
- `opsRejectOpen` → state defined at line 50, but verify a modal is rendered for it
- `financeRejectOpen` → state defined at line 53, verify modal rendered
- `marketingHeadRejectOpen` → inline modal inside the Marketing Head approval block ✅ exists

**For each missing modal**, add JSX at the bottom of the page (before the closing `</div>`) following the same pattern:

```tsx
{/* Ops Manager Reject Modal */}
{opsRejectOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
      <h3 className="font-black text-slate-900">Tolak Realisasi (Ops Manager)</h3>
      <textarea
        placeholder="Alasan penolakan (wajib diisi)..."
        value={realisasiRejectReason}
        onChange={(e) => setRealisasiRejectReason(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setOpsRejectOpen(false); setRealisasiRejectReason(''); }}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-700"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={() => void handleOpsReject()}
          disabled={saving || !realisasiRejectReason.trim()}
          className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50"
        >
          {saving ? 'Memproses...' : 'Konfirmasi Tolak'}
        </button>
      </div>
    </div>
  </div>
)}
```

Apply the same pattern for `financeRejectOpen` wired to `handleFinanceReject()`.

Also ensure each reject handler (`handleOpsReject`, `handleFinanceReject`) closes its own modal state flag (not the wrong shared one) after success.

**Rejection flow after "Tolak":**
- Ops rejects → status becomes `REALISASI_REJECTED_BY_OPS` → requestor sees rejection reason and "Revisi & Ajukan Ulang" button ✅ (already in code)
- Finance rejects → status becomes `REALISASI_REJECTED_BY_FINANCE` ✅ (already in code)
- GM rejects → calls `rejectByGm` → status becomes `REALISASI_REJECTED_BY_GM` (verify this status exists in backend and is handled in the rejected banner)

---

## FIX 4B — Finance Approval: Remove Nominal & Signature Fields

### File

`apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`

### Required Changes — Frontend

In the Finance approval block (search for `"finance-review"` render or `financeRealisasiAct`), **remove** these elements:

1. **Remove** the `financeNominalDisetujui` input block:
```tsx
// DELETE THIS ENTIRE BLOCK (~lines 755-773):
<div className="space-y-1">
  <label ...>Nominal yang disetujui</label>
  <input
    type="number"
    value={financeNominalDisetujui ?? ''}
    onChange={(e) => setFinanceNominalDisetujui(...)}
    ...
  />
  <p ...>Isi jika nominal yang disetujui berbeda...</p>
</div>
```

2. **Remove** the `financeSignatureUrl` upload block (search for "Tanda Tangan Finance" or `financeSignatureUrl` input).

3. Update `handleFinanceApprove()`:
```typescript
// BEFORE:
const handleFinanceApprove = async () => {
  if (!nomorRekeningFinance.trim()) { toast.error('Nomor rekening wajib diisi'); return; }
  if (!financeSignatureUrl) { toast.error('Tanda tangan Finance wajib diupload'); return; }
  await apiPatch(`/cash-operation/${id}/realisasi/finance-review`, {
    nomorRekeningFinance: nomorRekeningFinance.trim(),
    financeSignatureUrl: financeSignatureUrl,
    financeNominalDisetujui: financeNominalDisetujui || undefined,
    ...
  });
  ...
};

// AFTER:
const handleFinanceApprove = async () => {
  if (!nomorRekeningFinance.trim()) { toast.error('Nomor rekening tujuan wajib diisi'); return; }
  // No signature check, no nominal check
  await apiPatch(`/cash-operation/${id}/realisasi/finance-review`, {
    nomorRekeningFinance: nomorRekeningFinance.trim(),
    // Remove financeSignatureUrl and financeNominalDisetujui
  });
  toast.success('Realisasi disetujui Finance');
  setNomorRekeningFinance('');
  try { await loadDetail(); await loadBundle(); } catch { window.location.reload(); }
};
```

4. Update the Approve button's `disabled` condition — remove `!financeSignatureUrl`:
```tsx
// BEFORE:
disabled={saving || !nomorRekeningFinance.trim() || !financeSignatureUrl}

// AFTER:
disabled={saving || !nomorRekeningFinance.trim()}
```

5. Remove state variables no longer needed:
```typescript
// DELETE these state declarations:
const [financeSignatureUrl, setFinanceSignatureUrl] = useState('');
const [financeNominalDisetujui, setFinanceNominalDisetujui] = useState<number | undefined>();
```

Also remove any `handleFinanceSignatureUpload` function if it exists.

### Required Changes — Backend

`apps/api/src/cash-op-realisasi/cash-op-realisasi.controller.ts` — in `editAndApproveByFinance`:
```typescript
// BEFORE:
@Body() dto: {
  nomorRekeningFinance: string;
  financeSignatureUrl: string;       // ← required
  financeNominalDisetujui?: number;  // ← remove
  items?: Array<...>;
  notes?: string;
}

// AFTER:
@Body() dto: {
  nomorRekeningFinance: string;
  financeSignatureUrl?: string;      // ← make optional (for backward compat)
  items?: Array<...>;
  notes?: string;
}
```

`apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts` — in `editAndApproveByFinance`:
- Remove any guard that throws when `financeSignatureUrl` is missing
- Remove any logic that saves `financeNominalDisetujui` to the database (Finance should not modify the approved amount)

---

## FIX 4C — GM Approval: Remove Duplicate Box & Signature Upload

### File

`apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`

### Root Cause

There are **TWO** GM approval sections in the page:
1. **Outer block** — rendered via `gmRealisasiAct` computed property (defined around line 151), outside the bundle loading block. This has a `gmNotes` textarea and calls `onRealisasiApproveGm()`.
2. **Inner block** — rendered with condition `realisasiStatus === 'PENDING_GM_REVIEW' && user?.role === 'GENERAL_MANAGER'` inside the bundle section (around line 1057). This has the signature upload and calls `handleGmApprove()`.

### Required Changes — Frontend

**Step 1: REMOVE the outer `gmRealisasiAct` block** entirely:
```tsx
// DELETE this entire block:
{gmRealisasiAct ? (
  <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 space-y-2">
    <p ...>Menunggu keputusan General Manager</p>
    <textarea value={notes} ... />
    <div className="flex flex-wrap gap-2">
      <button ... onClick={() => void onRealisasiApproveGm()}>Setujui</button>
      <button ... onClick={() => { setRealisasiRejectReason(''); setRealisasiRejectOpen(true); }}>Tolak</button>
    </div>
  </div>
) : null}
```

Also delete the `gmRealisasiAct` computed variable and `onRealisasiApproveGm` function.

**Step 2: In the INNER GM block** (the one that stays), **remove the signature upload section**:
```tsx
// DELETE this entire signature upload block inside the GM approval card:
<div className="space-y-1">
  <label ...>Upload Tanda Tangan GM <span className="text-red-500"> *</span></label>
  <input type="file" accept="image/png,image/jpeg" onChange={handleGmSignatureUpload} ... />
  {gmSignatureUrl && <img src={gmSignatureUrl} ... />}
  <p ...>Format PNG/JPG. Wajib diisi sebelum approve.</p>
</div>
```

**Step 3: Update `handleGmApprove()`** — remove signature requirement:
```typescript
// BEFORE:
const handleGmApprove = async () => {
  if (!gmSignatureUrl) { toast.error('...'); return; }
  await apiPost(`/cash-operation/${id}/realisasi/approve-gm`, {
    gmSignatureUrl,
    notes: gmNotes || undefined,
  });
  ...
};

// AFTER:
const handleGmApprove = async () => {
  // No signature check
  await apiPost(`/cash-operation/${id}/realisasi/approve-gm`, {
    notes: gmNotes || undefined,
    // Remove gmSignatureUrl
  });
  toast.success('Realisasi disetujui GM');
  setGmNotes('');
  try { await loadDetail(); await loadBundle(); } catch { window.location.reload(); }
};
```

**Step 4: Update Approve button** — remove `!gmSignatureUrl` from disabled condition:
```tsx
// BEFORE:
disabled={!gmSignatureUrl || saving}

// AFTER:
disabled={saving}
```

**Step 5: Remove unused state**:
```typescript
// DELETE:
const [gmSignatureUrl, setGmSignatureUrl] = useState('');
// Also delete handleGmSignatureUpload function
```

### Required Changes — Backend

`apps/api/src/cash-op-realisasi/cash-op-realisasi.controller.ts` — in `approveByGm`:
```typescript
// BEFORE:
@Body() body: { gmSignatureUrl: string; notes?: string }

// AFTER:
@Body() body: { gmSignatureUrl?: string; notes?: string }  // make optional
```

`apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts` — in `approveByGm`:
- Remove any guard that requires `gmSignatureUrl`
- `gmSignatureUrl` is optional; if provided, save it; if not, proceed without it

---

---

## FIX 5 — Marketing/Marketing Head: Error "Minimal 3 Foto" Saat Ajukan Realisasi

### Root Cause (confirmed by reading source)

`apps/api/src/cash-op-realisasi/cash-op-realisasi.service.ts` — in the `submit()` function, lines ~571–576:

```typescript
const isMarketing = requester.role === Role.MARKETING || requester.role === Role.MARKETING_HEAD;
if (isMarketing) {
  const photoCount = items.filter((i) => !!i.photoUrl).length;
  if (photoCount < 3) {
    throw new BadRequestException('Marketing wajib mengunggah minimal 3 foto bukti realisasi');
  }
}
```

This hard validation blocks submission even if the user has filled in 1 valid item with 1 photo.

### Required Fix

**Remove the minimum photo count validation entirely.** The only requirement should be: at least 1 item exists with a valid description, payment date, and amount > 0. Photo is optional (best-effort).

```typescript
// BEFORE:
const isMarketing = requester.role === Role.MARKETING || requester.role === Role.MARKETING_HEAD;
if (isMarketing) {
  const photoCount = items.filter((i) => !!i.photoUrl).length;
  if (photoCount < 3) {
    throw new BadRequestException('Marketing wajib mengunggah minimal 3 foto bukti realisasi');
  }
}

// AFTER: DELETE the entire isMarketing photo check block above.
// Keep only the existing guard:
if (items.length === 0) {
  throw new BadRequestException('Realisasi harus memiliki minimal satu item');
}
// No minimum photo requirement for any role.
```

Apply the same removal in `resubmitRealisasi()` if the same check also exists there.

---

## FIX 6 — Requestor Cannot Edit Realisasi After Rejection (All Rejection Types)

### Root Cause (confirmed by reading source)

**Problem 1 — Missing rejection statuses in the frontend banner.**
In `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx`, the rejection banner (around line 848) only handles two statuses:
```typescript
{(detail.status === 'REALISASI_REJECTED_BY_OPS' ||
  detail.status === 'REALISASI_REJECTED_BY_FINANCE') &&
```
The following rejection statuses are **completely missing** from the UI — requestor sees nothing when rejected by these roles:
- `REALISASI_REJECTED_BY_GM`
- `REALISASI_REJECTED_BY_MARKETING_HEAD`
- `REALISASI_REJECTED_BY_PM`

**Problem 2 — The edit/revision page does not exist.**
The "Revisi & Ajukan Ulang" button navigates to:
```typescript
window.location.href = `/cash-operation/${detail.id}/realisasi/edit`;
```
But this route **does not exist** in `apps/web/src/app/(dashboard)/cash-operation/`. There is no `[id]/realisasi/edit/page.tsx`. Clicking the button leads to a 404.

### Required Fixes

#### A. `apps/web/src/types/api.types.ts` — add missing rejection statuses

The `RealisasiStatus` type is currently:
```typescript
export type RealisasiStatus =
  | 'DRAFT'
  | 'PENDING_PM_REVIEW'
  | 'PENDING_OPS_REVIEW'
  | 'PENDING_GM_REVIEW'
  | 'PENDING_FINANCE_REVIEW'
  | 'PENDING_MARKETING_HEAD_REVIEW'
  | 'REJECTED'
  | 'DONE';
```

The `CashOperationRequest.status: string` covers the backend-level rejection statuses but the `realisasiStatus` field only has `'REJECTED'` — not the granular ones. Check the `CashOperationRequest` interface and ensure the backend returns `realisasiRejectionReason` / `realisasiRejectedReason` for all rejection types.

#### B. `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx` — expand the rejection banner

Replace the narrow two-status check with a helper that covers ALL rejection statuses and shows the correct "rejected by" label:

```typescript
// Add this helper near the top of the component (after state declarations):
const REALISASI_REJECTION_LABELS: Record<string, string> = {
  REALISASI_REJECTED_BY_OPS: 'Ops Manager',
  REALISASI_REJECTED_BY_FINANCE: 'Finance',
  REALISASI_REJECTED_BY_GM: 'General Manager',
  REALISASI_REJECTED_BY_MARKETING_HEAD: 'Marketing Head',
  REALISASI_REJECTED_BY_PM: 'PM Senior',
};

const isRealisasiRejected = detail
  ? Object.keys(REALISASI_REJECTION_LABELS).includes(detail.status)
  : false;
const realisasiRejectedByLabel = detail
  ? REALISASI_REJECTION_LABELS[detail.status] ?? 'Approver'
  : '';
```

Then replace the current narrow condition:
```tsx
// BEFORE (~line 848):
{(detail.status === 'REALISASI_REJECTED_BY_OPS' ||
  detail.status === 'REALISASI_REJECTED_BY_FINANCE') &&
user?.id === detail.requestedBy ? (
  <div ...>
    <h3>❌ Realisasi Ditolak</h3>
    <p>Ditolak oleh: {detail.status === 'REALISASI_REJECTED_BY_OPS' ? 'Ops Manager' : 'Finance'}</p>
    ...
  </div>
) : null}

// AFTER:
{isRealisasiRejected && user?.id === detail.requestedBy ? (
  <div className="border rounded-xl p-4 space-y-3 bg-red-50 border-red-200">
    <h3 className="font-medium text-red-800">❌ Realisasi Ditolak</h3>
    <p className="text-sm text-gray-600">Ditolak oleh: {realisasiRejectedByLabel}</p>
    <p className="text-sm bg-white border border-red-200 rounded-lg p-3">
      {detail.realisasiRejectedReason ?? detail.realisasiRejectionReason ?? 'Tidak ada alasan diberikan.'}
    </p>
    <button
      type="button"
      onClick={() => setShowRevisasiForm(true)}   // ← open inline form, NOT navigate
      className="w-full border border-primary text-primary rounded-lg py-2 text-sm font-medium"
    >
      ✏️ Revisi & Ajukan Ulang
    </button>
  </div>
) : null}
```

#### C. `apps/web/src/app/(dashboard)/cash-operation/[id]/page.tsx` — inline revision form (NO new page needed)

Instead of creating a new route, render the revision form inline on the same page using the existing `RealisasiForm` component and the `resubmit` endpoint.

Add state variable:
```typescript
const [showRevisasiForm, setShowRevisasiForm] = useState(false);
```

After the rejection banner, conditionally render the revision form:
```tsx
{showRevisasiForm && isRealisasiRejected && user?.id === detail.requestedBy ? (
  <div className="border rounded-xl p-4 space-y-3 bg-white border-slate-200">
    <div className="flex justify-between items-center">
      <h3 className="font-black text-slate-900">✏️ Revisi Rincian Realisasi</h3>
      <button
        type="button"
        onClick={() => setShowRevisasiForm(false)}
        className="text-slate-400 hover:text-slate-600 text-sm"
      >
        Tutup
      </button>
    </div>
    <RealisasiForm
      cashOp={detail}
      initialItems={realisasiItems}   // pre-populate with existing items
      onSaveDraft={onSaveRealisasiDraft}
      onSubmit={onResubmitRealisasi}  // ← NEW handler using resubmit endpoint
    />
  </div>
) : null}
```

Add the `onResubmitRealisasi` handler that calls the existing backend `resubmit` endpoint:
```typescript
const onResubmitRealisasi = async (items: RealisasiItemInput[]) => {
  if (!id) return;
  await runExclusive(async () => {
    try {
      // The resubmit endpoint saves items AND re-submits in one call
      await apiPost(`/cash-operation/${id}/realisasi/resubmit`, itemsToDraftPayload(items));
      toast.success('Realisasi berhasil diajukan ulang');
      setShowRevisasiForm(false);
      await loadDetail();
      await loadBundle();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengajukan ulang');
    }
  });
};
```

The backend endpoint `POST /cash-operation/:id/realisasi/resubmit` already exists in `cash-op-realisasi.controller.ts` and handles all `REJECTED_REALISASI_STATUSES`. It rebuilds the approval chain based on requester's role automatically.

**Rejection re-submission flow (both chains):**

Ops chain (Surveyor / Admin / Designer / PM):
- Ops Manager rejects → requestor revises → resubmit → Ops Manager → Finance → GM
- Finance rejects → requestor revises → resubmit → Ops Manager → Finance → GM
- GM rejects → requestor revises → resubmit → Ops Manager → Finance → GM

Marketing chain (Marketing / Marketing Head):
- Marketing Head rejects → requestor revises → resubmit → Marketing Head → Finance → GM
- Finance rejects → requestor revises → resubmit → Marketing Head → Finance → GM
- GM rejects → requestor revises → resubmit → Marketing Head → Finance → GM

The `buildRealisasiApprovalChain()` in the backend already handles this branching correctly — no backend changes needed for the chain itself.

---

## FIX 7 — Marketing Flow: Finance Form Same Issues as Ops Flow

The Finance approval form issues (FIX 4B) apply to the **Marketing flow** as well. The same `handleFinanceApprove` function and the same finance-review form are shown regardless of whether the requester is from the Ops chain or Marketing chain.

No additional code changes needed beyond what's described in FIX 4B — the removal of nominal edit and signature upload from the Finance form is a global change that fixes both flows simultaneously.

Verify that after the fix:
- Finance approving a Marketing/Marketing Head realisasi also only sees "Nomor Rekening Tujuan" field
- No signature required, no nominal edit possible

---

## VERIFICATION CHECKLIST

After applying all fixes, verify these end-to-end flows:

### GIS Map
- [ ] Input Project ID → Click "Muat Daftar" → Design auto-loads → Design appears active in panel → Edit Mode can be turned ON → Edits can be made → 💾 Simpan button (now in left panel) saves successfully → Toast shows "Design berhasil disimpan" → No error popup
- [ ] Page refresh after save → Re-open with same Project ID → All edits persist

### Approval — Cash Advance (Stage 1)
- [ ] Ops Manager / Finance / GM clicks "Approve" → Status immediately changes to next step → No error message → No re-login required
- [ ] Tolak button works at every stage → Modal opens → Reason entered → Confirms → Status changes → Requestor sees rejection

### Approval — Realisasi, Ops Chain (Surveyor / Admin / Designer / PM requestor)
- [ ] Requestor submits realisasi → Goes to Ops Manager inbox ✅
- [ ] Ops Manager: "Approve" works immediately (no re-login), "Tolak" opens modal and works → Rejected: requestor sees banner with rejection reason + "Revisi & Ajukan Ulang" → Inline form opens → Resubmit works → Chain restarts from Ops Manager
- [ ] Finance: sees only "Nomor Rekening Tujuan" (NO nominal edit, NO signature) → Approve/Tolak both work
- [ ] GM: sees only ONE approval box (NO duplicate, NO signature upload) → Approve/Tolak both work
- [ ] GM approves → Requestor sees DONE with both bank account numbers

### Approval — Realisasi, Marketing Chain (Marketing / Marketing Head requestor)
- [ ] Requestor can submit realisasi with just 1 item + 1 photo (no "minimal 3 foto" error)
- [ ] Goes to Marketing Head inbox → Marketing Head: Approve/Tolak both work
- [ ] Finance: same as above — only "Nomor Rekening Tujuan", no nominal edit, no signature
- [ ] GM: same as above — single box, no signature
- [ ] Rejection at any stage → requestor can revise inline and resubmit → chain restarts

### No regressions
- [ ] Cash Advance creation still works (Stage 1 `ApprovalDialog` component unchanged)
- [ ] All existing toast messages still appear correctly
- [ ] No TypeScript errors after all changes (`tsc --noEmit` passes)
