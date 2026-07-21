-- Integra V2: span folder length + KU daily-log categories

ALTER TABLE "FtttSpan" ADD COLUMN IF NOT EXISTS "lengthMeters" DECIMAL(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PENARIKAN_KABEL'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttSpanLogCategory')
  ) THEN
    ALTER TYPE "FtttSpanLogCategory" ADD VALUE 'PENARIKAN_KABEL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PENANAMAN_TIANG'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttSpanLogCategory')
  ) THEN
    ALTER TYPE "FtttSpanLogCategory" ADD VALUE 'PENANAMAN_TIANG';
  END IF;
END;
$$;
