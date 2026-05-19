-- Migration: Fix Realisasi Approval Chain
-- Adds missing enum values and fields for proper approval flow

-- Step 1: Add new CashOpStatus enum values (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_PENDING_PM'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_PENDING_PM';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_PENDING_GM'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_PENDING_GM';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_REJECTED_BY_PM'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_REJECTED_BY_PM';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_REJECTED_BY_GM'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_REJECTED_BY_GM';
  END IF;
END $$;

-- Step 2: Add signature and approval tracking fields
ALTER TABLE "CashOperationRequest"
  ADD COLUMN IF NOT EXISTS "gmSignatureUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "gmApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gmApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "financeSignatureUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "financeApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "financeApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "financeNominalDisetujui" DECIMAL(15,2);
