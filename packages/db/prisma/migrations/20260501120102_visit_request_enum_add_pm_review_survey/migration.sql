DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VisitRequestStatus' AND e.enumlabel = 'PM_REVIEW_SURVEY'
  ) THEN
    ALTER TYPE "VisitRequestStatus" ADD VALUE 'PM_REVIEW_SURVEY';
  END IF;
END $$;
