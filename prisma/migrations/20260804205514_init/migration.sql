-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "facebookGroupUrl" TEXT NOT NULL,
    "canonicalGroupUrl" TEXT NOT NULL,
    "facebookGroupId" TEXT,
    "friendlyName" TEXT NOT NULL,
    "detectedName" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL,
    "baselineStatus" TEXT NOT NULL DEFAULT 'never_scanned',
    "baselineCompletedAt" DATETIME,
    "lastSuccessfulMonitorAt" DATETIME,
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "maxPostsPerRun" INTEGER,
    "maxScrollActions" INTEGER,
    "maxGroupDurationSeconds" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "facebookPostId" TEXT,
    "canonicalPostUrl" TEXT NOT NULL,
    "firstCapturedText" TEXT,
    "latestCapturedText" TEXT,
    "originalTimestampLabel" TEXT,
    "originalPostedAt" DATETIME,
    "firstDiscoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasImages" BOOLEAN NOT NULL DEFAULT false,
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

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScrapeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scrapeRunId" TEXT,
    "level" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "technicalDetail" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "requestedPostIds" JSONB,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_canonicalGroupUrl_key" ON "Group"("canonicalGroupUrl");

-- CreateIndex
CREATE UNIQUE INDEX "Post_canonicalPostUrl_key" ON "Post"("canonicalPostUrl");
