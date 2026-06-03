-- CreateEnum: FtttImplLogType for Implementation phase logging
CREATE TYPE "FtttImplLogType" AS ENUM ('PHOTO', 'MONITORING_DOC', 'NOTE');

-- CreateTable: FtttImplementationLog
CREATE TABLE "FtttImplementationLog" (
    "id"           TEXT NOT NULL,
    "projectId"    TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "logType"      "FtttImplLogType" NOT NULL,
    "fileUrl"      TEXT,
    "caption"      TEXT,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttImplementationLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: project
ALTER TABLE "FtttImplementationLog"
    ADD CONSTRAINT "FtttImplementationLog_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "FtttProject"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: uploader
ALTER TABLE "FtttImplementationLog"
    ADD CONSTRAINT "FtttImplementationLog_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "FtttImplementationLog_projectId_idx" ON "FtttImplementationLog"("projectId");
