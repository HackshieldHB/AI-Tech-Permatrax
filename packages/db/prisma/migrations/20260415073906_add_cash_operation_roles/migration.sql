-- CreateEnum
CREATE TYPE "CashOperationType" AS ENUM ('CASH_ADVANCE', 'REIMBURSEMENT');

-- CreateEnum
CREATE TYPE "CashOpStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'DISBURSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'MARKETING';
ALTER TYPE "Role" ADD VALUE 'MARKETING_HEAD';
ALTER TYPE "Role" ADD VALUE 'OPERATIONAL_MANAGER';

-- CreateTable
CREATE TABLE "CashOperationRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "type" "CashOperationType" NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "category" TEXT,
    "projectRef" TEXT,
    "status" "CashOpStatus" NOT NULL DEFAULT 'DRAFT',
    "currentStepRole" TEXT,
    "slaDeadline" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "rejectionReason" TEXT,
    "financeNotes" TEXT,
    "disbursedAt" TIMESTAMP(3),
    "disbursedAmount" DECIMAL(15,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashOperationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashOpApprovalStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverRole" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashOpApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashOpAttachment" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashOpAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashOperationRequest_requestNumber_key" ON "CashOperationRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "CashOperationRequest_status_idx" ON "CashOperationRequest"("status");

-- CreateIndex
CREATE INDEX "CashOperationRequest_requestedBy_idx" ON "CashOperationRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "CashOperationRequest_type_idx" ON "CashOperationRequest"("type");

-- CreateIndex
CREATE INDEX "CashOperationRequest_requestNumber_idx" ON "CashOperationRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "CashOpApprovalStep_requestId_idx" ON "CashOpApprovalStep"("requestId");

-- CreateIndex
CREATE INDEX "CashOpApprovalStep_approverRole_idx" ON "CashOpApprovalStep"("approverRole");

-- CreateIndex
CREATE INDEX "CashOpApprovalStep_status_idx" ON "CashOpApprovalStep"("status");

-- CreateIndex
CREATE INDEX "CashOpAttachment_requestId_idx" ON "CashOpAttachment"("requestId");

-- AddForeignKey
ALTER TABLE "CashOperationRequest" ADD CONSTRAINT "CashOperationRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpApprovalStep" ADD CONSTRAINT "CashOpApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CashOperationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpApprovalStep" ADD CONSTRAINT "CashOpApprovalStep_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpAttachment" ADD CONSTRAINT "CashOpAttachment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CashOperationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOpAttachment" ADD CONSTRAINT "CashOpAttachment_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
