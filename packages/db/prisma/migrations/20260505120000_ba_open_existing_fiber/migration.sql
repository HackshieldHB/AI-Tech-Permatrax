-- Issue #46: flag BA Open when visit was approved with existing network on site
ALTER TABLE "BaOpen" ADD COLUMN     "existingFiber" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "existingOperator" TEXT;
