-- Add per-lifecycle FtttDocumentType enum values for Documentation & Acceptance phase
-- Telkom Infra upload docs: KONTRAK, PO, AMANDEMEN_1, DOK_PERUBAHAN_WAKTU
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'KONTRAK'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN ALTER TYPE "FtttDocumentType" ADD VALUE 'KONTRAK'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'PO'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN ALTER TYPE "FtttDocumentType" ADD VALUE 'PO'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'AMANDEMEN_1'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN ALTER TYPE "FtttDocumentType" ADD VALUE 'AMANDEMEN_1'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'DOK_PERUBAHAN_WAKTU'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttDocumentType')
  ) THEN ALTER TYPE "FtttDocumentType" ADD VALUE 'DOK_PERUBAHAN_WAKTU'; END IF;
END;
$$;
