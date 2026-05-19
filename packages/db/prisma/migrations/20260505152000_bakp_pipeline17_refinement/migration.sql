-- CreateEnum
CREATE TYPE "BakpIspDecision" AS ENUM ('ACCEPTED', 'REJECTED');

-- Alter BakpStatus enum by recreation
ALTER TYPE "BakpStatus" RENAME TO "BakpStatus_old";
CREATE TYPE "BakpStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED_TO_PM',
  'PM_APPROVED',
  'SUBMITTED_TO_ADMIN',
  'ADMIN_APPROVED',
  'SUBMITTED_TO_ISP',
  'DONE',
  'REJECTED_BY_PM',
  'REJECTED_BY_ADMIN',
  'REJECTED_BY_ISP'
);

ALTER TABLE "Bakp" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Bakp"
ALTER COLUMN "status" TYPE "BakpStatus"
USING (
  CASE
    WHEN "status"::text = 'DRAFT' THEN 'DRAFT'::"BakpStatus"
    WHEN "status"::text = 'PAYMENT_PENDING' THEN 'DRAFT'::"BakpStatus"
    WHEN "status"::text = 'SUBMITTED' THEN 'SUBMITTED_TO_PM'::"BakpStatus"
    WHEN "status"::text = 'UNDER_REVIEW' THEN 'SUBMITTED_TO_ADMIN'::"BakpStatus"
    WHEN "status"::text = 'REVISION_REQUIRED' THEN 'REJECTED_BY_ADMIN'::"BakpStatus"
    WHEN "status"::text = 'APPROVED' THEN 'DONE'::"BakpStatus"
    ELSE 'DRAFT'::"BakpStatus"
  END
);
ALTER TABLE "Bakp" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "BakpStatus_old";

-- AlterTable
ALTER TABLE "Bakp"
ADD COLUMN "approvalLogs" JSONB,
ADD COLUMN "finalMergedPdfUrl" TEXT,
ADD COLUMN "ispDecision" "BakpIspDecision",
ADD COLUMN "ispDecisionAt" TIMESTAMP(3),
ADD COLUMN "ispDecisionBy" TEXT,
ADD COLUMN "ispRejectionReason" TEXT,
ADD COLUMN "ispSubmittedAt" TIMESTAMP(3),
ADD COLUMN "ispSubmittedBy" TEXT;
