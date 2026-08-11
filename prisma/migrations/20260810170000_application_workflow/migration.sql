-- CreateEnum
CREATE TYPE "ApplicationTaskKey" AS ENUM (
  'PARSE_JOB',
  'ANALYZE_MATCH',
  'GENERATE_RESUME',
  'FIND_RECRUITER',
  'GENERATE_OUTREACH',
  'PREPARE_APPLICATION',
  'SEND_OUTREACH',
  'FOLLOW_UP'
);

-- CreateEnum
CREATE TYPE "ApplicationTaskStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'NEEDS_REVIEW'
);

-- CreateEnum
CREATE TYPE "MatchCategory" AS ENUM ('STRONG_MATCH', 'GOOD_MATCH', 'LOW_MATCH', 'NOT_ELIGIBLE');

-- CreateEnum
CREATE TYPE "MatchRecommendation" AS ENUM ('APPLY', 'REVIEW', 'SKIP');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "applicationAnswers" JSONB NOT NULL DEFAULT '{}';

-- Disable the legacy worker's automatic-submit default. Current automation
-- prepares forms and requires the candidate to submit explicitly.
ALTER TABLE "AutoApplyRun" ALTER COLUMN "mode" SET DEFAULT 'fill_only';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "metadata" JSONB;

-- AlterTable
ALTER TABLE "Email"
  ADD COLUMN "threadId" TEXT,
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'smtp',
  ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "UserCredential" ADD COLUMN "signalhireKeyEnc" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "DiscoveredContact" ADD COLUMN "phone" TEXT;

-- AlterTable
ALTER TABLE "Application"
  ADD COLUMN "canonicalUrl" TEXT,
  ADD COLUMN "rawJdText" TEXT;

-- CreateTable
CREATE TABLE "ApplicationTask" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "key" "ApplicationTaskKey" NOT NULL,
  "status" "ApplicationTaskStatus" NOT NULL DEFAULT 'PENDING',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApplicationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationAnalysis" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "category" "MatchCategory" NOT NULL,
  "recommendation" "MatchRecommendation" NOT NULL,
  "summary" TEXT NOT NULL,
  "strengths" JSONB NOT NULL DEFAULT '[]',
  "gaps" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApplicationAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationTask_applicationId_key_key" ON "ApplicationTask"("applicationId", "key");

-- CreateIndex
CREATE INDEX "ApplicationTask_applicationId_status_idx" ON "ApplicationTask"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationAnalysis_applicationId_key" ON "ApplicationAnalysis"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_idempotencyKey_key" ON "Email"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Application_userId_canonicalUrl_key" ON "Application"("userId", "canonicalUrl");

-- AddForeignKey
ALTER TABLE "ApplicationTask" ADD CONSTRAINT "ApplicationTask_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationAnalysis" ADD CONSTRAINT "ApplicationAnalysis_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill workflow rows from artifacts that already exist. Deterministic ids
-- avoid requiring a database-side cuid generator during migration.
INSERT INTO "ApplicationTask" ("id", "applicationId", "key", "status", "required", "completedAt")
SELECT
  a."id" || ':' || task.key,
  a."id",
  task.key::"ApplicationTaskKey",
  CASE
    WHEN task.key = 'PARSE_JOB' AND length(trim(coalesce(a."jdText", ''))) >= 50 THEN 'SUCCESS'::"ApplicationTaskStatus"
    WHEN task.key = 'GENERATE_RESUME' AND EXISTS (
      SELECT 1 FROM "StoredFile" f WHERE f."applicationId" = a."id" AND f."kind" = 'resume_pdf'
    ) THEN 'SUCCESS'::"ApplicationTaskStatus"
    WHEN task.key = 'FIND_RECRUITER' AND EXISTS (
      SELECT 1 FROM "Contact" c WHERE c."applicationId" = a."id"
    ) THEN 'SUCCESS'::"ApplicationTaskStatus"
    WHEN task.key = 'GENERATE_OUTREACH' AND EXISTS (
      SELECT 1 FROM "Email" e WHERE e."applicationId" = a."id"
    ) THEN 'SUCCESS'::"ApplicationTaskStatus"
    WHEN task.key = 'SEND_OUTREACH' AND EXISTS (
      SELECT 1 FROM "Email" e WHERE e."applicationId" = a."id" AND e."status" = 'sent'
    ) THEN 'SUCCESS'::"ApplicationTaskStatus"
    ELSE 'PENDING'::"ApplicationTaskStatus"
  END,
  CASE WHEN task.key IN ('PREPARE_APPLICATION', 'SEND_OUTREACH', 'FOLLOW_UP') THEN false ELSE true END,
  CASE
    WHEN task.key = 'PARSE_JOB' AND length(trim(coalesce(a."jdText", ''))) >= 50 THEN CURRENT_TIMESTAMP
    WHEN task.key = 'GENERATE_RESUME' AND EXISTS (
      SELECT 1 FROM "StoredFile" f WHERE f."applicationId" = a."id" AND f."kind" = 'resume_pdf'
    ) THEN CURRENT_TIMESTAMP
    WHEN task.key = 'FIND_RECRUITER' AND EXISTS (
      SELECT 1 FROM "Contact" c WHERE c."applicationId" = a."id"
    ) THEN CURRENT_TIMESTAMP
    WHEN task.key = 'GENERATE_OUTREACH' AND EXISTS (
      SELECT 1 FROM "Email" e WHERE e."applicationId" = a."id"
    ) THEN CURRENT_TIMESTAMP
    WHEN task.key = 'SEND_OUTREACH' AND EXISTS (
      SELECT 1 FROM "Email" e WHERE e."applicationId" = a."id" AND e."status" = 'sent'
    ) THEN CURRENT_TIMESTAMP
    ELSE NULL
  END
FROM "Application" a
CROSS JOIN (
  VALUES
    ('PARSE_JOB'),
    ('ANALYZE_MATCH'),
    ('GENERATE_RESUME'),
    ('FIND_RECRUITER'),
    ('GENERATE_OUTREACH'),
    ('PREPARE_APPLICATION'),
    ('SEND_OUTREACH'),
    ('FOLLOW_UP')
) AS task(key)
ON CONFLICT ("applicationId", "key") DO NOTHING;

-- Follow-up scheduling is linked to the initial outreach email. Sending is a
-- separate Email row so SMTP retries and timeline state remain auditable.
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'DUE', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

ALTER TABLE "UserProfile" ADD COLUMN "followUpDelayDays" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "originalEmailId" TEXT NOT NULL,
    "sentEmailId" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowUp_originalEmailId_key" ON "FollowUp"("originalEmailId");
CREATE UNIQUE INDEX "FollowUp_sentEmailId_key" ON "FollowUp"("sentEmailId");
CREATE INDEX "FollowUp_status_scheduledFor_idx" ON "FollowUp"("status", "scheduledFor");
CREATE INDEX "FollowUp_applicationId_idx" ON "FollowUp"("applicationId");

ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_originalEmailId_fkey"
  FOREIGN KEY ("originalEmailId") REFERENCES "Email"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sentEmailId_fkey"
  FOREIGN KEY ("sentEmailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Resumable batches only orchestrate preparation APIs. They never submit an
-- ATS form or send outreach.
CREATE TYPE "ReplyClassification" AS ENUM ('INTERVIEW', 'ASSESSMENT', 'REJECTION', 'REQUEST_INFO', 'FOLLOW_UP', 'OTHER');
CREATE TYPE "ApplicationBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'CANCELLED');
CREATE TYPE "ApplicationBatchItemStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');
CREATE TYPE "BatchOperation" AS ENUM ('ANALYZE_MATCH', 'GENERATE_RESUME', 'FIND_RECRUITER');

CREATE TABLE "InboundReply" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "emailId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerMessageId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" "ReplyClassification" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboundReply_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ApplicationBatchStatus" NOT NULL DEFAULT 'PENDING',
    "operations" "BatchOperation"[],
    "maxConcurrency" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "ApplicationBatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" "BatchOperation",
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicationBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundReply_provider_providerMessageId_key" ON "InboundReply"("provider", "providerMessageId");
CREATE INDEX "InboundReply_applicationId_receivedAt_idx" ON "InboundReply"("applicationId", "receivedAt");
CREATE INDEX "ApplicationBatch_userId_createdAt_idx" ON "ApplicationBatch"("userId", "createdAt");
CREATE UNIQUE INDEX "ApplicationBatchItem_batchId_applicationId_key" ON "ApplicationBatchItem"("batchId", "applicationId");
CREATE INDEX "ApplicationBatchItem_applicationId_idx" ON "ApplicationBatchItem"("applicationId");

ALTER TABLE "InboundReply" ADD CONSTRAINT "InboundReply_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundReply" ADD CONSTRAINT "InboundReply_emailId_fkey"
  FOREIGN KEY ("emailId") REFERENCES "Email"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApplicationBatch" ADD CONSTRAINT "ApplicationBatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationBatchItem" ADD CONSTRAINT "ApplicationBatchItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ApplicationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationBatchItem" ADD CONSTRAINT "ApplicationBatchItem_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
