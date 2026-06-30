-- JLM FTTT ↔ Finance integration: project type, FTTT budget categories, link, transaction log

-- 1. Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FinanceProjectType') THEN
    CREATE TYPE "FinanceProjectType" AS ENUM ('FTTH', 'FTTT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FtttCostCategory') THEN
    CREATE TYPE "FtttCostCategory" AS ENUM ('PERIZINAN', 'MATERIAL', 'JASA', 'LAIN_LAIN');
  END IF;
END;
$$;

-- 2. FinanceProject: project type + FTTT budget categories
ALTER TABLE "FinanceProject" ADD COLUMN IF NOT EXISTS "projectType"     "FinanceProjectType" NOT NULL DEFAULT 'FTTH';
ALTER TABLE "FinanceProject" ADD COLUMN IF NOT EXISTS "budgetPerizinan" DECIMAL(18,2);
ALTER TABLE "FinanceProject" ADD COLUMN IF NOT EXISTS "budgetLainLain"  DECIMAL(18,2);
CREATE INDEX IF NOT EXISTS "FinanceProject_projectType_idx" ON "FinanceProject"("projectType");

-- 3. FtttProject: link to FinanceProject
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "financeProjectId" TEXT;
CREATE INDEX IF NOT EXISTS "FtttProject_financeProjectId_idx" ON "FtttProject"("financeProjectId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FtttProject_financeProjectId_fkey') THEN
    ALTER TABLE "FtttProject"
      ADD CONSTRAINT "FtttProject_financeProjectId_fkey"
      FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END;
$$;

-- 4. FtttTransaction (Implementation Transaction Log)
CREATE TABLE IF NOT EXISTS "FtttTransaction" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "ftttProjectId"    TEXT NOT NULL,
  "financeProjectId" TEXT,
  "category"         "FtttCostCategory" NOT NULL,
  "aktivitas"        TEXT NOT NULL,
  "uom"              TEXT,
  "qty"              DECIMAL(18,2) NOT NULL,
  "price"            DECIMAL(18,2) NOT NULL,
  "total"            DECIMAL(18,2) NOT NULL,
  "remarks"          TEXT NOT NULL,
  "createdById"      TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FtttTransaction_ftttProjectId_fkey"    FOREIGN KEY ("ftttProjectId")    REFERENCES "FtttProject"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FtttTransaction_financeProjectId_fkey" FOREIGN KEY ("financeProjectId") REFERENCES "FinanceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FtttTransaction_createdById_fkey"      FOREIGN KEY ("createdById")      REFERENCES "User"("id")           ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FtttTransaction_ftttProjectId_idx"    ON "FtttTransaction"("ftttProjectId");
CREATE INDEX IF NOT EXISTS "FtttTransaction_financeProjectId_idx" ON "FtttTransaction"("financeProjectId");
CREATE INDEX IF NOT EXISTS "FtttTransaction_category_idx"         ON "FtttTransaction"("category");
