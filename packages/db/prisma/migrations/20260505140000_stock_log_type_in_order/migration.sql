-- Issue #48: stock increment on order verification (SESUAI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'StockLogType' AND e.enumlabel = 'IN_ORDER'
  ) THEN
    ALTER TYPE "StockLogType" ADD VALUE 'IN_ORDER';
  END IF;
END $$;
