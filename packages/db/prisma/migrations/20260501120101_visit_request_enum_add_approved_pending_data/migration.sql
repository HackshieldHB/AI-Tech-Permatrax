DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'VisitRequestStatus' AND e.enumlabel = 'APPROVED_PENDING_DATA'
  ) THEN
    ALTER TYPE "VisitRequestStatus" ADD VALUE 'APPROVED_PENDING_DATA';
  END IF;
END $$;
