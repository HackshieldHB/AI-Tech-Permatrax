-- Migration: Add missing RealisasiStatus enum values required by realisasi approval chain
-- Fixes 500 error: invalid input value for enum "RealisasiStatus": "PENDING_PM_REVIEW"

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'RealisasiStatus'
    AND pg_enum.enumlabel = 'PENDING_PM_REVIEW'
  ) THEN
    ALTER TYPE "RealisasiStatus" ADD VALUE 'PENDING_PM_REVIEW';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'RealisasiStatus'
    AND pg_enum.enumlabel = 'PENDING_OPS_REVIEW'
  ) THEN
    ALTER TYPE "RealisasiStatus" ADD VALUE 'PENDING_OPS_REVIEW';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'RealisasiStatus'
    AND pg_enum.enumlabel = 'PENDING_GM_REVIEW'
  ) THEN
    ALTER TYPE "RealisasiStatus" ADD VALUE 'PENDING_GM_REVIEW';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'RealisasiStatus'
    AND pg_enum.enumlabel = 'PENDING_MARKETING_HEAD_REVIEW'
  ) THEN
    ALTER TYPE "RealisasiStatus" ADD VALUE 'PENDING_MARKETING_HEAD_REVIEW';
  END IF;
END $$;
