-- AlterTable: make invoiceFileUrl nullable so Finance can submit the form without an attachment
ALTER TABLE "SupplierInvoice" ALTER COLUMN "invoiceFileUrl" DROP NOT NULL;
