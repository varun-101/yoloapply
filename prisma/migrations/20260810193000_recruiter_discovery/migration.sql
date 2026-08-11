-- User-specific recruiter geography is independent of job-discovery filters.
ALTER TABLE "UserProfile" ADD COLUMN "recruiterLocation" TEXT;

-- Existing domain-only rows remain readable under a legacy intent key. New
-- searches use a user + domain + location hash and no longer share failures.
ALTER TABLE "CompanyContactCache"
  ADD COLUMN "intentKey" TEXT,
  ADD COLUMN "ownerUserId" TEXT,
  ADD COLUMN "searchLocation" TEXT;

UPDATE "CompanyContactCache" SET "intentKey" = 'legacy:' || "domain" WHERE "intentKey" IS NULL;
ALTER TABLE "CompanyContactCache" ALTER COLUMN "intentKey" SET NOT NULL;
DROP INDEX IF EXISTS "CompanyContactCache_domain_key";
CREATE UNIQUE INDEX "CompanyContactCache_intentKey_key" ON "CompanyContactCache"("intentKey");
CREATE INDEX "CompanyContactCache_ownerUserId_domain_idx" ON "CompanyContactCache"("ownerUserId", "domain");

ALTER TABLE "DiscoveredContact"
  ADD COLUMN "location" TEXT,
  ADD COLUMN "providerPersonId" TEXT,
  ADD COLUMN "contactStatus" TEXT NOT NULL DEFAULT 'not_requested';
