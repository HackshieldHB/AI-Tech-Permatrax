-- Add BAUT_REKONSILIASI variant to FtttDocumentType enum
-- Used for Documentation & Acceptance phase: BAUT (BA Rekonsiliasi) via Generate Form
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'BAUT_REKONSILIASI'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN
    ALTER TYPE "FtttDocumentType" ADD VALUE 'BAUT_REKONSILIASI';
  END IF;
END;
$$;
