-- AlterTable
ALTER TABLE "CleanList" ADD COLUMN     "actualHP" INTEGER,
ADD COLUMN     "coordinates" TEXT,
ADD COLUMN     "externalCode" TEXT,
ADD COLUMN     "hpHldApproved" INTEGER,
ADD COLUMN     "implStatus" TEXT,
ADD COLUMN     "lastUpdate" TIMESTAMP(3),
ADD COLUMN     "permitStatus" TEXT,
ADD COLUMN     "picPermit" TEXT,
ADD COLUMN     "projectType" TEXT,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "siteName" TEXT,
ADD COLUMN     "sourceSheet" TEXT;
