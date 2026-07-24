-- Integra V4: PO Customer number + reject-reason support columns

ALTER TABLE "FinanceProject"
  ADD COLUMN IF NOT EXISTS "poCustomerNumber" TEXT;

ALTER TABLE "FinancePoChangeRequest"
  ADD COLUMN IF NOT EXISTS "previousPoNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "proposedPoNumber" TEXT;
