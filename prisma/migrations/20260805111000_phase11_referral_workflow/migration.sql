-- AlterTable
ALTER TABLE "ReferralMember" ADD COLUMN "facebookName" TEXT;
ALTER TABLE "ReferralMember" ADD COLUMN "facebookProfileUrl" TEXT;

-- AlterTable
ALTER TABLE "AiMemberMatch" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "AiMemberMatch" ADD COLUMN "copiedAt" DATETIME;
ALTER TABLE "AiMemberMatch" ADD COLUMN "introducedAt" DATETIME;
ALTER TABLE "AiMemberMatch" ADD COLUMN "dismissedAt" DATETIME;
ALTER TABLE "AiMemberMatch" ADD COLUMN "note" TEXT;
