-- FIX: Notification inbox fields + User FK (updatedAt defaulted for existing rows)

ALTER TABLE "Notification" ADD COLUMN "entityId" TEXT,
ADD COLUMN "readAt" TIMESTAMP(3),
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "userRole" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");
CREATE INDEX "Notification_userRole_isRead_idx" ON "Notification"("userRole", "isRead");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
