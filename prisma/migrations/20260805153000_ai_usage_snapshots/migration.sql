-- AlterTable
ALTER TABLE "PostAiAssessment" ADD COLUMN "cachedInputTokens" INTEGER;
ALTER TABLE "PostAiAssessment" ADD COLUMN "requestCount" INTEGER;
ALTER TABLE "PostAiAssessment" ADD COLUMN "pricingSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "PostAiAssessment_provider_model_idx" ON "PostAiAssessment"("provider", "model");

-- CreateIndex
CREATE INDEX "PostAiAssessment_createdAt_idx" ON "PostAiAssessment"("createdAt");
