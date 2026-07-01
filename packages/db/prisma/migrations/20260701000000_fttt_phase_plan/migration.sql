-- JLM: per-phase planned timeline for FTTT Cost/Progress S-Curve baseline
ALTER TABLE "FtttPhaseProgress" ADD COLUMN IF NOT EXISTS "plannedEndDate" TIMESTAMP(3);
ALTER TABLE "FtttPhaseProgress" ADD COLUMN IF NOT EXISTS "weight" DECIMAL(6,2);
