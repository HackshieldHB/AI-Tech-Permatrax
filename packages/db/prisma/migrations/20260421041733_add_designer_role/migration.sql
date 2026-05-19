-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DESIGNER';

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "updatedAt" DROP DEFAULT;
