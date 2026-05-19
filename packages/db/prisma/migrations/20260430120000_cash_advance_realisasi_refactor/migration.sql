-- Cash Advance realisasi refactor (M1): additive only — no drops, no visit-request changes.

-- CreateEnum
CREATE TYPE "RealisasiStatus" AS ENUM ('DRAFT', 'PENDING_FINANCE_REVIEW', 'PENDING_GM_REVIEW', 'REJECTED', 'DONE');

-- AlterEnum CashOpStatus (PostgreSQL 12+: multiple ADD VALUE in one migration is OK)
ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_IN_PROGRESS';
ALTER TYPE "CashOpStatus" ADD VALUE 'DONE';

-- AlterTable
ALTER TABLE "CashOpApprovalStep" ADD COLUMN "approvedAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "CashOperationRequest" ADD COLUMN "finalApprovedAmount" DECIMAL(18,2),
ADD COLUMN "periodeFrom" TIMESTAMP(3),
ADD COLUMN "periodeTo" TIMESTAMP(3),
ADD COLUMN "realisasiCompletedAt" TIMESTAMP(3),
ADD COLUMN "realisasiCurrentStepRole" TEXT,
ADD COLUMN "realisasiRejectionReason" TEXT,
ADD COLUMN "realisasiStatus" "RealisasiStatus",
ADD COLUMN "realisasiSubmittedAt" TIMESTAMP(3),
ADD COLUMN "realisasiTotal" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "CashOpRealisasiItem" (
    "id" TEXT NOT NULL,
    "cashOpRequestId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashOpRealisasiItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashOpRealisasiStep" (
    "id" TEXT NOT NULL,
    "cashOpRequestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashOpRealisasiStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashOpRealisasiItem_cashOpRequestId_itemNumber_idx" ON "CashOpRealisasiItem"("cashOpRequestId", "itemNumber");

-- CreateIndex
CREATE INDEX "CashOpRealisasiStep_cashOpRequestId_idx" ON "CashOpRealisasiStep"("cashOpRequestId");

-- CreateIndex
CREATE INDEX "CashOperationRequest_realisasiStatus_idx" ON "CashOperationRequest"("realisasiStatus");

-- CreateIndex
CREATE INDEX "CashOperationRequest_periodeTo_idx" ON "CashOperationRequest"("periodeTo");

-- AddForeignKey
ALTER TABLE "CashOpRealisasiItem" ADD CONSTRAINT "CashOpRealisasiItem_cashOpRequestId_fkey" FOREIGN KEY ("cashOpRequestId") REFERENCES "CashOperationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpRealisasiStep" ADD CONSTRAINT "CashOpRealisasiStep_cashOpRequestId_fkey" FOREIGN KEY ("cashOpRequestId") REFERENCES "CashOperationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpRealisasiStep" ADD CONSTRAINT "CashOpRealisasiStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
