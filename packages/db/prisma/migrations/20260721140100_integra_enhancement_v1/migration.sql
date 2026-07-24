-- Integra Enhancement V1 — columns, tables, hierarchy backfill

-- FinanceProject hierarchy
ALTER TABLE "FinanceProject"
  ADD COLUMN IF NOT EXISTS "hierarchyLevel" "FinanceHierarchyLevel" NOT NULL DEFAULT 'STANDALONE',
  ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE INDEX IF NOT EXISTS "FinanceProject_hierarchyLevel_idx" ON "FinanceProject"("hierarchyLevel");
CREATE INDEX IF NOT EXISTS "FinanceProject_parentId_idx" ON "FinanceProject"("parentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FinanceProject_parentId_fkey'
  ) THEN
    ALTER TABLE "FinanceProject"
      ADD CONSTRAINT "FinanceProject_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- FtttProject hierarchy
ALTER TABLE "FtttProject"
  ADD COLUMN IF NOT EXISTS "hierarchyLevel" "FtttHierarchyLevel" NOT NULL DEFAULT 'SITE',
  ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE INDEX IF NOT EXISTS "FtttProject_hierarchyLevel_idx" ON "FtttProject"("hierarchyLevel");
CREATE INDEX IF NOT EXISTS "FtttProject_parentId_idx" ON "FtttProject"("parentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FtttProject_parentId_fkey'
  ) THEN
    ALTER TABLE "FtttProject"
      ADD CONSTRAINT "FtttProject_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "FtttProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Survey original filename
ALTER TABLE "FtttSurveyUpload"
  ADD COLUMN IF NOT EXISTS "originalFileName" TEXT;

-- Financial Request fields on FtttTransaction
ALTER TABLE "FtttTransaction"
  ADD COLUMN IF NOT EXISTS "expectedNeedDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "priority" "FtttRequestPriority",
  ADD COLUMN IF NOT EXISTS "requestStatus" "FtttRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS "scheduledReleaseAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "declinedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedById" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "FtttTransaction_requestStatus_idx" ON "FtttTransaction"("requestStatus");
CREATE INDEX IF NOT EXISTS "FtttTransaction_expectedNeedDate_idx" ON "FtttTransaction"("expectedNeedDate");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FtttTransaction_reviewedById_fkey'
  ) THEN
    ALTER TABLE "FtttTransaction"
      ADD CONSTRAINT "FtttTransaction_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: already-disbursed transactions are treated as ACCEPTED
UPDATE "FtttTransaction"
SET "requestStatus" = 'ACCEPTED'
WHERE "disbursedAt" IS NOT NULL AND "requestStatus" = 'PENDING_REVIEW';

-- DailyActivity table
CREATE TABLE IF NOT EXISTS "DailyActivity" (
  "id" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "financeProjectId" TEXT,
  "ftttProjectId" TEXT,
  "siteName" TEXT,
  "scopeOfWork" TEXT NOT NULL,
  "workStatus" "DailyActivityWorkStatus" NOT NULL DEFAULT 'ON_PROGRESS',
  "evidenceUrl" TEXT,
  "targetDoneAt" TIMESTAMP(3),
  "remarks" TEXT,
  "lastReminderAt" TIMESTAMP(3),
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyActivity_timestamp_idx" ON "DailyActivity"("timestamp");
CREATE INDEX IF NOT EXISTS "DailyActivity_actorId_idx" ON "DailyActivity"("actorId");
CREATE INDEX IF NOT EXISTS "DailyActivity_financeProjectId_idx" ON "DailyActivity"("financeProjectId");
CREATE INDEX IF NOT EXISTS "DailyActivity_ftttProjectId_idx" ON "DailyActivity"("ftttProjectId");
CREATE INDEX IF NOT EXISTS "DailyActivity_workStatus_idx" ON "DailyActivity"("workStatus");
CREATE INDEX IF NOT EXISTS "DailyActivity_targetDoneAt_idx" ON "DailyActivity"("targetDoneAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivity_actorId_fkey') THEN
    ALTER TABLE "DailyActivity"
      ADD CONSTRAINT "DailyActivity_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivity_financeProjectId_fkey') THEN
    ALTER TABLE "DailyActivity"
      ADD CONSTRAINT "DailyActivity_financeProjectId_fkey"
      FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivity_ftttProjectId_fkey') THEN
    ALTER TABLE "DailyActivity"
      ADD CONSTRAINT "DailyActivity_ftttProjectId_fkey"
      FOREIGN KEY ("ftttProjectId") REFERENCES "FtttProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivity_updatedById_fkey') THEN
    ALTER TABLE "DailyActivity"
      ADD CONSTRAINT "DailyActivity_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- DATA MIGRATION: wrap existing FTTT FinanceProjects as SITE under new SEGMENT
-- Keep existing FinanceProject ids as SITE (preserve FKs)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
  seg_id TEXT;
  seg_code TEXT;
  lain DECIMAL(18,2);
  site_total DECIMAL(18,2);
BEGIN
  FOR r IN
    SELECT *
    FROM "FinanceProject"
    WHERE "projectType" = 'FTTT'
      AND "isDefaultUncategorized" = false
      AND "hierarchyLevel" = 'STANDALONE'
      AND "parentId" IS NULL
  LOOP
    seg_id := gen_random_uuid()::TEXT;
    seg_code := 'SEG-' || LEFT(REPLACE(r."code", 'FIN-', ''), 12);
    -- ensure unique code
    WHILE EXISTS (SELECT 1 FROM "FinanceProject" WHERE "code" = seg_code) LOOP
      seg_code := 'SEG-' || substr(md5(random()::text), 1, 10);
    END LOOP;

    lain := COALESCE(r."budgetLainLain", 0);

    INSERT INTO "FinanceProject" (
      "id", "code", "name", "description", "projectType", "hierarchyLevel", "parentId",
      "totalBudget", "materialBudget", "jasaBudget", "budgetPerizinan", "budgetLainLain",
      "materialSpent", "jasaSpent", "isOverbudget", "isDefaultUncategorized",
      "endDate", "status", "createdById", "updatedById", "createdAt", "updatedAt"
    ) VALUES (
      seg_id,
      seg_code,
      'Segment — ' || r."name",
      COALESCE(r."description", 'Auto-migrated Segment parent for ' || r."code"),
      'FTTT',
      'SEGMENT',
      NULL,
      GREATEST(lain, 0),
      NULL,
      NULL,
      NULL,
      lain,
      0,
      0,
      false,
      false,
      r."endDate",
      r."status",
      r."createdById",
      r."updatedById",
      r."createdAt",
      NOW()
    );

    site_total := COALESCE(r."budgetPerizinan", 0)
      + COALESCE(r."materialBudget", 0)
      + COALESCE(r."jasaBudget", 0);

    UPDATE "FinanceProject"
    SET
      "hierarchyLevel" = 'SITE',
      "parentId" = seg_id,
      "budgetLainLain" = 0,
      "totalBudget" = GREATEST(site_total, COALESCE(r."materialSpent", 0) + COALESCE(r."jasaSpent", 0)),
      "updatedAt" = NOW()
    WHERE "id" = r."id";
  END LOOP;
END $$;

-- FTTH / default projects stay STANDALONE (already default)

-- ═══════════════════════════════════════════════════════════════════════════
-- DATA MIGRATION: wrap existing FtttProjects as SITE under new BULKY parent
-- Keep existing FtttProject ids as SITE (preserve FKs)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r RECORD;
  bulky_id TEXT;
  fin_seg_id TEXT;
BEGIN
  FOR r IN
    SELECT fp.*
    FROM "FtttProject" fp
    WHERE fp."parentId" IS NULL
      AND fp."hierarchyLevel" = 'SITE'
      AND NOT EXISTS (
        SELECT 1 FROM "FtttProject" c WHERE c."parentId" = fp."id"
      )
  LOOP
    fin_seg_id := NULL;
    IF r."financeProjectId" IS NOT NULL THEN
      SELECT "parentId" INTO fin_seg_id
      FROM "FinanceProject"
      WHERE "id" = r."financeProjectId";
    END IF;

    bulky_id := gen_random_uuid()::TEXT;

    INSERT INTO "FtttProject" (
      "id", "cleanListId", "ftttCompany", "triggerDocUrl", "triggerDocType",
      "currentPhase", "status", "pmId", "projectName", "notes",
      "hierarchyLevel", "parentId", "financeProjectId",
      "implementationType", "maintenanceEndDate", "maintenanceConfirmedAt",
      "maintenanceConfirmedById", "lastMaintReminderAt", "totalPanjangMeter",
      "paymentStatus", "createdAt", "updatedAt"
    ) VALUES (
      bulky_id,
      r."cleanListId",
      r."ftttCompany",
      r."triggerDocUrl",
      r."triggerDocType",
      'SITE_INITIATION',
      r."status",
      r."pmId",
      COALESCE(r."projectName", 'Bulky Project'),
      CASE
        WHEN r."notes" IS NULL OR r."notes" = '' THEN '[Auto-migrated Bulky parent]'
        ELSE r."notes" || E'\n[Auto-migrated Bulky parent]'
      END,
      'BULKY',
      NULL,
      fin_seg_id,
      NULL,
      NULL, NULL, NULL, NULL, NULL, NULL,
      r."createdAt",
      NOW()
    );

    INSERT INTO "FtttPhaseProgress" ("id", "projectId", "phase", "status", "unlockedAt", "completedAt", "createdAt", "updatedAt")
    VALUES
      (gen_random_uuid()::TEXT, bulky_id, 'INITIATION', 'COMPLETED', r."createdAt", r."createdAt", NOW(), NOW()),
      (gen_random_uuid()::TEXT, bulky_id, 'SITE_INITIATION', 'ACTIVE', NOW(), NULL, NOW(), NOW())
    ON CONFLICT ("projectId", "phase") DO NOTHING;

    UPDATE "FtttProject"
    SET
      "hierarchyLevel" = 'SITE',
      "parentId" = bulky_id,
      "updatedAt" = NOW()
    WHERE "id" = r."id";

    INSERT INTO "FtttPhaseProgress" ("id", "projectId", "phase", "status", "unlockedAt", "completedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::TEXT, r."id", 'SITE_INITIATION', 'COMPLETED', r."createdAt", r."createdAt", NOW(), NOW())
    ON CONFLICT ("projectId", "phase") DO UPDATE
      SET "status" = 'COMPLETED', "updatedAt" = NOW();
  END LOOP;
END $$;
