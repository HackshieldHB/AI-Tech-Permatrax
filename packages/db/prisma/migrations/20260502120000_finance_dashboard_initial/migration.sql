-- Finance dashboard: FinanceProject, BudgetLedger, BudgetTransfer + FKs on Order / CashOperationRequest
-- Additive only. Partial unique indexes for deduct/refund idempotency.

-- CreateEnum
CREATE TYPE "FinanceProjectStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BudgetLedgerCategory" AS ENUM ('MATERIAL', 'JASA');

-- CreateEnum
CREATE TYPE "BudgetLedgerEntryType" AS ENUM (
  'BUDGET_INIT',
  'BUDGET_ADJUSTMENT',
  'DEDUCT_MATERIAL',
  'DEDUCT_JASA',
  'REFUND_MATERIAL',
  'REFUND_JASA',
  'TRANSFER_OUT',
  'TRANSFER_IN'
);

-- CreateEnum
CREATE TYPE "BudgetLedgerSourceType" AS ENUM ('ORDER', 'CASH_OP', 'MANUAL_ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "BudgetTransferStatus" AS ENUM ('PENDING_GM_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FinanceProject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalBudget" DECIMAL(18, 2) NOT NULL,
    "materialBudget" DECIMAL(18, 2),
    "jasaBudget" DECIMAL(18, 2),
    "materialSpent" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "jasaSpent" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "isOverbudget" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultUncategorized" BOOLEAN NOT NULL DEFAULT false,
    "endDate" TIMESTAMP(3),
    "status" "FinanceProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetTransfer" (
    "id" TEXT NOT NULL,
    "sourceFinanceProjectId" TEXT NOT NULL,
    "targetFinanceProjectId" TEXT NOT NULL,
    "sourceCategory" "BudgetLedgerCategory" NOT NULL,
    "targetCategory" "BudgetLedgerCategory" NOT NULL,
    "amount" DECIMAL(18, 2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "BudgetTransferStatus" NOT NULL DEFAULT 'PENDING_GM_APPROVAL',
    "submittedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLedger" (
    "id" TEXT NOT NULL,
    "financeProjectId" TEXT NOT NULL,
    "entryType" "BudgetLedgerEntryType" NOT NULL,
    "category" "BudgetLedgerCategory",
    "amount" DECIMAL(18, 2) NOT NULL,
    "sourceType" "BudgetLedgerSourceType",
    "sourceId" TEXT,
    "budgetTransferId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceProject_code_key" ON "FinanceProject"("code");

-- CreateIndex
CREATE INDEX "FinanceProject_status_idx" ON "FinanceProject"("status");

-- CreateIndex
CREATE INDEX "FinanceProject_isDefaultUncategorized_idx" ON "FinanceProject"("isDefaultUncategorized");

-- CreateIndex
CREATE INDEX "FinanceProject_code_idx" ON "FinanceProject"("code");

-- CreateIndex
CREATE INDEX "BudgetTransfer_status_idx" ON "BudgetTransfer"("status");

-- CreateIndex
CREATE INDEX "BudgetTransfer_sourceFinanceProjectId_idx" ON "BudgetTransfer"("sourceFinanceProjectId");

-- CreateIndex
CREATE INDEX "BudgetTransfer_targetFinanceProjectId_idx" ON "BudgetTransfer"("targetFinanceProjectId");

-- CreateIndex
CREATE INDEX "BudgetTransfer_submittedById_idx" ON "BudgetTransfer"("submittedById");

-- CreateIndex
CREATE INDEX "BudgetLedger_financeProjectId_createdAt_idx" ON "BudgetLedger"("financeProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "BudgetLedger_sourceType_sourceId_idx" ON "BudgetLedger"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BudgetLedger_budgetTransferId_idx" ON "BudgetLedger"("budgetTransferId");

-- AddForeignKey
ALTER TABLE "FinanceProject" ADD CONSTRAINT "FinanceProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceProject" ADD CONSTRAINT "FinanceProject_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_sourceFinanceProjectId_fkey" FOREIGN KEY ("sourceFinanceProjectId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_targetFinanceProjectId_fkey" FOREIGN KEY ("targetFinanceProjectId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetTransfer" ADD CONSTRAINT "BudgetTransfer_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_financeProjectId_fkey" FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_budgetTransferId_fkey" FOREIGN KEY ("budgetTransferId") REFERENCES "BudgetTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "financeProjectId" TEXT;

-- AlterTable
ALTER TABLE "CashOperationRequest" ADD COLUMN "financeProjectId" TEXT;

-- CreateIndex
CREATE INDEX "Order_financeProjectId_idx" ON "Order"("financeProjectId");

-- CreateIndex
CREATE INDEX "CashOperationRequest_financeProjectId_idx" ON "CashOperationRequest"("financeProjectId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_financeProjectId_fkey" FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashOperationRequest" ADD CONSTRAINT "CashOperationRequest_financeProjectId_fkey" FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: idempotency for deduct / refund (see OQ spec)
CREATE UNIQUE INDEX "BudgetLedger_dedup_deduct" ON "BudgetLedger" ("sourceType", "sourceId")
WHERE "entryType" IN ('DEDUCT_MATERIAL', 'DEDUCT_JASA');

CREATE UNIQUE INDEX "BudgetLedger_dedup_refund" ON "BudgetLedger" ("sourceType", "sourceId")
WHERE "entryType" IN ('REFUND_MATERIAL', 'REFUND_JASA');

-- Seed default uncategorized project (requires at least one User row)
INSERT INTO "FinanceProject" (
    "id",
    "code",
    "name",
    "description",
    "totalBudget",
    "materialBudget",
    "jasaBudget",
    "materialSpent",
    "jasaSpent",
    "isOverbudget",
    "isDefaultUncategorized",
    "endDate",
    "status",
    "createdById",
    "updatedById",
    "createdAt",
    "updatedAt"
)
SELECT
    'clseedfinancegeneral0001',
    'GENERAL',
    'GENERAL / UNCATEGORIZED',
    'Default project for uncategorized transactions (system-managed).',
    0,
    NULL,
    NULL,
    0,
    0,
    false,
    true,
    NULL,
    'ACTIVE'::"FinanceProjectStatus",
    u."id",
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) AS u
WHERE NOT EXISTS (SELECT 1 FROM "FinanceProject" WHERE "code" = 'GENERAL');
