-- CreateEnum
CREATE TYPE "StockRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ADMIN_REVIEWING', 'PO_CREATED', 'OPS_APPROVED', 'FINANCE_APPROVED', 'ITEMS_RECEIVED', 'FULFILLED', 'REJECTED');

-- AlterTable
ALTER TABLE "Hld" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "adminRejectedAt" TIMESTAMP(3),
ADD COLUMN     "pmNotes" TEXT,
ADD COLUMN     "pmRejectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StockRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "permitClusterId" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" "StockRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "adminNotes" TEXT,
    "opsNotes" TEXT,
    "financeNotes" TEXT,
    "poFileUrl" TEXT,
    "poCreatedBy" TEXT,
    "poCreatedAt" TIMESTAMP(3),
    "paymentFileUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_requestNumber_key" ON "StockRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "StockRequest_status_idx" ON "StockRequest"("status");

-- CreateIndex
CREATE INDEX "StockRequest_requestedBy_idx" ON "StockRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "StockRequest_permitClusterId_idx" ON "StockRequest"("permitClusterId");

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
