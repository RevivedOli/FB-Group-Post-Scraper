-- AlterTable
ALTER TABLE "PostAiAssessment" ADD COLUMN "renderedPrompt" TEXT;
ALTER TABLE "PostAiAssessment" ADD COLUMN "inputPayload" JSONB;
