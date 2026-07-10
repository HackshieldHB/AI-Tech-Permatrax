-- FTTT Testing Issues: Transaction Log 2-stage (PM create → Finance Tanggal Dana Keluar)
-- + Kurva S baseline vs revised planning
-- + meterDone on Implementation Log (Daily Log → Log Aktivitas)

ALTER TABLE "FtttTransaction"
  ADD COLUMN IF NOT EXISTS "disbursedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disbursedById" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FtttTransaction_disbursedById_fkey'
  ) THEN
    ALTER TABLE "FtttTransaction"
      ADD CONSTRAINT "FtttTransaction_disbursedById_fkey"
      FOREIGN KEY ("disbursedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FtttTransaction_disbursedAt_idx" ON "FtttTransaction"("disbursedAt");

-- Legacy rows already counted toward budget — treat as already disbursed
UPDATE "FtttTransaction"
SET "disbursedAt" = "createdAt"
WHERE "disbursedAt" IS NULL;

-- Snapshot kind: BASELINE (immutable first planning) | CURRENT (revised planning)
ALTER TABLE "FtttMilestone"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'CURRENT';

CREATE INDEX IF NOT EXISTS "FtttMilestone_financeProjectId_kind_idx"
  ON "FtttMilestone"("financeProjectId", "kind");

-- Existing milestones become the baseline snapshot as well (copy CURRENT → BASELINE if none)
INSERT INTO "FtttMilestone" ("id", "financeProjectId", "targetDate", "plannedBudget", "plannedProgressPct", "createdAt", "kind")
SELECT gen_random_uuid()::TEXT, "financeProjectId", "targetDate", "plannedBudget", "plannedProgressPct", "createdAt", 'BASELINE'
FROM "FtttMilestone" m
WHERE m."kind" = 'CURRENT'
  AND NOT EXISTS (
    SELECT 1 FROM "FtttMilestone" b
    WHERE b."financeProjectId" = m."financeProjectId" AND b."kind" = 'BASELINE'
  );

-- Daily Log Span → Log Aktivitas: meter on implementation log entries
ALTER TABLE "FtttImplementationLog"
  ADD COLUMN IF NOT EXISTS "meterDone" DECIMAL(10,2);
