-- Integra Enhancement V1 — enums (committed before columns/data that reference them)

CREATE TYPE "FinanceHierarchyLevel" AS ENUM ('SEGMENT', 'SITE', 'STANDALONE');
CREATE TYPE "FtttHierarchyLevel" AS ENUM ('BULKY', 'SITE');
CREATE TYPE "FtttRequestStatus" AS ENUM ('PENDING_REVIEW', 'ACCEPTED', 'DECLINED');
CREATE TYPE "FtttRequestPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "DailyActivityWorkStatus" AS ENUM ('ON_PROGRESS', 'ON_HOLD', 'DONE');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'SITE_INITIATION'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'FtttPhase')
  ) THEN
    ALTER TYPE "FtttPhase" ADD VALUE 'SITE_INITIATION';
  END IF;
END;
$$;
