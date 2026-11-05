CREATE TABLE "NotificationDelivery" (
 "id" TEXT NOT NULL PRIMARY KEY, "postId" TEXT NOT NULL, "referralMemberId" TEXT NOT NULL,
 "channel" TEXT NOT NULL DEFAULT 'telegram', "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimedAt" DATETIME,
 "sentAt" DATETIME, "messageId" TEXT, "errorMessage" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "NotificationDelivery_postId_referralMemberId_channel_key" ON "NotificationDelivery"("postId", "referralMemberId", "channel");
CREATE INDEX "NotificationDelivery_status_availableAt_idx" ON "NotificationDelivery"("status", "availableAt");
