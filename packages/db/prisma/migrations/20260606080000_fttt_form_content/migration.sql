-- FtttDocument: make fileUrl nullable (form-generated docs have no physical file)
-- and add formContent for JSON form data
ALTER TABLE "FtttDocument" ALTER COLUMN "fileUrl" DROP NOT NULL;
ALTER TABLE "FtttDocument" ADD COLUMN IF NOT EXISTS "formContent" TEXT;

-- FtttReconDoc: add formContent
ALTER TABLE "FtttReconDoc" ADD COLUMN IF NOT EXISTS "formContent" TEXT;

-- FtttClosingLog: add formContent
ALTER TABLE "FtttClosingLog" ADD COLUMN IF NOT EXISTS "formContent" TEXT;
