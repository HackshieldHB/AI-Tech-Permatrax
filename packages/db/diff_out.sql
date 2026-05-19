-- CreateEnum
CREATE TYPE "SurveyDataStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'REVISION_REQUIRED');

-- CreateEnum
CREATE TYPE "SipStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HldStatus" AS ENUM ('DRAFT', 'SUBMITTED_FOR_REVIEW', 'SUBMITTED_TO_ISP', 'ISP_REVISION_REQUIRED', 'ISP_APPROVED');

-- CreateEnum
CREATE TYPE "LldStatus" AS ENUM ('DRAFT', 'SUBMITTED_FOR_REVIEW', 'SUBMITTED_TO_ISP', 'ISP_REVISION_REQUIRED', 'ISP_APPROVED');

-- CreateEnum
CREATE TYPE "PrBrType" AS ENUM ('PR', 'BR');

-- CreateEnum
CREATE TYPE "PrBrStatus" AS ENUM ('DRAFT', 'ISSUED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PO', 'PKS', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEGOTIATION', 'SIGNED', 'ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SkomStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'COMPILING', 'SUBMITTED_FOR_REVIEW', 'REVISION_REQUIRED', 'APPROVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "PermitPhase_new" AS ENUM ('CLUSTER_INTAKE', 'VISIT_REQUEST', 'BA_OPEN', 'SITE_VISIT', 'SURVEY_INPUT', 'ROUTE_SURVEY', 'BA_SURVEY', 'SIP_REQUEST', 'HLD_SUBMISSION', 'LLD_SUBMISSION', 'PR_BR_ISSUANCE', 'CONTRACT_MANAGEMENT', 'SKOM_BUDGET', 'MANAGEMENT_APPROVAL', 'FUND_DISBURSEMENT', 'BAK_GENERATION', 'BAKP_COMPILATION', 'CLAIM_SUBMISSION', 'INVOICE_PACKAGE', 'PERMIT_DONE');
ALTER TABLE "PermitCluster" ALTER COLUMN "currentPhase" DROP DEFAULT;
ALTER TABLE "PermitCluster" ALTER COLUMN "currentPhase" TYPE "PermitPhase_new" USING ("currentPhase"::text::"PermitPhase_new");
ALTER TYPE "PermitPhase" RENAME TO "PermitPhase_old";
ALTER TYPE "PermitPhase_new" RENAME TO "PermitPhase";
DROP TYPE "PermitPhase_old";
ALTER TABLE "PermitCluster" ALTER COLUMN "currentPhase" SET DEFAULT 'SITE_VISIT';
COMMIT;

-- AlterTable
ALTER TABLE "PermitCluster" ALTER COLUMN "currentPhase" SET DEFAULT 'SITE_VISIT';

-- CreateTable
CREATE TABLE "SurveyData" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "conductedBy" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3),
    "rtName" TEXT,
    "rtPhone" TEXT,
    "rwName" TEXT,
    "rwPhone" TEXT,
    "pengelolaName" TEXT,
    "pengelolaPhone" TEXT,
    "stakeholderNotes" TEXT,
    "areaCondition" TEXT,
    "accessDifficulty" TEXT,
    "existingInfra" TEXT,
    "surveyNotes" TEXT,
    "evidencePhotos" TEXT[],
    "routeGeoJson" JSONB,
    "homepasCount" INTEGER,
    "homepasCoords" JSONB,
    "polePositions" JSONB,
    "routeNotes" TEXT,
    "routeDistanceM" DOUBLE PRECISION,
    "baSurveyNumber" TEXT,
    "baSurveyPdfUrl" TEXT,
    "status" "SurveyDataStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sip" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "ispCustomer" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "status" "SipStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfUrl" TEXT,
    "ispFeedback" TEXT,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hld" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "HldStatus" NOT NULL DEFAULT 'DRAFT',
    "kmzFileUrl" TEXT,
    "boqFileUrl" TEXT,
    "additionalFiles" TEXT[],
    "submittedAt" TIMESTAMP(3),
    "submittedToIsp" TIMESTAMP(3),
    "ispReviewedAt" TIMESTAMP(3),
    "ispApprovedAt" TIMESTAMP(3),
    "ispFeedback" TEXT,
    "rejectionReason" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hld_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HldRevision" (
    "id" TEXT NOT NULL,
    "hldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kmzFileUrl" TEXT,
    "boqFileUrl" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HldRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lld" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "LldStatus" NOT NULL DEFAULT 'DRAFT',
    "apdFileUrl" TEXT,
    "schematicFileUrl" TEXT,
    "coreConnectionUrl" TEXT,
    "additionalFiles" TEXT[],
    "submittedAt" TIMESTAMP(3),
    "submittedToIsp" TIMESTAMP(3),
    "ispReviewedAt" TIMESTAMP(3),
    "ispApprovedAt" TIMESTAMP(3),
    "ispFeedback" TEXT,
    "rejectionReason" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lld_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LldRevision" (
    "id" TEXT NOT NULL,
    "lldId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "apdFileUrl" TEXT,
    "schematicFileUrl" TEXT,
    "coreConnectionUrl" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LldRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrBrRecord" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "type" "PrBrType" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PrBrStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrBrRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractRecord" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "type" "ContractType" NOT NULL,
    "contractNumber" TEXT,
    "vendor" TEXT,
    "amount" DECIMAL(15,2),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "fileUrl" TEXT,
    "notes" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkomBudget" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "totalBudget" DECIMAL(15,2) NOT NULL,
    "rabFileUrl" TEXT,
    "timelineFileUrl" TEXT,
    "kurvaSFileUrl" TEXT,
    "kurvaSData" JSONB,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationDays" INTEGER,
    "status" "SkomStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "approvalNotes" TEXT,
    "disbursementSchedule" JSONB,
    "totalDisbursed" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkomBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementRecord" (
    "id" TEXT NOT NULL,
    "skomBudgetId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "executedDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "evidenceUrl" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisbursementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimPackage" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "hasBAOpen" BOOLEAN NOT NULL DEFAULT false,
    "hasBASurvey" BOOLEAN NOT NULL DEFAULT false,
    "hasSip" BOOLEAN NOT NULL DEFAULT false,
    "hasHld" BOOLEAN NOT NULL DEFAULT false,
    "hasLld" BOOLEAN NOT NULL DEFAULT false,
    "hasPrBr" BOOLEAN NOT NULL DEFAULT false,
    "hasContract" BOOLEAN NOT NULL DEFAULT false,
    "hasSkomBudget" BOOLEAN NOT NULL DEFAULT false,
    "hasBAK" BOOLEAN NOT NULL DEFAULT false,
    "hasBAKP" BOOLEAN NOT NULL DEFAULT false,
    "ispDocumentUrls" TEXT[],
    "govDocumentUrls" TEXT[],
    "compiledPackageUrl" TEXT,
    "compiledAt" TIMESTAMP(3),
    "compiledBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "revisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePackage" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoicePdfUrl" TEXT,
    "supportingDocs" TEXT[],
    "submittedToFinanceAt" TIMESTAMP(3),
    "reviewedByFinanceAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "paymentEvidenceUrl" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "lastFollowUpAt" TIMESTAMP(3),
    "notes" TEXT,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurveyData_permitClusterId_key" ON "SurveyData"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Sip_permitClusterId_key" ON "Sip"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Sip_documentNumber_key" ON "Sip"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Hld_permitClusterId_key" ON "Hld"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Lld_permitClusterId_key" ON "Lld"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "PrBrRecord_documentNumber_key" ON "PrBrRecord"("documentNumber");

-- CreateIndex
CREATE INDEX "PrBrRecord_permitClusterId_idx" ON "PrBrRecord"("permitClusterId");

-- CreateIndex
CREATE INDEX "PrBrRecord_type_idx" ON "PrBrRecord"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRecord_contractNumber_key" ON "ContractRecord"("contractNumber");

-- CreateIndex
CREATE INDEX "ContractRecord_permitClusterId_idx" ON "ContractRecord"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "SkomBudget_permitClusterId_key" ON "SkomBudget"("permitClusterId");

-- CreateIndex
CREATE INDEX "DisbursementRecord_skomBudgetId_idx" ON "DisbursementRecord"("skomBudgetId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimPackage_permitClusterId_key" ON "ClaimPackage"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimPackage_documentNumber_key" ON "ClaimPackage"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePackage_permitClusterId_key" ON "InvoicePackage"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePackage_invoiceNumber_key" ON "InvoicePackage"("invoiceNumber");

-- AddForeignKey
ALTER TABLE "SurveyData" ADD CONSTRAINT "SurveyData_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyData" ADD CONSTRAINT "SurveyData_conductedBy_fkey" FOREIGN KEY ("conductedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sip" ADD CONSTRAINT "Sip_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sip" ADD CONSTRAINT "Sip_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hld" ADD CONSTRAINT "Hld_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hld" ADD CONSTRAINT "Hld_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HldRevision" ADD CONSTRAINT "HldRevision_hldId_fkey" FOREIGN KEY ("hldId") REFERENCES "Hld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HldRevision" ADD CONSTRAINT "HldRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lld" ADD CONSTRAINT "Lld_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lld" ADD CONSTRAINT "Lld_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LldRevision" ADD CONSTRAINT "LldRevision_lldId_fkey" FOREIGN KEY ("lldId") REFERENCES "Lld"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LldRevision" ADD CONSTRAINT "LldRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrBrRecord" ADD CONSTRAINT "PrBrRecord_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrBrRecord" ADD CONSTRAINT "PrBrRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRecord" ADD CONSTRAINT "ContractRecord_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRecord" ADD CONSTRAINT "ContractRecord_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkomBudget" ADD CONSTRAINT "SkomBudget_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkomBudget" ADD CONSTRAINT "SkomBudget_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkomBudget" ADD CONSTRAINT "SkomBudget_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementRecord" ADD CONSTRAINT "DisbursementRecord_skomBudgetId_fkey" FOREIGN KEY ("skomBudgetId") REFERENCES "SkomBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementRecord" ADD CONSTRAINT "DisbursementRecord_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimPackage" ADD CONSTRAINT "ClaimPackage_compiledBy_fkey" FOREIGN KEY ("compiledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimPackage" ADD CONSTRAINT "ClaimPackage_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePackage" ADD CONSTRAINT "InvoicePackage_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePackage" ADD CONSTRAINT "InvoicePackage_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
