-- PermaTrax AI Chatbot tables (local free RAG + conversation logs)

CREATE TABLE IF NOT EXISTS "AiKnowledgeArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "securityLevel" TEXT NOT NULL DEFAULT 'INTERNAL',
    "rolesAllowed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeArticle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiKnowledgeArticle_slug_key" ON "AiKnowledgeArticle"("slug");
CREATE INDEX IF NOT EXISTS "AiKnowledgeArticle_module_idx" ON "AiKnowledgeArticle"("module");
CREATE INDEX IF NOT EXISTS "AiKnowledgeArticle_category_idx" ON "AiKnowledgeArticle"("category");
CREATE INDEX IF NOT EXISTS "AiKnowledgeArticle_isActive_idx" ON "AiKnowledgeArticle"("isActive");

CREATE TABLE IF NOT EXISTS "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiKnowledgeChunk_articleId_chunkIndex_key" ON "AiKnowledgeChunk"("articleId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "AiKnowledgeChunk_keywords_idx" ON "AiKnowledgeChunk"("keywords");

CREATE TABLE IF NOT EXISTS "AiConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiConversation_userId_idx" ON "AiConversation"("userId");

CREATE TABLE IF NOT EXISTS "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "toolTraces" JSONB,
    "grounded" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiMessage_conversationId_idx" ON "AiMessage"("conversationId");

CREATE TABLE IF NOT EXISTS "AiFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiFeedback_messageId_key" ON "AiFeedback"("messageId");

CREATE TABLE IF NOT EXISTS "AiPromptLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "intent" TEXT,
    "model" TEXT,
    "tokenIn" INTEGER,
    "tokenOut" INTEGER,
    "latencyMs" INTEGER,
    "ollamaUsed" BOOLEAN NOT NULL DEFAULT false,
    "refusal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPromptLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiPromptLog_userId_idx" ON "AiPromptLog"("userId");
CREATE INDEX IF NOT EXISTS "AiPromptLog_createdAt_idx" ON "AiPromptLog"("createdAt");

DO $$ BEGIN
  ALTER TABLE "AiKnowledgeChunk" ADD CONSTRAINT "AiKnowledgeChunk_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "AiKnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AiFeedback" ADD CONSTRAINT "AiFeedback_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
