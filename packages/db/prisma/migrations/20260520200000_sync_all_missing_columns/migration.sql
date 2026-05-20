-- Comprehensive migration to sync ALL missing columns from schema.prisma
-- Generated: 2026-05-20

-- CashOpRealisasiStep: missing hasilCheckingFinance column
ALTER TABLE "CashOpRealisasiStep" ADD COLUMN IF NOT EXISTS "hasilCheckingFinance" TEXT;

-- NetworkDesign: missing sketchTopology column
ALTER TABLE "NetworkDesign" ADD COLUMN IF NOT EXISTS "sketchTopology" TEXT;

-- Order: fix ppnValue type to DECIMAL(10,2) 
-- Note: This only works if column is empty, otherwise manual data migration needed
-- ALTER TABLE "Order" ALTER COLUMN "ppnValue" TYPE DECIMAL(10,2);

-- Enum default changes for Hld and Lld status
-- These require data migration if existing data has old enum values
-- ALTER TABLE "Hld" ALTER COLUMN "status" SET DEFAULT 'WAITING_INPUT'::"HldStatus";
-- ALTER TABLE "Lld" ALTER COLUMN "status" SET DEFAULT 'WAITING_INPUT'::"LldStatus";
