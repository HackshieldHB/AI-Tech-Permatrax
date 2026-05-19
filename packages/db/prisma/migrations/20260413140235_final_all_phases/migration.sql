-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PERMIT', 'SURVEY', 'DESIGN', 'IMPLEMENTATION', 'ATP', 'CLOSING');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('BAST', 'BAUT', 'BACT', 'ATP_FINDING');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'GENERATED', 'SIGNED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('PERMIT_APPROVAL', 'DESIGN_APPROVAL', 'ATP_APPROVAL', 'DOCUMENT_SIGN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('SAFE', 'WARNING', 'BREACHED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SURVEYOR_FTTH', 'SURVEYOR_FTTB', 'SURVEYOR_FTTT', 'PM_FTTH', 'PM_FTTB', 'PM_FTTT', 'PM_SENIOR', 'ADMIN', 'ADMIN_STOCK', 'FINANCE', 'GENERAL_MANAGER');

-- CreateEnum
CREATE TYPE "FiberType" AS ENUM ('FTTH', 'FTTB', 'FTTT');

-- CreateEnum
CREATE TYPE "CleanListStatus" AS ENUM ('AVAILABLE', 'IN_PROGRESS', 'HAS_EXISTING_FIBER', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VisitRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PM_REVIEW', 'PM_SENIOR_REVIEW', 'ADMIN_REVIEW', 'APPROVED', 'REJECTED', 'EXISTING_FIBER');

-- CreateEnum
CREATE TYPE "StakeholderResponse" AS ENUM ('PENDING', 'ALLOWED', 'NOT_ALLOWED', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "BaOpenStatus" AS ENUM ('GENERATED', 'SENT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMITTED', 'PM_APPROVED', 'PM_REJECTED', 'PM_SENIOR_APPROVED', 'PM_SENIOR_REJECTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED', 'MARKED_EXISTING_FIBER');

-- CreateEnum
CREATE TYPE "StockLogType" AS ENUM ('IN_PURCHASE', 'IN_RETURN', 'OUT_ORDER', 'OUT_DAMAGED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'STOCK_AVAILABLE', 'PARTIAL_STOCK', 'NO_STOCK', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SuratJalanType" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "SuratJalanStatus" AS ENUM ('GENERATED', 'DISPATCHED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'ORDERED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PermitPhase" AS ENUM ('APD_DRAFTING', 'DRM_REVIEW', 'ABD_SUBMISSION', 'ABD_REVISION', 'SOCIALIZATION', 'COMPENSATION_NEGOTIATION', 'BAK_APPROVAL', 'SIGNATURE_COLLECTION', 'SCOM', 'BAKP_COMPILATION', 'BAKP_VALIDATION', 'CONSTRUCTION_READY');

-- CreateEnum
CREATE TYPE "PermitClusterStatus" AS ENUM ('IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApdStatus" AS ENUM ('DRAFT', 'SUBMITTED_FOR_DRM', 'DRM_IN_REVIEW', 'REVISION_REQUIRED', 'APPROVED');

-- CreateEnum
CREATE TYPE "AbdStatus" AS ENUM ('DRAFT', 'SUBMITTED_TO_ISP', 'ISP_REVISION_REQUIRED', 'ISP_APPROVED');

-- CreateEnum
CREATE TYPE "TechnicalDiagramType" AS ENUM ('FLOW_DIAGRAM', 'CORE_CONNECTION_DIAGRAM');

-- CreateEnum
CREATE TYPE "SocializationAgreement" AS ENUM ('PENDING', 'AGREED', 'CONDITIONAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompensationScheme" AS ENUM ('PER_HOMEPASS', 'LUMP_SUM');

-- CreateEnum
CREATE TYPE "CompensationAgreement" AS ENUM ('PENDING', 'AGREED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BakStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED', 'REJECTED', 'SIGNATURES_PENDING', 'SIGNATURES_VALID');

-- CreateEnum
CREATE TYPE "SignatureValidation" AS ENUM ('PENDING', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "BakpStatus" AS ENUM ('DRAFT', 'PAYMENT_PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUIRED', 'APPROVED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "namaProyek" TEXT NOT NULL,
    "regionalArea" TEXT NOT NULL,
    "lokasiProyek" TEXT NOT NULL,
    "noPO" TEXT NOT NULL,
    "namaPelaksana" TEXT NOT NULL,
    "tanggalPerjanjian" TIMESTAMP(3) NOT NULL,
    "status" "ProjectStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Homepass" (
    "id" BIGSERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL,

    CONSTRAINT "Homepass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL,
    "fileUrl" TEXT,
    "metadata" JSONB,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "assignedToRole" TEXT NOT NULL,
    "currentApprover" TEXT NOT NULL,
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "slaStatus" "SlaStatus" NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "performedBy" TEXT NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SURVEYOR_FTTH',
    "fiberType" "FiberType",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "roles" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapDrawing" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "geojson" JSONB NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentCluster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetHp" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "proposedBudget" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAttachment" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyReport" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "estimatedHP" INTEGER NOT NULL,
    "estimatedPoles" INTEGER NOT NULL,
    "fieldNotes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "surveyedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequest" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "requestedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLog" (
    "id" TEXT NOT NULL,
    "documentRequestId" TEXT NOT NULL,
    "actionBy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IspCustomer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactEmail" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IspCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanList" (
    "id" TEXT NOT NULL,
    "ispCustomer" TEXT NOT NULL,
    "fiberType" "FiberType" NOT NULL,
    "rwCode" TEXT NOT NULL,
    "kelurahan" TEXT NOT NULL,
    "kecamatan" TEXT NOT NULL,
    "kotaKabupaten" TEXT NOT NULL,
    "homepasCount" INTEGER NOT NULL DEFAULT 0,
    "hasExistingFiber" BOOLEAN NOT NULL DEFAULT false,
    "existingOperator" TEXT,
    "existingMarkedAt" TIMESTAMP(3),
    "status" "CleanListStatus" NOT NULL DEFAULT 'AVAILABLE',
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRequest" (
    "id" TEXT NOT NULL,
    "cleanListId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "assignedPmId" TEXT,
    "fiberType" "FiberType" NOT NULL,
    "ispCustomer" TEXT NOT NULL,
    "rtContact" TEXT,
    "rwContact" TEXT,
    "pengelolaContact" TEXT,
    "areaCondition" TEXT,
    "existingNetworkFound" BOOLEAN NOT NULL DEFAULT false,
    "existingOperator" TEXT,
    "stakeholderResponse" "StakeholderResponse" NOT NULL DEFAULT 'PENDING',
    "surveyNotes" TEXT,
    "visitDate" TIMESTAMP(3),
    "evidencePhotos" TEXT[],
    "status" "VisitRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "pmReviewedAt" TIMESTAMP(3),
    "pmReviewedBy" TEXT,
    "pmSeniorApprovedAt" TIMESTAMP(3),
    "pmSeniorApprovedBy" TEXT,
    "adminApprovedAt" TIMESTAMP(3),
    "adminApprovedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaOpen" (
    "id" TEXT NOT NULL,
    "visitRequestId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "status" "BaOpenStatus" NOT NULL DEFAULT 'GENERATED',
    "clusterName" TEXT NOT NULL,
    "rwCode" TEXT NOT NULL,
    "kelurahan" TEXT NOT NULL,
    "ispCustomer" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "surveyorName" TEXT NOT NULL,
    "rtRwName" TEXT,
    "areaDescription" TEXT,
    "stakeholderSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaOpen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitApprovalLog" (
    "id" TEXT NOT NULL,
    "visitRequestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "currentQty" INTEGER NOT NULL DEFAULT 0,
    "minStockQty" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLog" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "type" "StockLogType" NOT NULL,
    "qtyBefore" INTEGER NOT NULL,
    "qtyChange" INTEGER NOT NULL,
    "qtyAfter" INTEGER NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "fiberType" "FiberType" NOT NULL,
    "projectRef" TEXT,
    "notes" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "suratJalanId" TEXT,
    "purchaseRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stockItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "fulfilledQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(15,2),
    "totalPrice" DECIMAL(15,2),

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuratJalan" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "type" "SuratJalanType" NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "status" "SuratJalanStatus" NOT NULL DEFAULT 'GENERATED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuratJalan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "processedBy" TEXT,
    "totalAmount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING',
    "financeNotes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestItem" (
    "id" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemCode" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "unitPrice" DECIMAL(15,2),
    "totalPrice" DECIMAL(15,2),
    "supplierNote" TEXT,

    CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitCluster" (
    "id" TEXT NOT NULL,
    "visitRequestId" TEXT NOT NULL,
    "baOpenId" TEXT NOT NULL,
    "clusterCode" TEXT NOT NULL,
    "ispCustomer" TEXT NOT NULL,
    "fiberType" "FiberType" NOT NULL,
    "assignedPmId" TEXT NOT NULL,
    "currentPhase" "PermitPhase" NOT NULL DEFAULT 'APD_DRAFTING',
    "status" "PermitClusterStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "readyForConstructionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermitCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Apd" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ApdStatus" NOT NULL DEFAULT 'DRAFT',
    "gisRouteData" JSONB,
    "notes" TEXT,
    "drmScheduledAt" TIMESTAMP(3),
    "drmCompletedAt" TIMESTAMP(3),
    "drmNotes" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Apd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApdRevision" (
    "id" TEXT NOT NULL,
    "apdId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,
    "gisData" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApdRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Abd" (
    "id" TEXT NOT NULL,
    "apdId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "AbdStatus" NOT NULL DEFAULT 'DRAFT',
    "gisRouteData" JSONB,
    "fileUrl" TEXT,
    "submittedToIspAt" TIMESTAMP(3),
    "ispFeedback" TEXT,
    "approvedByIspAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Abd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbdRevision" (
    "id" TEXT NOT NULL,
    "abdId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,
    "fileUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbdRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalDiagram" (
    "id" TEXT NOT NULL,
    "abdId" TEXT NOT NULL,
    "type" "TechnicalDiagramType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalDiagram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Socialization" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "conductedBy" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "attendees" JSONB NOT NULL,
    "constructionScope" TEXT,
    "affectedRoutes" TEXT,
    "plannedSchedule" TEXT,
    "communityFeedback" TEXT,
    "agreementStatus" "SocializationAgreement" NOT NULL DEFAULT 'PENDING',
    "baSurveyNumber" TEXT,
    "baSurveyPdfUrl" TEXT,
    "momNumber" TEXT,
    "momPdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3),
    "evidencePhotos" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Socialization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compensation" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "homepasCount" INTEGER NOT NULL,
    "scheme" "CompensationScheme" NOT NULL DEFAULT 'PER_HOMEPASS',
    "proposedAmount" DECIMAL(15,2) NOT NULL,
    "negotiatedAmount" DECIMAL(15,2),
    "finalAmount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "agreementStatus" "CompensationAgreement" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationLog" (
    "id" TEXT NOT NULL,
    "compensationId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "proposedAmount" DECIMAL(15,2) NOT NULL,
    "rtResponse" TEXT NOT NULL,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bak" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "compensationId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "finalAmount" DECIMAL(15,2) NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientBank" TEXT NOT NULL,
    "recipientAccount" TEXT NOT NULL,
    "status" "BakStatus" NOT NULL DEFAULT 'DRAFT',
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "pdfUrl" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureRecord" (
    "id" TEXT NOT NULL,
    "bakId" TEXT NOT NULL,
    "signatoryName" TEXT NOT NULL,
    "signatoryNik" TEXT NOT NULL,
    "signatoryRole" TEXT NOT NULL,
    "ktpPhotoUrl" TEXT,
    "signatureUrl" TEXT,
    "hasStamp" BOOLEAN NOT NULL DEFAULT false,
    "validationStatus" "SignatureValidation" NOT NULL DEFAULT 'PENDING',
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scom" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "conductedBy" TEXT NOT NULL,
    "conductedAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "attendees" JSONB NOT NULL,
    "agreementPoints" JSONB NOT NULL,
    "workingHours" TEXT,
    "safetyRules" TEXT,
    "cleanlinessRules" TEXT,
    "momNumber" TEXT,
    "momPdfUrl" TEXT,
    "pksSignedUrl" TEXT,
    "generatedAt" TIMESTAMP(3),
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bakp" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" "BakpStatus" NOT NULL DEFAULT 'DRAFT',
    "hasBAOpen" BOOLEAN NOT NULL DEFAULT false,
    "hasBASurvey" BOOLEAN NOT NULL DEFAULT false,
    "hasBASocialization" BOOLEAN NOT NULL DEFAULT false,
    "hasApprovedBAK" BOOLEAN NOT NULL DEFAULT false,
    "hasSignedBAK" BOOLEAN NOT NULL DEFAULT false,
    "hasRtRwKtp" BOOLEAN NOT NULL DEFAULT false,
    "hasRtRwSk" BOOLEAN NOT NULL DEFAULT false,
    "hasSip" BOOLEAN NOT NULL DEFAULT false,
    "hasPks" BOOLEAN NOT NULL DEFAULT false,
    "hasReceipt" BOOLEAN NOT NULL DEFAULT false,
    "hasTransferProof" BOOLEAN NOT NULL DEFAULT false,
    "hasPaymentPhoto" BOOLEAN NOT NULL DEFAULT false,
    "transferProofUrl" TEXT,
    "receiptUrl" TEXT,
    "paymentPhotoUrl" TEXT,
    "paymentAmount" DECIMAL(15,2),
    "paymentDate" TIMESTAMP(3),
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "validationNotes" TEXT,
    "rejectionReason" TEXT,
    "bundlePdfUrl" TEXT,
    "compiledAt" TIMESTAMP(3),
    "compiledBy" TEXT,
    "manualDocUrls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bakp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitEmailLog" (
    "id" TEXT NOT NULL,
    "permitClusterId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodySummary" TEXT,
    "sentByUserId" TEXT NOT NULL,
    "documentsAttached" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermitEmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE INDEX "Homepass_geom_idx" ON "Homepass" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentNumber_key" ON "Document"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_featureKey_key" ON "FeatureFlag"("featureKey");

-- CreateIndex
CREATE INDEX "FeatureFlag_featureKey_idx" ON "FeatureFlag"("featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentCluster_code_key" ON "DeploymentCluster"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyReport_clusterId_key" ON "SurveyReport"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequest_clusterId_key" ON "DocumentRequest"("clusterId");

-- CreateIndex
CREATE UNIQUE INDEX "IspCustomer_name_key" ON "IspCustomer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "IspCustomer_code_key" ON "IspCustomer"("code");

-- CreateIndex
CREATE INDEX "CleanList_ispCustomer_idx" ON "CleanList"("ispCustomer");

-- CreateIndex
CREATE INDEX "CleanList_fiberType_idx" ON "CleanList"("fiberType");

-- CreateIndex
CREATE INDEX "CleanList_status_idx" ON "CleanList"("status");

-- CreateIndex
CREATE INDEX "CleanList_rwCode_kelurahan_idx" ON "CleanList"("rwCode", "kelurahan");

-- CreateIndex
CREATE INDEX "VisitRequest_status_idx" ON "VisitRequest"("status");

-- CreateIndex
CREATE INDEX "VisitRequest_fiberType_idx" ON "VisitRequest"("fiberType");

-- CreateIndex
CREATE INDEX "VisitRequest_requestedBy_idx" ON "VisitRequest"("requestedBy");

-- CreateIndex
CREATE UNIQUE INDEX "BaOpen_visitRequestId_key" ON "BaOpen"("visitRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "BaOpen_documentNumber_key" ON "BaOpen"("documentNumber");

-- CreateIndex
CREATE INDEX "BaOpen_status_idx" ON "BaOpen"("status");

-- CreateIndex
CREATE INDEX "BaOpen_documentNumber_idx" ON "BaOpen"("documentNumber");

-- CreateIndex
CREATE INDEX "VisitApprovalLog_visitRequestId_idx" ON "VisitApprovalLog"("visitRequestId");

-- CreateIndex
CREATE INDEX "VisitApprovalLog_actorId_idx" ON "VisitApprovalLog"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_code_key" ON "StockItem"("code");

-- CreateIndex
CREATE INDEX "StockItem_name_idx" ON "StockItem"("name");

-- CreateIndex
CREATE INDEX "StockItem_category_idx" ON "StockItem"("category");

-- CreateIndex
CREATE INDEX "StockItem_code_idx" ON "StockItem"("code");

-- CreateIndex
CREATE INDEX "StockLog_stockItemId_idx" ON "StockLog"("stockItemId");

-- CreateIndex
CREATE INDEX "StockLog_type_idx" ON "StockLog"("type");

-- CreateIndex
CREATE INDEX "StockLog_createdAt_idx" ON "StockLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_suratJalanId_key" ON "Order"("suratJalanId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_purchaseRequestId_key" ON "Order"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdBy_idx" ON "Order"("createdBy");

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SuratJalan_documentNumber_key" ON "SuratJalan"("documentNumber");

-- CreateIndex
CREATE INDEX "SuratJalan_type_idx" ON "SuratJalan"("type");

-- CreateIndex
CREATE INDEX "SuratJalan_status_idx" ON "SuratJalan"("status");

-- CreateIndex
CREATE INDEX "SuratJalan_documentNumber_idx" ON "SuratJalan"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_requestNumber_key" ON "PurchaseRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_requestedBy_idx" ON "PurchaseRequest"("requestedBy");

-- CreateIndex
CREATE INDEX "PurchaseRequestItem_purchaseRequestId_idx" ON "PurchaseRequestItem"("purchaseRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PermitCluster_visitRequestId_key" ON "PermitCluster"("visitRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PermitCluster_baOpenId_key" ON "PermitCluster"("baOpenId");

-- CreateIndex
CREATE INDEX "PermitCluster_status_idx" ON "PermitCluster"("status");

-- CreateIndex
CREATE INDEX "PermitCluster_fiberType_idx" ON "PermitCluster"("fiberType");

-- CreateIndex
CREATE INDEX "PermitCluster_currentPhase_idx" ON "PermitCluster"("currentPhase");

-- CreateIndex
CREATE UNIQUE INDEX "Apd_permitClusterId_key" ON "Apd"("permitClusterId");

-- CreateIndex
CREATE INDEX "Apd_status_idx" ON "Apd"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Abd_apdId_key" ON "Abd"("apdId");

-- CreateIndex
CREATE INDEX "Abd_status_idx" ON "Abd"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Socialization_permitClusterId_key" ON "Socialization"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Socialization_baSurveyNumber_key" ON "Socialization"("baSurveyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Socialization_momNumber_key" ON "Socialization"("momNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Compensation_permitClusterId_key" ON "Compensation"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Bak_permitClusterId_key" ON "Bak"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Bak_compensationId_key" ON "Bak"("compensationId");

-- CreateIndex
CREATE UNIQUE INDEX "Bak_documentNumber_key" ON "Bak"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Scom_permitClusterId_key" ON "Scom"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Scom_momNumber_key" ON "Scom"("momNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Bakp_permitClusterId_key" ON "Bakp"("permitClusterId");

-- CreateIndex
CREATE UNIQUE INDEX "Bakp_documentNumber_key" ON "Bakp"("documentNumber");

-- CreateIndex
CREATE INDEX "PermitEmailLog_permitClusterId_idx" ON "PermitEmailLog"("permitClusterId");

-- AddForeignKey
ALTER TABLE "Homepass" ADD CONSTRAINT "Homepass_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAttachment" ADD CONSTRAINT "LegalAttachment_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "DeploymentCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyReport" ADD CONSTRAINT "SurveyReport_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "DeploymentCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "DeploymentCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_documentRequestId_fkey" FOREIGN KEY ("documentRequestId") REFERENCES "DocumentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IspCustomer" ADD CONSTRAINT "IspCustomer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanList" ADD CONSTRAINT "CleanList_importedBy_fkey" FOREIGN KEY ("importedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_cleanListId_fkey" FOREIGN KEY ("cleanListId") REFERENCES "CleanList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_assignedPmId_fkey" FOREIGN KEY ("assignedPmId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaOpen" ADD CONSTRAINT "BaOpen_visitRequestId_fkey" FOREIGN KEY ("visitRequestId") REFERENCES "VisitRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaOpen" ADD CONSTRAINT "BaOpen_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitApprovalLog" ADD CONSTRAINT "VisitApprovalLog_visitRequestId_fkey" FOREIGN KEY ("visitRequestId") REFERENCES "VisitRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitApprovalLog" ADD CONSTRAINT "VisitApprovalLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLog" ADD CONSTRAINT "StockLog_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLog" ADD CONSTRAINT "StockLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_suratJalanId_fkey" FOREIGN KEY ("suratJalanId") REFERENCES "SuratJalan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuratJalan" ADD CONSTRAINT "SuratJalan_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuratJalan" ADD CONSTRAINT "SuratJalan_confirmedBy_fkey" FOREIGN KEY ("confirmedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_processedBy_fkey" FOREIGN KEY ("processedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitCluster" ADD CONSTRAINT "PermitCluster_visitRequestId_fkey" FOREIGN KEY ("visitRequestId") REFERENCES "VisitRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitCluster" ADD CONSTRAINT "PermitCluster_baOpenId_fkey" FOREIGN KEY ("baOpenId") REFERENCES "BaOpen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitCluster" ADD CONSTRAINT "PermitCluster_assignedPmId_fkey" FOREIGN KEY ("assignedPmId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apd" ADD CONSTRAINT "Apd_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apd" ADD CONSTRAINT "Apd_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Apd" ADD CONSTRAINT "Apd_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApdRevision" ADD CONSTRAINT "ApdRevision_apdId_fkey" FOREIGN KEY ("apdId") REFERENCES "Apd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApdRevision" ADD CONSTRAINT "ApdRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Abd" ADD CONSTRAINT "Abd_apdId_fkey" FOREIGN KEY ("apdId") REFERENCES "Apd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Abd" ADD CONSTRAINT "Abd_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Abd" ADD CONSTRAINT "Abd_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbdRevision" ADD CONSTRAINT "AbdRevision_abdId_fkey" FOREIGN KEY ("abdId") REFERENCES "Abd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbdRevision" ADD CONSTRAINT "AbdRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDiagram" ADD CONSTRAINT "TechnicalDiagram_abdId_fkey" FOREIGN KEY ("abdId") REFERENCES "Abd"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalDiagram" ADD CONSTRAINT "TechnicalDiagram_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Socialization" ADD CONSTRAINT "Socialization_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Socialization" ADD CONSTRAINT "Socialization_conductedBy_fkey" FOREIGN KEY ("conductedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compensation" ADD CONSTRAINT "Compensation_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compensation" ADD CONSTRAINT "Compensation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationLog" ADD CONSTRAINT "NegotiationLog_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "Compensation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationLog" ADD CONSTRAINT "NegotiationLog_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bak" ADD CONSTRAINT "Bak_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bak" ADD CONSTRAINT "Bak_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "Compensation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bak" ADD CONSTRAINT "Bak_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bak" ADD CONSTRAINT "Bak_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_bakId_fkey" FOREIGN KEY ("bakId") REFERENCES "Bak"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRecord" ADD CONSTRAINT "SignatureRecord_validatedBy_fkey" FOREIGN KEY ("validatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scom" ADD CONSTRAINT "Scom_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scom" ADD CONSTRAINT "Scom_conductedBy_fkey" FOREIGN KEY ("conductedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scom" ADD CONSTRAINT "Scom_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bakp" ADD CONSTRAINT "Bakp_permitClusterId_fkey" FOREIGN KEY ("permitClusterId") REFERENCES "PermitCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bakp" ADD CONSTRAINT "Bakp_validatedBy_fkey" FOREIGN KEY ("validatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bakp" ADD CONSTRAINT "Bakp_compiledBy_fkey" FOREIGN KEY ("compiledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
