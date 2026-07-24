-- Integra V9: durable System Overview activity log (all users)
CREATE TABLE IF NOT EXISTS "SystemActivityLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "method" TEXT,
  "path" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemActivityLog_createdAt_idx" ON "SystemActivityLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SystemActivityLog_actorId_idx" ON "SystemActivityLog"("actorId");
CREATE INDEX IF NOT EXISTS "SystemActivityLog_module_idx" ON "SystemActivityLog"("module");

DO $$ BEGIN
  ALTER TABLE "SystemActivityLog"
    ADD CONSTRAINT "SystemActivityLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
