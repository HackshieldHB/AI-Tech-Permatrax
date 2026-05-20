-- Sync missing columns from schema.prisma to production database
-- Generated: 2026-05-20

-- Order table: missing PPN fields
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ppnType" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ppnValue" DECIMAL(10,2);

-- CashOperationRequest table: missing approvedAt field
ALTER TABLE "CashOperationRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
