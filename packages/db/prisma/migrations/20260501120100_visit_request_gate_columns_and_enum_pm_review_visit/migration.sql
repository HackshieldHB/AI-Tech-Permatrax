ALTER TABLE "VisitRequest" ADD COLUMN IF NOT EXISTS "visitGateApprovedAt" TIMESTAMP(3);
ALTER TABLE "VisitRequest" ADD COLUMN IF NOT EXISTS "visitGateApprovedBy" TEXT;
ALTER TABLE "VisitRequest" ALTER COLUMN "stakeholderResponse" DROP DEFAULT;
ALTER TABLE "VisitRequest" ALTER COLUMN "stakeholderResponse" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VisitRequestStatus' AND e.enumlabel = 'PM_REVIEW_VISIT'
  ) THEN
    ALTER TYPE "VisitRequestStatus" ADD VALUE 'PM_REVIEW_VISIT';
  END IF;
END $$;
