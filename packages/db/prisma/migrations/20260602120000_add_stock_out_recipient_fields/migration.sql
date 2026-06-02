-- AddColumn: recipientCompany, recipientAddress, recipientTelp to StockOut
-- These fields are used in the Stock Out form and Surat Jalan PDF generation

ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "recipientCompany" TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "recipientAddress" TEXT;
ALTER TABLE "StockOut" ADD COLUMN IF NOT EXISTS "recipientTelp" TEXT;
