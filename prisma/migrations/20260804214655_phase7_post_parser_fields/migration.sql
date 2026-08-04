-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "facebookPostId" TEXT,
    "canonicalPostUrl" TEXT NOT NULL,
    "authorName" TEXT,
    "firstCapturedText" TEXT,
    "latestCapturedText" TEXT,
    "originalTimestampLabel" TEXT,
    "originalPostedAt" DATETIME,
    "firstDiscoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasImages" BOOLEAN NOT NULL DEFAULT false,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "ocrStatus" TEXT NOT NULL DEFAULT 'disabled',
    "ocrText" TEXT,
    "analysisStatus" TEXT NOT NULL DEFAULT 'not_analysed',
    "reviewStatus" TEXT NOT NULL DEFAULT 'new',
    "monitoringStatus" TEXT NOT NULL DEFAULT 'active',
    "extractionStrategy" TEXT,
    "extractionConfidence" REAL,
    "fieldWarnings" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("analysisStatus", "canonicalPostUrl", "createdAt", "extractionConfidence", "extractionStrategy", "facebookPostId", "fieldWarnings", "firstCapturedText", "firstDiscoveredAt", "groupId", "hasImages", "id", "lastObservedAt", "latestCapturedText", "monitoringStatus", "ocrStatus", "ocrText", "originalPostedAt", "originalTimestampLabel", "reviewStatus", "updatedAt") SELECT "analysisStatus", "canonicalPostUrl", "createdAt", "extractionConfidence", "extractionStrategy", "facebookPostId", "fieldWarnings", "firstCapturedText", "firstDiscoveredAt", "groupId", "hasImages", "id", "lastObservedAt", "latestCapturedText", "monitoringStatus", "ocrStatus", "ocrText", "originalPostedAt", "originalTimestampLabel", "reviewStatus", "updatedAt" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE UNIQUE INDEX "Post_canonicalPostUrl_key" ON "Post"("canonicalPostUrl");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
