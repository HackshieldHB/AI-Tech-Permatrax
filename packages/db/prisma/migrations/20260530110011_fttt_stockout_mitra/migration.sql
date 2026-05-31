-- Migration: FTTT project flow + StockOut approval flow + Mitra field on StockItem
-- Applied via db push; this file documents the changes for prisma migrate deploy.

-- ─── 1. StockItem: add mitra field ─────────────────────────────────────────
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "mitra" TEXT NOT NULL DEFAULT 'Lainnya';
CREATE INDEX IF NOT EXISTS "StockItem_mitra_idx" ON "StockItem"("mitra");

-- ─── 2. StockOut: new approval flow fields ──────────────────────────────────
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "recipient"              TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "doNumber"               TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "adminStockApprovedById" TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "adminStockApprovedAt"   TIMESTAMP(3);
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "pmConfirmedById"        TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "pmConfirmedAt"          TIMESTAMP(3);
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "financeApprovedById"    TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "financeApprovedAt"      TIMESTAMP(3);
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "revisionNotes"          TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "suratJalanId"           TEXT;

-- StockOut new status enum values
DO $$ BEGIN
  ALTER TYPE "StockOutStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
  ALTER TYPE "StockOutStatus" ADD VALUE IF NOT EXISTS 'PENDING_PM_CONFIRM';
  ALTER TYPE "StockOutStatus" ADD VALUE IF NOT EXISTS 'PENDING_FINANCE';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- SuratJalan: back-relation for StockOut
ALTER TABLE "SuratJalan" ADD COLUMN IF NOT EXISTS "stockOutId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SuratJalan_stockOutId_key" ON "SuratJalan"("stockOutId");

-- Foreign keys for StockOut approvers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StockOut_adminStockApprovedById_fkey'
  ) THEN
    ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_adminStockApprovedById_fkey"
      FOREIGN KEY ("adminStockApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StockOut_pmConfirmedById_fkey'
  ) THEN
    ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_pmConfirmedById_fkey"
      FOREIGN KEY ("pmConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StockOut_financeApprovedById_fkey'
  ) THEN
    ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_financeApprovedById_fkey"
      FOREIGN KEY ("financeApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── 3. FTTT enums ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "FtttCompany" AS ENUM ('TELKOM_INFRA', 'IFORTE', 'PST');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttPhase" AS ENUM (
    'INITIATION', 'SURVEY', 'PREPARATION', 'IMPLEMENTATION',
    'DOCUMENTATION', 'RECONCILIATION', 'CLOSING'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttPhaseStatus" AS ENUM ('LOCKED', 'ACTIVE', 'COMPLETED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttDocType" AS ENUM ('PO_CONTRACT', 'SITELIST', 'BOQ_TOS');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttSanggahStatus" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttJaminanType" AS ENUM ('JAMINAN_UANG_MUKA', 'JAMINAN_PELAKSANAAN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttDocumentType" AS ENUM ('ATP', 'BAUT', 'SUPPORTING', 'EVIDENCE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FtttApprovalStatus" AS ENUM ('PENDING_PM', 'PENDING_ADMIN', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── 4. FTTT tables ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FtttProject" (
  "id"             TEXT NOT NULL,
  "cleanListId"    TEXT,
  "ftttCompany"    "FtttCompany" NOT NULL,
  "triggerDocUrl"  TEXT NOT NULL,
  "triggerDocType" "FtttDocType" NOT NULL,
  "currentPhase"   "FtttPhase" NOT NULL DEFAULT 'INITIATION',
  "status"         "FtttProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "pmId"           TEXT NOT NULL,
  "projectName"    TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttPhaseProgress" (
  "id"            TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "phase"         "FtttPhase" NOT NULL,
  "status"        "FtttPhaseStatus" NOT NULL DEFAULT 'LOCKED',
  "unlockedAt"    TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "completedById" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttPhaseProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttSurveyUpload" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "fileUrl"      TEXT NOT NULL,
  "fileType"     TEXT NOT NULL,
  "caption"      TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttSurveyUpload_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttDrmDocument" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "docType"      TEXT NOT NULL,
  "version"      INTEGER NOT NULL DEFAULT 1,
  "fileUrl"      TEXT NOT NULL,
  "notes"        TEXT,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttDrmDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttSanggah" (
  "id"            TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "reason"        TEXT NOT NULL,
  "fileUrl"       TEXT,
  "status"        "FtttSanggahStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submittedById" TEXT NOT NULL,
  "submittedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"    TIMESTAMP(3),
  "resolvedById"  TEXT,
  "responseNotes" TEXT,
  CONSTRAINT "FtttSanggah_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttJaminan" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "jaminanType"  "FtttJaminanType" NOT NULL,
  "amount"       DECIMAL(15,2),
  "issuer"       TEXT,
  "issueDate"    TIMESTAMP(3),
  "expiryDate"   TIMESTAMP(3),
  "fileUrl"      TEXT,
  "notes"        TEXT,
  "uploadedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttJaminan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FtttDocument" (
  "id"                TEXT NOT NULL,
  "projectId"         TEXT NOT NULL,
  "docType"           "FtttDocumentType" NOT NULL,
  "fileUrl"           TEXT NOT NULL,
  "notes"             TEXT,
  "approvalStatus"    "FtttApprovalStatus" NOT NULL DEFAULT 'PENDING_PM',
  "uploadedById"      TEXT NOT NULL,
  "pmApprovedById"    TEXT,
  "pmApprovedAt"      TIMESTAMP(3),
  "adminApprovedById" TEXT,
  "adminApprovedAt"   TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttDocument_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "FtttPhaseProgress_projectId_phase_key" ON "FtttPhaseProgress"("projectId", "phase");
CREATE UNIQUE INDEX IF NOT EXISTS "FtttSanggah_projectId_attemptNumber_key" ON "FtttSanggah"("projectId", "attemptNumber");

-- Indexes
CREATE INDEX IF NOT EXISTS "FtttProject_ftttCompany_idx" ON "FtttProject"("ftttCompany");
CREATE INDEX IF NOT EXISTS "FtttProject_currentPhase_idx" ON "FtttProject"("currentPhase");
CREATE INDEX IF NOT EXISTS "FtttProject_pmId_idx" ON "FtttProject"("pmId");
CREATE INDEX IF NOT EXISTS "FtttProject_status_idx" ON "FtttProject"("status");
CREATE INDEX IF NOT EXISTS "FtttSurveyUpload_projectId_idx" ON "FtttSurveyUpload"("projectId");
CREATE INDEX IF NOT EXISTS "FtttDrmDocument_projectId_docType_idx" ON "FtttDrmDocument"("projectId", "docType");
CREATE INDEX IF NOT EXISTS "FtttSanggah_projectId_idx" ON "FtttSanggah"("projectId");
CREATE INDEX IF NOT EXISTS "FtttJaminan_projectId_idx" ON "FtttJaminan"("projectId");
CREATE INDEX IF NOT EXISTS "FtttDocument_projectId_idx" ON "FtttDocument"("projectId");

-- Foreign keys for FTTT tables
ALTER TABLE "FtttProject"      ADD CONSTRAINT "FtttProject_pmId_fkey"              FOREIGN KEY ("pmId")           REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttProject"      ADD CONSTRAINT "FtttProject_cleanListId_fkey"        FOREIGN KEY ("cleanListId")    REFERENCES "CleanList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FtttPhaseProgress" ADD CONSTRAINT "FtttPhaseProgress_projectId_fkey"  FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttSurveyUpload" ADD CONSTRAINT "FtttSurveyUpload_projectId_fkey"    FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttSurveyUpload" ADD CONSTRAINT "FtttSurveyUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById")   REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttDrmDocument"  ADD CONSTRAINT "FtttDrmDocument_projectId_fkey"     FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttDrmDocument"  ADD CONSTRAINT "FtttDrmDocument_uploadedById_fkey"  FOREIGN KEY ("uploadedById")   REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttSanggah"      ADD CONSTRAINT "FtttSanggah_projectId_fkey"         FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttSanggah"      ADD CONSTRAINT "FtttSanggah_submittedById_fkey"     FOREIGN KEY ("submittedById")  REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttJaminan"      ADD CONSTRAINT "FtttJaminan_projectId_fkey"         FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttJaminan"      ADD CONSTRAINT "FtttJaminan_uploadedById_fkey"      FOREIGN KEY ("uploadedById")   REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttDocument"     ADD CONSTRAINT "FtttDocument_projectId_fkey"        FOREIGN KEY ("projectId")      REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttDocument"     ADD CONSTRAINT "FtttDocument_uploadedById_fkey"     FOREIGN KEY ("uploadedById")   REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
