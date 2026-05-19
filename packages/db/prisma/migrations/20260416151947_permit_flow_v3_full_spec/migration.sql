/*
  Warnings:

  - The values [SUBMITTED,NEGOTIATION,SIGNED] on the enum `ContractStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [SUBMITTED_TO_ISP,ISP_REVISION_REQUIRED] on the enum `HldStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [SUBMITTED_TO_ISP,ISP_REVISION_REQUIRED] on the enum `LldStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "DocPackageStatus" AS ENUM ('ASSEMBLING', 'SUBMITTED', 'PM_REVIEWING', 'PM_REJECTED', 'PM_APPROVED', 'ADMIN_REVIEWING', 'ADMIN_REJECTED', 'ADMIN_APPROVED');

-- AlterEnum
BEGIN;
CREATE TYPE "ContractStatus_new" AS ENUM ('DRAFT', 'PENDING_OPS_MANAGER', 'PENDING_GM', 'APPROVED', 'REJECTED', 'ACTIVE', 'COMPLETED', 'TERMINATED');
ALTER TABLE "ContractRecord" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ContractRecord" ALTER COLUMN "status" TYPE "ContractStatus_new" USING ("status"::text::"ContractStatus_new");
ALTER TYPE "ContractStatus" RENAME TO "ContractStatus_old";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";
DROP TYPE "ContractStatus_old";
ALTER TABLE "ContractRecord" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "HldStatus_new" AS ENUM ('DRAFT', 'SUBMITTED_FOR_REVIEW', 'PM_APPROVED', 'PM_REJECTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED');
ALTER TABLE "Hld" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Hld" ALTER COLUMN "status" TYPE "HldStatus_new" USING ("status"::text::"HldStatus_new");
ALTER TYPE "HldStatus" RENAME TO "HldStatus_old";
ALTER TYPE "HldStatus_new" RENAME TO "HldStatus";
DROP TYPE "HldStatus_old";
ALTER TABLE "Hld" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "LldStatus_new" AS ENUM ('DRAFT', 'SUBMITTED_FOR_REVIEW', 'PM_APPROVED', 'PM_REJECTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'PENDING_ISP', 'ISP_REVISION', 'ISP_APPROVED');
ALTER TABLE "Lld" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lld" ALTER COLUMN "status" TYPE "LldStatus_new" USING ("status"::text::"LldStatus_new");
ALTER TYPE "LldStatus" RENAME TO "LldStatus_old";
ALTER TYPE "LldStatus_new" RENAME TO "LldStatus";
DROP TYPE "LldStatus_old";
ALTER TABLE "Lld" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "BaOpen" ADD COLUMN     "description" TEXT,
ADD COLUMN     "tanggal" TIMESTAMP(3),
ADD COLUMN     "tempat" TEXT,
ADD COLUMN     "topik" TEXT;

-- AlterTable
ALTER TABLE "Bakp" ADD COLUMN     "adminBakpApprovedAt" TIMESTAMP(3),
ADD COLUMN     "adminBakpApprovedBy" TEXT,
ADD COLUMN     "fieldTeamSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "fieldTeamSubmittedBy" TEXT,
ADD COLUMN     "pmBakpApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmBakpApprovedBy" TEXT,
ADD COLUMN     "requiresMaterai" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stempelUrl" TEXT;

-- AlterTable
ALTER TABLE "ClaimPackage" ADD COLUMN     "check1DoneAt" TIMESTAMP(3),
ADD COLUMN     "check1FailedDocs" TEXT[],
ADD COLUMN     "check1Status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "check2Notes" TEXT,
ADD COLUMN     "check2ReviewedAt" TIMESTAMP(3),
ADD COLUMN     "check2ReviewedBy" TEXT,
ADD COLUMN     "check2Status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "docBaAcara" TEXT,
ADD COLUMN     "docBaOpen" TEXT,
ADD COLUMN     "docBaOpenLengkap" TEXT,
ADD COLUMN     "docBaTtdRt" TEXT,
ADD COLUMN     "docBuktiTrf" TEXT,
ADD COLUMN     "docEvidancePayment" TEXT,
ADD COLUMN     "docEvidancePaymentGov" TEXT,
ADD COLUMN     "docFcBukuTabungan" TEXT,
ADD COLUMN     "docFotoEvidance" TEXT,
ADD COLUMN     "docKtpRtRw" TEXT,
ADD COLUMN     "docKwitansi" TEXT,
ADD COLUMN     "docKwitansiGov" TEXT,
ADD COLUMN     "docMom" TEXT,
ADD COLUMN     "docPks" TEXT,
ADD COLUMN     "docPoSpk" TEXT,
ADD COLUMN     "docPoSpkGov" TEXT,
ADD COLUMN     "docSip" TEXT,
ADD COLUMN     "docSkInternal" TEXT,
ADD COLUMN     "docSkInternalGov" TEXT,
ADD COLUMN     "submittedToIspAt" TIMESTAMP(3),
ADD COLUMN     "submittedToIspBy" TEXT;

-- AlterTable
ALTER TABLE "ContractRecord" ADD COLUMN     "gmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "gmApprovedBy" TEXT,
ADD COLUMN     "opsApprovedAt" TIMESTAMP(3),
ADD COLUMN     "opsApprovedBy" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "rejectionNotes" TEXT;

-- AlterTable
ALTER TABLE "Hld" ADD COLUMN     "adminApprovedAt" TIMESTAMP(3),
ADD COLUMN     "adminApprovedBy" TEXT,
ADD COLUMN     "pmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmApprovedBy" TEXT,
ADD COLUMN     "slaDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Lld" ADD COLUMN     "adminApprovedAt" TIMESTAMP(3),
ADD COLUMN     "adminApprovedBy" TEXT,
ADD COLUMN     "pmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmApprovedBy" TEXT,
ADD COLUMN     "slaDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sip" ADD COLUMN     "alamat" TEXT,
ADD COLUMN     "boundaryKmzUrl" TEXT,
ADD COLUMN     "branch" TEXT,
ADD COLUMN     "classing" TEXT,
ADD COLUMN     "coordinates" TEXT,
ADD COLUMN     "existingCompetitors" TEXT,
ADD COLUMN     "homepasCount" INTEGER,
ADD COLUMN     "kecamatan" TEXT,
ADD COLUMN     "kelurahan" TEXT,
ADD COLUMN     "kota" TEXT,
ADD COLUMN     "occupancyPercent" DOUBLE PRECISION,
ADD COLUMN     "picCbn" TEXT,
ADD COLUMN     "picFs" TEXT,
ADD COLUMN     "picKawasan" TEXT,
ADD COLUMN     "provinsi" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "requestBy" TEXT,
ADD COLUMN     "residenceType" TEXT,
ADD COLUMN     "siteName" TEXT,
ADD COLUMN     "workMethod" TEXT;

-- CreateTable
CREATE TABLE "BakpParticipant" (
    "id" TEXT NOT NULL,
    "bakpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ktpNumber" TEXT,
    "ktpPhotoUrl" TEXT,
    "signatureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BakpParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyorDocPackage" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "hasBaOpen" BOOLEAN NOT NULL DEFAULT false,
    "hasSurveyData" BOOLEAN NOT NULL DEFAULT false,
    "hasEvidencePhotos" BOOLEAN NOT NULL DEFAULT false,
    "hasRouteData" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocPackageStatus" NOT NULL DEFAULT 'ASSEMBLING',
    "pmReviewedBy" TEXT,
    "pmReviewedAt" TIMESTAMP(3),
    "pmNotes" TEXT,
    "adminReviewedBy" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyorDocPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IspEmailConfig" (
    "id" TEXT NOT NULL,
    "ispName" TEXT NOT NULL,
    "emailTo" TEXT[],
    "emailCc" TEXT[],
    "emailBcc" TEXT[],
    "smtpNotes" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IspEmailConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyEvidence" (
    "id" TEXT NOT NULL,
    "surveyDataId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "SurveyEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurveyorDocPackage_permitClusterId_key" ON "SurveyorDocPackage"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "IspEmailConfig_ispName_key" ON "IspEmailConfig"("ispName");

-- CreateIndex
CREATE INDEX "SurveyEvidence_surveyDataId_idx" ON "SurveyEvidence"("surveyDataId");

-- AddForeignKey
ALTER TABLE "BakpParticipant" ADD CONSTRAINT "BakpParticipant_bakpId_fkey" FOREIGN KEY ("bakpId") REFERENCES "Bakp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyorDocPackage" ADD CONSTRAINT "SurveyorDocPackage_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyorDocPackage" ADD CONSTRAINT "SurveyorDocPackage_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyorDocPackage" ADD CONSTRAINT "SurveyorDocPackage_pmReviewedBy_fkey" FOREIGN KEY ("pmReviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyorDocPackage" ADD CONSTRAINT "SurveyorDocPackage_adminReviewedBy_fkey" FOREIGN KEY ("adminReviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IspEmailConfig" ADD CONSTRAINT "IspEmailConfig_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyEvidence" ADD CONSTRAINT "SurveyEvidence_surveyDataId_fkey" FOREIGN KEY ("surveyDataId") REFERENCES "SurveyData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyEvidence" ADD CONSTRAINT "SurveyEvidence_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
