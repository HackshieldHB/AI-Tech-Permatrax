-- AlterEnum
ALTER TYPE "SkomStatus" ADD VALUE 'DISBURSED';

-- AlterTable
ALTER TABLE "CashOperationRequest" ADD COLUMN     "fileUrl" TEXT,
ADD COLUMN     "lineItems" JSONB,
ADD COLUMN     "photoUrls" JSONB,
ADD COLUMN     "totalAmount" DECIMAL(65,30) DEFAULT 0;

-- AlterTable
ALTER TABLE "SkomBudget" ADD COLUMN     "disbursedAt" TIMESTAMP(3),
ADD COLUMN     "disbursedBy" TEXT,
ADD COLUMN     "disbursementAmount" DECIMAL(65,30),
ADD COLUMN     "disbursementEndDate" TIMESTAMP(3),
ADD COLUMN     "disbursementNotes" TEXT,
ADD COLUMN     "disbursementStartDate" TIMESTAMP(3);
