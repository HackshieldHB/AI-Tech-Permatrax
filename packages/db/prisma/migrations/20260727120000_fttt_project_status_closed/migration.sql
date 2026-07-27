-- Integra V11: Close Parent (Bulky) Project status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CLOSED'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttProjectStatus')
  ) THEN
    ALTER TYPE "FtttProjectStatus" ADD VALUE 'CLOSED';
  END IF;
END;
$$;
