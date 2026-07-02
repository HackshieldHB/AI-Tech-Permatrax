-- JLM: Finance-owned S-Curve baseline milestones for FTTT projects
CREATE TABLE IF NOT EXISTS "FtttMilestone" (
  "id"                 TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "financeProjectId"   TEXT NOT NULL,
  "targetDate"         TIMESTAMP(3) NOT NULL,
  "plannedBudget"      DECIMAL(18,2) NOT NULL,
  "plannedProgressPct" DECIMAL(6,2) NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FtttMilestone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FtttMilestone_financeProjectId_fkey" FOREIGN KEY ("financeProjectId")
    REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "FtttMilestone_financeProjectId_idx" ON "FtttMilestone"("financeProjectId");
