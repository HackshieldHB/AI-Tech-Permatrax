-- PAI P0: first-class conversation state + strategy telemetry
ALTER TABLE "AiConversation" ADD COLUMN IF NOT EXISTS "sessionState" JSONB;

ALTER TABLE "AiPromptLog" ADD COLUMN IF NOT EXISTS "responseStrategy" TEXT;
ALTER TABLE "AiPromptLog" ADD COLUMN IF NOT EXISTS "failureKind" TEXT;
ALTER TABLE "AiPromptLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "AiPromptLog_responseStrategy_idx" ON "AiPromptLog"("responseStrategy");
