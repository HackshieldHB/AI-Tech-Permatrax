-- Idempotency: replace legacy partial uniques (sourceType, sourceId only) with
-- (sourceType, sourceId, entryType) for untagged rows, plus expression unique for
-- tagged partialRefundType on REFUND_JASA. Scope excludes BUDGET_*, TRANSFER_*,
-- etc., so multiple MANUAL_ADJUSTMENT ledger rows per project remain valid.

DROP INDEX IF EXISTS "BudgetLedger_dedup_deduct";
DROP INDEX IF EXISTS "BudgetLedger_dedup_refund";

CREATE UNIQUE INDEX "BudgetLedger_idempotency_main"
ON "BudgetLedger" ("sourceType", "sourceId", "entryType")
WHERE "sourceType" IS NOT NULL
  AND "sourceId" IS NOT NULL
  AND ("metadata"->>'partialRefundType') IS NULL
  AND "entryType" IN ('DEDUCT_MATERIAL', 'DEDUCT_JASA', 'REFUND_MATERIAL', 'REFUND_JASA');

CREATE UNIQUE INDEX "BudgetLedger_idempotency_partial_refund"
ON "BudgetLedger" ("sourceType", "sourceId", "entryType", (("metadata"->>'partialRefundType')))
WHERE "sourceType" IS NOT NULL
  AND "sourceId" IS NOT NULL
  AND ("metadata"->>'partialRefundType') IS NOT NULL
  AND "entryType" = 'REFUND_JASA';
