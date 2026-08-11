-- AlterTable
ALTER TABLE "ApplicationAnalysis" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ApplicationTask" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "UserPromptSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voice" TEXT,
    "resume" TEXT,
    "coldEmail" TEXT,
    "coverLetter" TEXT,
    "answers" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPromptSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPromptSetting_userId_key" ON "UserPromptSetting"("userId");

-- AddForeignKey
ALTER TABLE "UserPromptSetting" ADD CONSTRAINT "UserPromptSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
