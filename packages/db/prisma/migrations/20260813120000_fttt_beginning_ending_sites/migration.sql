-- FTTT Site Initiation: Beginning Site → Ending Site relationships (reusable Finance Sites)

CREATE TYPE "FtttBeginningStatus" AS ENUM ('DRAFT', 'COMPLETED');

CREATE TABLE "FtttBeginningGroup" (
    "id" TEXT NOT NULL,
    "bulkyProjectId" TEXT NOT NULL,
    "beginningFinanceSiteId" TEXT NOT NULL,
    "status" "FtttBeginningStatus" NOT NULL DEFAULT 'DRAFT',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FtttBeginningGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FtttSiteEnding" (
    "id" TEXT NOT NULL,
    "beginningGroupId" TEXT NOT NULL,
    "endingFinanceSiteId" TEXT NOT NULL,
    "ftttProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttSiteEnding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FtttBeginningGroup_bulkyProjectId_idx" ON "FtttBeginningGroup"("bulkyProjectId");
CREATE INDEX "FtttBeginningGroup_beginningFinanceSiteId_idx" ON "FtttBeginningGroup"("beginningFinanceSiteId");
CREATE INDEX "FtttBeginningGroup_status_idx" ON "FtttBeginningGroup"("status");

CREATE UNIQUE INDEX "FtttSiteEnding_beginningGroupId_endingFinanceSiteId_key" ON "FtttSiteEnding"("beginningGroupId", "endingFinanceSiteId");
CREATE INDEX "FtttSiteEnding_endingFinanceSiteId_idx" ON "FtttSiteEnding"("endingFinanceSiteId");
CREATE INDEX "FtttSiteEnding_ftttProjectId_idx" ON "FtttSiteEnding"("ftttProjectId");

ALTER TABLE "FtttBeginningGroup" ADD CONSTRAINT "FtttBeginningGroup_bulkyProjectId_fkey" FOREIGN KEY ("bulkyProjectId") REFERENCES "FtttProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttBeginningGroup" ADD CONSTRAINT "FtttBeginningGroup_beginningFinanceSiteId_fkey" FOREIGN KEY ("beginningFinanceSiteId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttBeginningGroup" ADD CONSTRAINT "FtttBeginningGroup_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FtttSiteEnding" ADD CONSTRAINT "FtttSiteEnding_beginningGroupId_fkey" FOREIGN KEY ("beginningGroupId") REFERENCES "FtttBeginningGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FtttSiteEnding" ADD CONSTRAINT "FtttSiteEnding_endingFinanceSiteId_fkey" FOREIGN KEY ("endingFinanceSiteId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FtttSiteEnding" ADD CONSTRAINT "FtttSiteEnding_ftttProjectId_fkey" FOREIGN KEY ("ftttProjectId") REFERENCES "FtttProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
