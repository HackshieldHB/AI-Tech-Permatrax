-- Run against the target DB BEFORE applying migration
-- `budget_ledger_idempotency_constraint`.
--
-- 1) Sprint diagnostic (raw triplet): COUNT(*) > 1 can include LEGITIMATE cases
--    where two REFUND_JASA rows share the same cash op but differ by
--    metadata.partialRefundType (REALISASI_VARIANCE vs REIMBURSEMENT_VARIANCE).
--    Use queries (2) and (3) to decide whether migration is safe.

SELECT "sourceType", "sourceId", "entryType", COUNT(*) AS row_count
FROM "BudgetLedger"
WHERE "sourceType" IS NOT NULL
  AND "sourceId" IS NOT NULL
GROUP BY "sourceType", "sourceId", "entryType"
HAVING COUNT(*) > 1;

-- 2) Blocking: duplicate MAIN idempotency rows (no partialRefundType tag)
--    among deduct/refund entry types only — must be empty before migrate.
SELECT "sourceType", "sourceId", "entryType", COUNT(*) AS row_count
FROM "BudgetLedger"
WHERE "sourceType" IS NOT NULL
  AND "sourceId" IS NOT NULL
  AND ("metadata"->>'partialRefundType') IS NULL
  AND "entryType" IN ('DEDUCT_MATERIAL', 'DEDUCT_JASA', 'REFUND_MATERIAL', 'REFUND_JASA')
GROUP BY "sourceType", "sourceId", "entryType"
HAVING COUNT(*) > 1;

-- 3) Blocking: duplicate tagged partial refunds (same tag twice)
SELECT
  "sourceType",
  "sourceId",
  "entryType",
  ("metadata"->>'partialRefundType') AS partial_refund_type,
  COUNT(*) AS row_count
FROM "BudgetLedger"
WHERE "sourceType" IS NOT NULL
  AND "sourceId" IS NOT NULL
  AND ("metadata"->>'partialRefundType') IS NOT NULL
  AND "entryType" = 'REFUND_JASA'
GROUP BY "sourceType", "sourceId", "entryType", ("metadata"->>'partialRefundType')
HAVING COUNT(*) > 1;
