-- Add BACT to FtttDocumentType enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'BACT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN
    ALTER TYPE "FtttDocumentType" ADD VALUE 'BACT';
  END IF;
END;
$$;

-- Create FtttSpanLogCategory enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FtttSpanLogCategory') THEN
    CREATE TYPE "FtttSpanLogCategory" AS ENUM (
      'GALIAN', 'VIDEO_GALIAN', 'PERBAIKAN', 'HANDHOLE',
      'JEMBATAN', 'JOIN_TERMINASI', 'MARKING_POS'
    );
  END IF;
END;
$$;

-- Create FtttSpan table (Telkom Infra span-based daily implementation log)
CREATE TABLE IF NOT EXISTS "FtttSpan" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "projectId"   TEXT NOT NULL,
  "spanNumber"  TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttSpan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FtttSpan_projectId_spanNumber_key" UNIQUE ("projectId", "spanNumber"),
  CONSTRAINT "FtttSpan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FtttSpan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FtttSpan_projectId_idx" ON "FtttSpan"("projectId");

-- Create FtttSpanLog table
CREATE TABLE IF NOT EXISTS "FtttSpanLog" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "spanId"       TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "category"     "FtttSpanLogCategory" NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "caption"      TEXT,
  "uploadedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttSpanLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FtttSpanLog_spanId_fkey" FOREIGN KEY ("spanId") REFERENCES "FtttSpan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FtttSpanLog_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "FtttSpanLog_spanId_idx" ON "FtttSpanLog"("spanId");
CREATE INDEX IF NOT EXISTS "FtttSpanLog_projectId_idx" ON "FtttSpanLog"("projectId");
