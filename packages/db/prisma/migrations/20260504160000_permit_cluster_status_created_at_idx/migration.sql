-- Sprint 2: support SLA / status+time range filters on PermitCluster
CREATE INDEX IF NOT EXISTS "PermitCluster_status_createdAt_idx" ON "PermitCluster" ("status", "createdAt");
