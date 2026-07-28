-- Stable v1: Bukti Transfer on FtttTransaction + Approval Dana read tracking
ALTER TABLE "FtttTransaction" ADD COLUMN IF NOT EXISTS "hasTransferProof" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FtttTransaction" ADD COLUMN IF NOT EXISTS "transferProofUrl" TEXT;

CREATE TABLE IF NOT EXISTS "FtttFundRequestRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FtttFundRequestRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FtttFundRequestRead_userId_transactionId_key" ON "FtttFundRequestRead"("userId", "transactionId");
CREATE INDEX IF NOT EXISTS "FtttFundRequestRead_userId_idx" ON "FtttFundRequestRead"("userId");
CREATE INDEX IF NOT EXISTS "FtttFundRequestRead_transactionId_idx" ON "FtttFundRequestRead"("transactionId");

DO $$ BEGIN
  ALTER TABLE "FtttFundRequestRead" ADD CONSTRAINT "FtttFundRequestRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FtttFundRequestRead" ADD CONSTRAINT "FtttFundRequestRead_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FtttTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
