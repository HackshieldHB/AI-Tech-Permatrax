/*
  Migration 1 of 2: Add enum values, create tables, drop constraints
  
  NOTE: SET DEFAULT statements that use new enum values are in the NEXT migration
  because PostgreSQL requires enum values to be committed before use.
*/

-- CreateEnum
CREATE TYPE "StageProgressStatus" AS ENUM ('LOCKED', 'ACTIVE', 'DONE', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JaminanType" AS ENUM ('UANG_MUKA', 'PELAKSANAAN', 'PEMELIHARAAN');

-- CreateEnum
CREATE TYPE "McvStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MCV_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum: Add new values to existing enums
ALTER TYPE "CashOpStatus" ADD VALUE IF NOT EXISTS 'REALISASI_PENDING_MARKETING_HEAD';
ALTER TYPE "CashOpStatus" ADD VALUE IF NOT EXISTS 'REALISASI_REJECTED_BY_MARKETING_HEAD';
ALTER TYPE "HldStatus" ADD VALUE IF NOT EXISTS 'WAITING_INPUT';
ALTER TYPE "LldStatus" ADD VALUE IF NOT EXISTS 'WAITING_INPUT';

-- DropForeignKey
ALTER TABLE "Hld" DROP CONSTRAINT IF EXISTS "Hld_adminApprovedBy_fkey";
ALTER TABLE "Hld" DROP CONSTRAINT IF EXISTS "Hld_pmApprovedBy_fkey";
ALTER TABLE "Lld" DROP CONSTRAINT IF EXISTS "Lld_adminApprovedBy_fkey";
ALTER TABLE "Lld" DROP CONSTRAINT IF EXISTS "Lld_pmApprovedBy_fkey";
ALTER TABLE "PermitCluster" DROP CONSTRAINT IF EXISTS "PermitCluster_baOpenId_fkey";

-- AlterTable: Data type changes (no new enum defaults here)
-- NOTE: Use ADD COLUMN IF NOT EXISTS for columns that might not exist in fresh DB
ALTER TABLE "CashOperationRequest" ALTER COLUMN "financeNominalDisetujui" SET DATA TYPE DECIMAL(65,30);
ALTER TABLE "NetworkDesign" DROP COLUMN IF EXISTS "sketchTopology";
ALTER TABLE "NetworkDesign" ADD COLUMN IF NOT EXISTS "sketchTopology" JSONB DEFAULT '{}';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ppnType" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ppnValue" DECIMAL(15,2);
ALTER TABLE "PermitCluster" ALTER COLUMN "baOpenId" DROP NOT NULL;
-- NOTE: Hld.status and Lld.status defaults are set in the NEXT migration

-- CreateTable
CREATE TABLE "PipelineTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiberType" "FiberType" NOT NULL,
    "ispCustomerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL,
    "color" TEXT,
    "triggerConditions" JSONB,
    "autoAdvance" BOOLEAN NOT NULL DEFAULT false,
    "notifyRoles" TEXT[],
    "allowedActorRoles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageDocument" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "formats" TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StageDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterStageProgress" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "status" "StageProgressStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,
    "metricValue" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterStageProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageDocumentUpload" (
    "id" TEXT NOT NULL,
    "stageDocumentId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageDocumentUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmileProgress" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "progressPct" DECIMAL(5,2) NOT NULL,
    "evidenceUrl" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmileProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jaminan" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "type" "JaminanType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Jaminan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amandemen" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentUrl" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Amandemen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McvClaim" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "termNumber" INTEGER NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" "McvStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McvClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McvDocument" (
    "id" TEXT NOT NULL,
    "mcvId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McvDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BastTimer" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "bast1IssuedAt" TIMESTAMP(3),
    "bast2EligibleAt" TIMESTAMP(3),
    "bast2IssuedAt" TIMESTAMP(3),
    "bast2Locked" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BastTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceProjectPlanning" (
    "id" TEXT NOT NULL,
    "financeProjectId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "plannedAmount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceProjectPlanning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineTemplate_fiberType_ispCustomerId_version_key" ON "PipelineTemplate"("fiberType", "ispCustomerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_templateId_sequence_key" ON "PipelineStage"("templateId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterStageProgress_clusterId_stageId_key" ON "ClusterStageProgress"("clusterId", "stageId");

-- CreateIndex
CREATE UNIQUE INDEX "Amandemen_clusterId_version_key" ON "Amandemen"("clusterId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "McvClaim_clusterId_termNumber_key" ON "McvClaim"("clusterId", "termNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BastTimer_clusterId_key" ON "BastTimer"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceProjectPlanning_financeProjectId_month_year_key" ON "FinanceProjectPlanning"("financeProjectId", "month", "year");

-- CreateIndex
CREATE INDEX "PermitCluster_pipelineTemplateId_idx" ON "PermitCluster"("pipelineTemplateId");

-- AddForeignKey
ALTER TABLE "PermitCluster" ADD CONSTRAINT "PermitCluster_baOpenId_fkey" FOREIGN KEY ("baOpenId") REFERENCES "BaOpen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitCluster" ADD CONSTRAINT "PermitCluster_pipelineTemplateId_fkey" FOREIGN KEY ("pipelineTemplateId") REFERENCES "PipelineTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineTemplate" ADD CONSTRAINT "PipelineTemplate_ispCustomerId_fkey" FOREIGN KEY ("ispCustomerId") REFERENCES "IspCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PipelineTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageDocument" ADD CONSTRAINT "StageDocument_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterStageProgress" ADD CONSTRAINT "ClusterStageProgress_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterStageProgress" ADD CONSTRAINT "ClusterStageProgress_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageDocumentUpload" ADD CONSTRAINT "StageDocumentUpload_stageDocumentId_fkey" FOREIGN KEY ("stageDocumentId") REFERENCES "StageDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageDocumentUpload" ADD CONSTRAINT "StageDocumentUpload_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmileProgress" ADD CONSTRAINT "SmileProgress_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jaminan" ADD CONSTRAINT "Jaminan_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amandemen" ADD CONSTRAINT "Amandemen_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McvClaim" ADD CONSTRAINT "McvClaim_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McvDocument" ADD CONSTRAINT "McvDocument_mcvId_fkey" FOREIGN KEY ("mcvId") REFERENCES "McvClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BastTimer" ADD CONSTRAINT "BastTimer_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceProjectPlanning" ADD CONSTRAINT "FinanceProjectPlanning_financeProjectId_fkey" FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
