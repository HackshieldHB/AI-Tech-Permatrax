-- Add rejectionNotes to FtttDocument (mandatory reason when PM/Admin rejects)
ALTER TABLE "FtttDocument" ADD COLUMN IF NOT EXISTS "rejectionNotes" TEXT;

-- Create FtttReconDoc table for Reconciliation & Billing phase documents
CREATE TABLE "FtttReconDoc" (
    "id"                TEXT NOT NULL,
    "projectId"         TEXT NOT NULL,
    "docKey"            TEXT NOT NULL,
    "fileUrl"           TEXT,
    "notes"             TEXT,
    "approvalStatus"    "FtttApprovalStatus" NOT NULL DEFAULT 'PENDING_PM',
    "uploadedById"      TEXT NOT NULL,
    "pmApprovedById"    TEXT,
    "pmApprovedAt"      TIMESTAMP(3),
    "adminApprovedById" TEXT,
    "adminApprovedAt"   TIMESTAMP(3),
    "rejectionNotes"    TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttReconDoc_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FtttReconDoc"
    ADD CONSTRAINT "FtttReconDoc_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "FtttProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FtttReconDoc"
    ADD CONSTRAINT "FtttReconDoc_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FtttReconDoc_projectId_docKey_key" ON "FtttReconDoc"("projectId", "docKey");
CREATE INDEX "FtttReconDoc_projectId_idx" ON "FtttReconDoc"("projectId");
