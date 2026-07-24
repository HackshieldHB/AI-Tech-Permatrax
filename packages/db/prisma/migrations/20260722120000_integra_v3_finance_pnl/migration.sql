-- Integra V3: Finance Project P&L (PO Customer + GM approval workflow)

CREATE TYPE "FinancePoApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "FinanceProject"
  ADD COLUMN IF NOT EXISTS "poCustomer" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "poCustomerDocUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "poApprovalStatus" "FinancePoApprovalStatus" NOT NULL DEFAULT 'NONE';

CREATE INDEX IF NOT EXISTS "FinanceProject_poApprovalStatus_idx" ON "FinanceProject"("poApprovalStatus");

CREATE TABLE IF NOT EXISTS "FinancePoChangeRequest" (
  "id" TEXT NOT NULL,
  "financeProjectId" TEXT NOT NULL,
  "previousAmount" DECIMAL(18,2),
  "proposedAmount" DECIMAL(18,2) NOT NULL,
  "docUrl" TEXT,
  "reason" TEXT,
  "status" "FinancePoApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "submittedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePoChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FinancePoChangeRequest_financeProjectId_idx" ON "FinancePoChangeRequest"("financeProjectId");
CREATE INDEX IF NOT EXISTS "FinancePoChangeRequest_status_idx" ON "FinancePoChangeRequest"("status");
CREATE INDEX IF NOT EXISTS "FinancePoChangeRequest_submittedById_idx" ON "FinancePoChangeRequest"("submittedById");

ALTER TABLE "FinancePoChangeRequest"
  ADD CONSTRAINT "FinancePoChangeRequest_financeProjectId_fkey"
  FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancePoChangeRequest"
  ADD CONSTRAINT "FinancePoChangeRequest_submittedById_fkey"
  FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancePoChangeRequest"
  ADD CONSTRAINT "FinancePoChangeRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
