-- CreateEnum: FtttClosingLogType
CREATE TYPE "FtttClosingLogType" AS ENUM ('BAST_II', 'EVIDENCE', 'NOTE');

-- CreateTable: FtttClosingLog
CREATE TABLE "FtttClosingLog" (
    "id"              TEXT NOT NULL,
    "projectId"       TEXT NOT NULL,
    "logType"         "FtttClosingLogType" NOT NULL,
    "fileUrl"         TEXT,
    "caption"         TEXT,
    "notes"           TEXT,
    "approvalStatus"  "FtttApprovalStatus",
    "rejectionNotes"  TEXT,
    "uploadedById"    TEXT NOT NULL,
    "pmApprovedById"  TEXT,
    "pmApprovedAt"    TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttClosingLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FtttClosingLog"
    ADD CONSTRAINT "FtttClosingLog_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "FtttProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FtttClosingLog"
    ADD CONSTRAINT "FtttClosingLog_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FtttClosingLog_projectId_idx" ON "FtttClosingLog"("projectId");
