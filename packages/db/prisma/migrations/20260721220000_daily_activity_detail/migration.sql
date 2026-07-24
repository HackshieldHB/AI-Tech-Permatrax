-- Integra Enhancement V2 — Daily Activity "Lihat Detail": multi-file evidence + history

CREATE TABLE IF NOT EXISTS "DailyActivityEvidence" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "originalFileName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyActivityEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyActivityEvidence_activityId_idx" ON "DailyActivityEvidence"("activityId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivityEvidence_activityId_fkey') THEN
    ALTER TABLE "DailyActivityEvidence"
      ADD CONSTRAINT "DailyActivityEvidence_activityId_fkey"
      FOREIGN KEY ("activityId") REFERENCES "DailyActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivityEvidence_uploadedById_fkey') THEN
    ALTER TABLE "DailyActivityEvidence"
      ADD CONSTRAINT "DailyActivityEvidence_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DailyActivityHistory" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "workStatus" "DailyActivityWorkStatus" NOT NULL,
  "remarks" TEXT,
  "targetDoneAt" TIMESTAMP(3),
  "changedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyActivityHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DailyActivityHistory_activityId_idx" ON "DailyActivityHistory"("activityId");
CREATE INDEX IF NOT EXISTS "DailyActivityHistory_createdAt_idx" ON "DailyActivityHistory"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivityHistory_activityId_fkey') THEN
    ALTER TABLE "DailyActivityHistory"
      ADD CONSTRAINT "DailyActivityHistory_activityId_fkey"
      FOREIGN KEY ("activityId") REFERENCES "DailyActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DailyActivityHistory_changedById_fkey') THEN
    ALTER TABLE "DailyActivityHistory"
      ADD CONSTRAINT "DailyActivityHistory_changedById_fkey"
      FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: seed one history row per existing DailyActivity so "Riwayat Update" is never
-- empty for records that were already updated (updatedAt materially after createdAt) or
-- already carry a legacy evidenceUrl.
INSERT INTO "DailyActivityHistory" ("id", "activityId", "workStatus", "remarks", "targetDoneAt", "changedById", "createdAt")
SELECT
  'seed_' || da."id",
  da."id",
  da."workStatus",
  da."remarks",
  da."targetDoneAt",
  COALESCE(da."updatedById", da."actorId"),
  da."updatedAt"
FROM "DailyActivity" da
WHERE (da."updatedAt" > da."createdAt" + INTERVAL '1 minute' OR da."evidenceUrl" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "DailyActivityHistory" h WHERE h."activityId" = da."id");

-- Backfill: migrate legacy single-URL evidenceUrl into the new multi-file evidence table.
INSERT INTO "DailyActivityEvidence" ("id", "activityId", "fileUrl", "uploadedById", "createdAt")
SELECT
  'seed_' || da."id",
  da."id",
  da."evidenceUrl",
  COALESCE(da."updatedById", da."actorId"),
  da."updatedAt"
FROM "DailyActivity" da
WHERE da."evidenceUrl" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "DailyActivityEvidence" e WHERE e."activityId" = da."id");
