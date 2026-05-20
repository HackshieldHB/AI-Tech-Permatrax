-- Add missing User.signatureUrl column
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signatureUrl" TEXT;
