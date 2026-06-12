-- DropForeignKey
ALTER TABLE "JobLead" DROP CONSTRAINT "JobLead_scanRunId_fkey";

-- DropForeignKey
ALTER TABLE "JobLead" DROP CONSTRAINT "JobLead_userId_fkey";

-- DropIndex
DROP INDEX "JobLead_scanRunId_idx";

-- DropIndex
DROP INDEX "JobLead_userId_canonicalUrl_idx";

-- DropIndex
DROP INDEX "JobLead_userId_source_externalId_key";

-- DropIndex
DROP INDEX "JobLead_userId_status_postedAt_idx";

-- AlterTable
ALTER TABLE "JobLead" DROP COLUMN "applicationId",
DROP COLUMN "scanRunId",
DROP COLUMN "score",
DROP COLUMN "scoreReason",
DROP COLUMN "status",
DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "SearchPreference" ADD COLUMN     "scoreMaxPerScan" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "scoreRecencyDays" INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canScan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobLeadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "applicationId" TEXT,
    "score" INTEGER,
    "scoreReason" TEXT,
    "scanRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserLead_userId_status_idx" ON "UserLead"("userId", "status");

-- CreateIndex
CREATE INDEX "UserLead_scanRunId_idx" ON "UserLead"("scanRunId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLead_userId_jobLeadId_key" ON "UserLead"("userId", "jobLeadId");

-- CreateIndex
CREATE INDEX "JobLead_canonicalUrl_idx" ON "JobLead"("canonicalUrl");

-- CreateIndex
CREATE INDEX "JobLead_postedAt_idx" ON "JobLead"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobLead_source_externalId_key" ON "JobLead"("source", "externalId");

-- AddForeignKey
ALTER TABLE "UserLead" ADD CONSTRAINT "UserLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLead" ADD CONSTRAINT "UserLead_jobLeadId_fkey" FOREIGN KEY ("jobLeadId") REFERENCES "JobLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLead" ADD CONSTRAINT "UserLead_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "ScanRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

