ALTER TABLE "PostAiAssessment" ADD COLUMN "provider" TEXT;
ALTER TABLE "PostAiAssessment" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "PostAiAssessment" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "PostAiAssessment" ADD COLUMN "totalTokens" INTEGER;
ALTER TABLE "PostAiAssessment" ADD COLUMN "estimatedCostUsd" REAL;
ALTER TABLE "PostAiAssessment" ADD COLUMN "durationMs" INTEGER;
