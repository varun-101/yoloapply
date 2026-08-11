-- CreateTable
CREATE TABLE "AutoApplyRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "applyUrl" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'auto_submit',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoApplyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoApplyRun_userId_status_idx" ON "AutoApplyRun"("userId", "status");

-- CreateIndex
CREATE INDEX "AutoApplyRun_userId_startedAt_idx" ON "AutoApplyRun"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "AutoApplyRun" ADD CONSTRAINT "AutoApplyRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoApplyRun" ADD CONSTRAINT "AutoApplyRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
