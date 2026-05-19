-- AlterTable // FIX: cash operation approval chain JSON + step index
ALTER TABLE "CashOperationRequest" ADD COLUMN     "approvalChain" JSONB,
ADD COLUMN     "approvalHistory" JSONB,
ADD COLUMN     "currentApproverRole" TEXT,
ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalSteps" INTEGER NOT NULL DEFAULT 0;
