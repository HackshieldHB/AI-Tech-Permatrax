-- Stable v2: Transaction Log createdPhase + multi Bukti Transfer files

-- Phase where Financial Request was created (legacy rows = IMPLEMENTATION)
ALTER TABLE "FtttTransaction" ADD COLUMN IF NOT EXISTS "createdPhase" "FtttPhase" NOT NULL DEFAULT 'IMPLEMENTATION';
CREATE INDEX IF NOT EXISTS "FtttTransaction_createdPhase_idx" ON "FtttTransaction"("createdPhase");

CREATE TABLE IF NOT EXISTS "FtttTransactionTransferProof" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "originalFileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttTransactionTransferProof_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FtttTransactionTransferProof_transactionId_idx" ON "FtttTransactionTransferProof"("transactionId");

DO $$ BEGIN
  ALTER TABLE "FtttTransactionTransferProof" ADD CONSTRAINT "FtttTransactionTransferProof_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FtttTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FtttTransactionTransferProof" ADD CONSTRAINT "FtttTransactionTransferProof_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill legacy single transferProofUrl into child rows
INSERT INTO "FtttTransactionTransferProof" ("id", "transactionId", "fileUrl", "originalFileName", "uploadedById", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text),
  t."id",
  t."transferProofUrl",
  NULL,
  COALESCE(t."disbursedById", t."createdById"),
  COALESCE(t."disbursedAt", t."createdAt")
FROM "FtttTransaction" t
WHERE t."transferProofUrl" IS NOT NULL
  AND t."transferProofUrl" <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "FtttTransactionTransferProof" p WHERE p."transactionId" = t."id"
  );
