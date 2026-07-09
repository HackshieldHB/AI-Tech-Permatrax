-- iFORTE lifecycle alignment + meter-based implementation progress
ALTER TYPE "FtttImplLogType" ADD VALUE IF NOT EXISTS 'RFSD';
ALTER TYPE "FtttDocumentType" ADD VALUE IF NOT EXISTS 'DOKUMENTASI';
ALTER TYPE "FtttDocumentType" ADD VALUE IF NOT EXISTS 'PUNCH_LIST';

ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "totalPanjangMeter" DECIMAL(12,2);
ALTER TABLE "FtttProject" ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT;

ALTER TABLE "FtttSpanLog" ADD COLUMN IF NOT EXISTS "meterDone" DECIMAL(10,2);
