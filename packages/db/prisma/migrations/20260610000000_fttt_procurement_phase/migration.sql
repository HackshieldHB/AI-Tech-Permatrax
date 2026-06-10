-- Add PROCUREMENT to FtttPhase enum (PST: PO document upload between Preparation and Implementation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PROCUREMENT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttPhase')
  ) THEN
    ALTER TYPE "FtttPhase" ADD VALUE 'PROCUREMENT';
  END IF;
END;
$$;
