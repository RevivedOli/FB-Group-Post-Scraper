-- AlterTable
ALTER TABLE "ReferralMember" ADD COLUMN "servicesOffered" TEXT;
ALTER TABLE "ReferralMember" ADD COLUMN "idealReferral" TEXT;
ALTER TABLE "ReferralMember" ADD COLUMN "negativeKeywords" TEXT;

-- CreateTable
CREATE TABLE "PostAiAssessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "promptText" TEXT,
    "rawResponse" JSONB,
    "parsed" JSONB,
    "intent" TEXT,
    "isReferralOpportunity" BOOLEAN,
    "confidence" REAL,
    "summary" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PostAiAssessment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiMemberMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "referralMemberId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "scorePercent" TEXT NOT NULL,
    "reason" TEXT,
    "suggestedIntro" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMemberMatch_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "PostAiAssessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiMemberMatch_referralMemberId_fkey" FOREIGN KEY ("referralMemberId") REFERENCES "ReferralMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PostAiAssessment_postId_idx" ON "PostAiAssessment"("postId");

-- CreateIndex
CREATE INDEX "PostAiAssessment_status_idx" ON "PostAiAssessment"("status");

-- CreateIndex
CREATE INDEX "PostAiAssessment_promptVersion_idx" ON "PostAiAssessment"("promptVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AiMemberMatch_assessmentId_referralMemberId_key" ON "AiMemberMatch"("assessmentId", "referralMemberId");

-- CreateIndex
CREATE INDEX "AiMemberMatch_referralMemberId_idx" ON "AiMemberMatch"("referralMemberId");
