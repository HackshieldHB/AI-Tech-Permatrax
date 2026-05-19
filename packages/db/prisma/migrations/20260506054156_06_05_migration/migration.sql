-- CreateEnum
CREATE TYPE "BakAgreementStatus" AS ENUM ('DRAFT', 'FORM_COMPLETE', 'PDF_GENERATED', 'SIGNED_UPLOADED', 'PM_REVIEW', 'PM_REJECTED', 'ADMIN_REVIEW', 'ADMIN_REJECTED', 'APPROVED');

-- AlterTable
ALTER TABLE "Bakp" ADD COLUMN     "adminApprovedAt" TIMESTAMP(3),
ADD COLUMN     "adminApprovedBy" TEXT,
ADD COLUMN     "adminRejectedAt" TIMESTAMP(3),
ADD COLUMN     "adminRejectionReason" TEXT,
ADD COLUMN     "docBakpUrls" JSONB,
ADD COLUMN     "pmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmApprovedBy" TEXT,
ADD COLUMN     "pmRejectedAt" TIMESTAMP(3),
ADD COLUMN     "pmRejectionReason" TEXT;

-- AlterTable
ALTER TABLE "ClaimPackage" ADD COLUMN     "docApprovals" JSONB,
ADD COLUMN     "pmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pmApprovedBy" TEXT,
ADD COLUMN     "pmRejectedAt" TIMESTAMP(3),
ADD COLUMN     "pmRejectionReason" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adminStockNotes" TEXT,
ADD COLUMN     "adminStockSubmittedBy" TEXT,
ADD COLUMN     "financeNotes" TEXT,
ADD COLUMN     "financeProcessedAt" TIMESTAMP(3),
ADD COLUMN     "financeProcessedBy" TEXT,
ADD COLUMN     "financeReceiptUrl" TEXT,
ADD COLUMN     "fulfilledAt" TIMESTAMP(3),
ADD COLUMN     "gmApprovedAt" TIMESTAMP(3),
ADD COLUMN     "gmApprovedBy" TEXT,
ADD COLUMN     "gmNotes" TEXT,
ADD COLUMN     "gmRejectionReason" TEXT,
ADD COLUMN     "itemsArrivedAt" TIMESTAMP(3),
ADD COLUMN     "opsApprovedAt" TIMESTAMP(3),
ADD COLUMN     "opsApprovedBy" TEXT,
ADD COLUMN     "opsNotes" TEXT,
ADD COLUMN     "opsRejectionReason" TEXT,
ADD COLUMN     "purchaseItems" JSONB,
ADD COLUMN     "requestedItems" JSONB,
ADD COLUMN     "revisionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submittedByAdminAt" TIMESTAMP(3),
ADD COLUMN     "totalAmount" DECIMAL(15,2) DEFAULT 0,
ADD COLUMN     "verificationNotes" TEXT,
ADD COLUMN     "verificationStatus" TEXT,
ADD COLUMN     "verifiedBy" TEXT;

-- AlterTable
ALTER TABLE "PermitCluster" ADD COLUMN     "areaCategory" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "rwName" TEXT;

-- CreateTable
CREATE TABLE "GisLayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "geoJson" JSONB NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#FF6B00',
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GisLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BakAgreement" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "status" "BakAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "wpNama" TEXT,
    "wpNoKtp" TEXT,
    "wpJabatan" TEXT,
    "wpAlamat" TEXT,
    "wpNoTelp" TEXT,
    "tipeLokasiType" TEXT,
    "tipeLokasiOther" TEXT,
    "namaLokasi" TEXT,
    "alamatLokasi" TEXT,
    "alamatKantorPemasaran" TEXT,
    "jangkaWaktu" TEXT,
    "homepasExisting" INTEGER,
    "kategoriPerumahan" TEXT,
    "occupancy" DOUBLE PRECISION,
    "penempatanKabel" TEXT,
    "existingCompetitor" TEXT,
    "benefitIsp" TEXT,
    "areaDimeterM" TEXT,
    "benefitPemilik" TEXT,
    "ketentuanListrik" TEXT,
    "ketentuanTambahan" TEXT,
    "useDigitalSignature" BOOLEAN NOT NULL DEFAULT false,
    "signatureIspUrl" TEXT,
    "signaturePemilikUrl" TEXT,
    "signatureIspName" TEXT,
    "signaturePemilikName" TEXT,
    "ktpPhotoUrls" JSONB,
    "stempelPhotoUrl" TEXT,
    "pdfUrl" TEXT,
    "signedPdfUrl" TEXT,
    "pmNotes" TEXT,
    "pmApprovedBy" TEXT,
    "pmApprovedAt" TIMESTAMP(3),
    "adminNotes" TEXT,
    "adminApprovedBy" TEXT,
    "adminApprovedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BakAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GisLayer_uploadedBy_idx" ON "GisLayer"("uploadedBy");

-- CreateIndex
CREATE UNIQUE INDEX "BakAgreement_permitClusterId_key" ON "BakAgreement"("permitClusterId");

-- AddForeignKey
ALTER TABLE "GisLayer" ADD CONSTRAINT "GisLayer_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BakAgreement" ADD CONSTRAINT "BakAgreement_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
