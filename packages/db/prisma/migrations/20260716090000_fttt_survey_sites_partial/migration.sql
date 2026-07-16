-- AlterTable
ALTER TABLE "FtttSurveyUpload" ADD COLUMN IF NOT EXISTS "siteId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "FtttSurveySite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FtttSurveySite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FtttSurveySite_projectId_idx" ON "FtttSurveySite"("projectId");
CREATE INDEX IF NOT EXISTS "FtttSurveySite_projectId_status_idx" ON "FtttSurveySite"("projectId", "status");
CREATE INDEX IF NOT EXISTS "FtttSurveyUpload_siteId_idx" ON "FtttSurveyUpload"("siteId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FtttSurveySite" ADD CONSTRAINT "FtttSurveySite_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FtttSurveyUpload" ADD CONSTRAINT "FtttSurveyUpload_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "FtttSurveySite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
