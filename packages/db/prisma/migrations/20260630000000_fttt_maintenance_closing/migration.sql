-- JLM FTTT: maintenance closing confirmation + reminder + PST implementation type

-- 1. Create FtttImplementationType enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FtttImplementationType') THEN
    CREATE TYPE "FtttImplementationType" AS ENUM ('GALIAN', 'KU');
  END IF;
END;
$$;

-- 2. Add columns to FtttProject (idempotent)
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "implementationType"       "FtttImplementationType";
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "maintenanceEndDate"       TIMESTAMP(3);
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "maintenanceConfirmedAt"   TIMESTAMP(3);
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "maintenanceConfirmedById" TEXT;
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "lastMaintReminderAt"      TIMESTAMP(3);

-- 3. FK for maintenanceConfirmedById → User(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FtttProject_maintenanceConfirmedById_fkey'
  ) THEN
    ALTER TABLE "FtttProject"
      ADD CONSTRAINT "FtttProject_maintenanceConfirmedById_fkey"
      FOREIGN KEY ("maintenanceConfirmedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$$;
