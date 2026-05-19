-- CreateEnum
CREATE TYPE "PrBrWorkflowStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'PO_CREATED', 'OPS_APPROVED', 'OPS_REJECTED');

-- CreateTable
CREATE TABLE "PrBrWorkflow" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "prFileUrl" TEXT,
    "brFileUrl" TEXT,
    "prBrNotes" TEXT,
    "poFileUrl" TEXT,
    "poNotes" TEXT,
    "status" "PrBrWorkflowStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "adminReviewedBy" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "opsApprovedBy" TEXT,
    "opsApprovedAt" TIMESTAMP(3),
    "opsNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrBrWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrBrWorkflow_permitClusterId_key" ON "PrBrWorkflow"("permitClusterId");

-- CreateIndex
CREATE INDEX "PrBrWorkflow_status_idx" ON "PrBrWorkflow"("status");

-- AddForeignKey
ALTER TABLE "PrBrWorkflow" ADD CONSTRAINT "PrBrWorkflow_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
