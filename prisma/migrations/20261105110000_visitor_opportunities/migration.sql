CREATE TABLE "VisitorCategory" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "includeRules" TEXT NOT NULL, "excludeRules" TEXT NOT NULL, "keywords" JSONB NOT NULL, "area" TEXT NOT NULL, "priority" TEXT NOT NULL, "reviewFlag" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "updatedAt" DATETIME NOT NULL);
CREATE TABLE "VisitorBusiness" ("id" TEXT NOT NULL PRIMARY KEY, "identityKey" TEXT NOT NULL, "name" TEXT NOT NULL, "website" TEXT, "phone" TEXT, "status" TEXT NOT NULL DEFAULT 'not contacted', "reviewNote" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "VisitorBusiness_identityKey_key" ON "VisitorBusiness"("identityKey");
CREATE TABLE "VisitorEvidence" ("id" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL, "postId" TEXT NOT NULL, "categoryId" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "matchedTerms" JSONB NOT NULL, "geographyEvidence" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "VisitorEvidence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "VisitorBusiness" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "VisitorEvidence_postId_categoryId_key" ON "VisitorEvidence"("postId", "categoryId");
CREATE INDEX "VisitorEvidence_businessId_idx" ON "VisitorEvidence"("businessId");
CREATE TABLE "VisitorExclusion" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "company" TEXT NOT NULL, "reason" TEXT NOT NULL, "status" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true);

CREATE TABLE "VisitorIdentity" ("key" TEXT NOT NULL PRIMARY KEY, "businessId" TEXT NOT NULL, CONSTRAINT "VisitorIdentity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "VisitorBusiness" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
