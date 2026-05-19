-- Migration: Add pipelineTemplateId to PermitCluster
-- Fixes missing Phase 3A column for pipeline template association

ALTER TABLE "PermitCluster"
  ADD COLUMN IF NOT EXISTS "pipelineTemplateId" TEXT;
