/*
  Warnings:

  - Added the required column `runType` to the `ScrapeRun` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScrapeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "postsInspected" INTEGER NOT NULL DEFAULT 0,
    "newPostsSaved" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ScrapeRun" ("createdAt", "id", "status", "updatedAt") SELECT "createdAt", "id", "status", "updatedAt" FROM "ScrapeRun";
DROP TABLE "ScrapeRun";
ALTER TABLE "new_ScrapeRun" RENAME TO "ScrapeRun";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
