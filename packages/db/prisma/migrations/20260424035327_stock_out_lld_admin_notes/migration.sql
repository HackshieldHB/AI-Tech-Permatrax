-- FIX: PM stock-out intermediate status + LLD admin rejection notes
ALTER TYPE "StockRequestStatus" ADD VALUE 'STOCK_OUT_REQUESTED';

ALTER TABLE "Lld" ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;
