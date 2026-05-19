UPDATE "VisitRequest" SET status = 'PM_REVIEW_VISIT'::"VisitRequestStatus" WHERE status::text = 'SUBMITTED';
UPDATE "VisitRequest" SET status = 'PM_REVIEW_SURVEY'::"VisitRequestStatus" WHERE status::text = 'PM_REVIEW';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VisitRequestStatus' AND e.enumlabel IN ('SUBMITTED', 'PM_REVIEW')
  ) THEN
    CREATE TYPE "VisitRequestStatus_new" AS ENUM (
      'DRAFT',
      'PM_REVIEW_VISIT',
      'APPROVED_PENDING_DATA',
      'PM_REVIEW_SURVEY',
      'PM_SENIOR_REVIEW',
      'ADMIN_REVIEW',
      'APPROVED',
      'REJECTED',
      'EXISTING_FIBER'
    );
    ALTER TABLE "VisitRequest" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "VisitRequest" ALTER COLUMN "status" TYPE "VisitRequestStatus_new" USING ("status"::text::"VisitRequestStatus_new");
    DROP TYPE "VisitRequestStatus";
    ALTER TYPE "VisitRequestStatus_new" RENAME TO "VisitRequestStatus";
    ALTER TABLE "VisitRequest" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"VisitRequestStatus";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ApprovalAction' AND e.enumlabel = 'VISIT_GATE_APPROVED'
  ) THEN
    ALTER TYPE "ApprovalAction" ADD VALUE 'VISIT_GATE_APPROVED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'ApprovalAction' AND e.enumlabel = 'VISIT_GATE_REJECTED'
  ) THEN
    ALTER TYPE "ApprovalAction" ADD VALUE 'VISIT_GATE_REJECTED';
  END IF;
END $$;
