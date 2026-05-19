-- Add new enum values to CashOpStatus (safe: checks if they exist first)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_PENDING_OPS'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_PENDING_OPS';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_REJECTED_BY_OPS'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_REJECTED_BY_OPS';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_PENDING_FINANCE'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_PENDING_FINANCE';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_REJECTED_BY_FINANCE'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_REJECTED_BY_FINANCE';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'CashOpStatus' 
    AND pg_enum.enumlabel = 'REALISASI_DONE'
  ) THEN 
    ALTER TYPE "CashOpStatus" ADD VALUE 'REALISASI_DONE';
  END IF;
END $$;

-- Add new columns to CashOperationRequest (Issue C & D)
ALTER TABLE "CashOperationRequest" 
  ADD COLUMN IF NOT EXISTS "nomorRekeningPengaju" TEXT,
  ADD COLUMN IF NOT EXISTS "realisasiNomorRekeningFinance" TEXT,
  ADD COLUMN IF NOT EXISTS "realisasiRejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "realisasiRejectedById" TEXT,
  ADD COLUMN IF NOT EXISTS "realisasiRejectedReason" TEXT;

-- Add new column to CashOpRealisasiItem (Issue D)
ALTER TABLE "CashOpRealisasiItem"
  ADD COLUMN IF NOT EXISTS "finalAmount" DECIMAL(15,2);
