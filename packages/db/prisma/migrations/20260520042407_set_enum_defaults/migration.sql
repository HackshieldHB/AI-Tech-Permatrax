/*
  Migration 2 of 2: Set enum defaults AFTER enum values were committed
  
  This MUST run in a separate migration because PostgreSQL requires
  enum values to be committed before they can be used as defaults.
*/

-- AlterTable: Set defaults using enum values that were added in previous migration
ALTER TABLE "Hld" ALTER COLUMN "status" SET DEFAULT 'WAITING_INPUT';
ALTER TABLE "Lld" ALTER COLUMN "status" SET DEFAULT 'WAITING_INPUT';
ALTER TABLE "PermitCluster" ALTER COLUMN "currentPhase" SET DEFAULT 'CLUSTER_INTAKE';
