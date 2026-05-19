-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SkomStatus" ADD VALUE 'PENDING_OPS_APPROVAL';
ALTER TYPE "SkomStatus" ADD VALUE 'OPS_APPROVED';
ALTER TYPE "SkomStatus" ADD VALUE 'OPS_REJECTED';
ALTER TYPE "SkomStatus" ADD VALUE 'PENDING_GM_APPROVAL';
ALTER TYPE "SkomStatus" ADD VALUE 'GM_APPROVED';
ALTER TYPE "SkomStatus" ADD VALUE 'GM_REJECTED';

-- AlterTable
ALTER TABLE "SkomBudget" ADD COLUMN     "budgetAmount" DECIMAL(15,2),
ADD COLUMN     "budgetFileUrl" TEXT,
ADD COLUMN     "gmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "gmApprovedBy" TEXT,
ADD COLUMN     "gmNotes" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "opsApprovedAt" TIMESTAMP(3),
ADD COLUMN     "opsApprovedBy" TEXT,
ADD COLUMN     "opsNotes" TEXT,
ADD COLUMN     "submittedBy" TEXT,
ALTER COLUMN "totalBudget" DROP NOT NULL;
