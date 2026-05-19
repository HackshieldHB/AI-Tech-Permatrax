-- Phase 3 Milestone 1: remove StockRequest, add procurement schema (Supplier, SupplierInvoice, StockOut, Order extensions).
-- Does not alter VisitRequest or other unrelated tables.

-- Drop legacy stock request flow
DROP TABLE IF EXISTS "StockRequest";
DROP TYPE IF EXISTS "StockRequestStatus";

-- New enum types
CREATE TYPE "OrderTrigger" AS ENUM ('PROJECT_REQUEST', 'STOCK_RESTOCK');
CREATE TYPE "PaymentMethod" AS ENUM ('CBD', 'COD', 'TERMIN');
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'SENT_TO_SUPPLIER', 'APPROVED_BY_SUPPLIER', 'REJECTED_BY_SUPPLIER');
CREATE TYPE "StockOutStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- Align OrderStatus with Prisma schema (additive; skip errors if a value already exists in DBs that were db-push'd)
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_ADMIN_STOCK';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PURCHASING_INPUT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_OPS_APPROVAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'REJECTED_BY_OPS';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_GM_APPROVAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'REJECTED_BY_GM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_PAYMENT_RECEIPT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_FINANCE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PURCHASED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_VERIFICATION';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'PROCESSING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'PURCHASING';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supplier master
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "npwp" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "bankAccount" TEXT,
    "bankName" TEXT,
    "contactPerson" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE INDEX "Supplier_isActive_idx" ON "Supplier"("isActive");
CREATE INDEX "Supplier_code_idx" ON "Supplier"("code");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order: Phase 3 columns
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderTrigger" "OrderTrigger" NOT NULL DEFAULT 'PROJECT_REQUEST';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "purchasingSubmittedById" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "purchasingSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "purchasingNotes" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poGeneratedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poFileUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poEmailSentAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poEmailSentById" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "poEmailMessageId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledById" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

CREATE UNIQUE INDEX "Order_poNumber_key" ON "Order"("poNumber");
CREATE INDEX "Order_orderTrigger_idx" ON "Order"("orderTrigger");
CREATE INDEX "Order_supplierId_idx" ON "Order"("supplierId");
CREATE INDEX "Order_status_orderTrigger_idx" ON "Order"("status", "orderTrigger");

ALTER TABLE "Order" ADD CONSTRAINT "Order_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_purchasingSubmittedById_fkey" FOREIGN KEY ("purchasingSubmittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_poEmailSentById_fkey" FOREIGN KEY ("poEmailSentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tagihan (supplier invoice)
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceFileUrl" TEXT NOT NULL,
    "invoiceAmount" DECIMAL(18,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentDueDate" TIMESTAMP(3),
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "emailSentAt" TIMESTAMP(3),
    "supplierAckAt" TIMESTAMP(3),
    "supplierRejectionReason" TEXT,
    "uploadedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierInvoice_invoiceNumber_key" ON "SupplierInvoice"("invoiceNumber");
CREATE UNIQUE INDEX "SupplierInvoice_orderId_key" ON "SupplierInvoice"("orderId");
CREATE INDEX "SupplierInvoice_status_idx" ON "SupplierInvoice"("status");
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stock out requests (PermitCluster-linked)
CREATE TABLE "StockOut" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "permitClusterId" TEXT,
    "items" JSONB NOT NULL,
    "status" "StockOutStatus" NOT NULL DEFAULT 'PENDING',
    "fulfilledById" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StockOut_requestNumber_key" ON "StockOut"("requestNumber");
CREATE INDEX "StockOut_status_requestedById_idx" ON "StockOut"("status", "requestedById");

ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
