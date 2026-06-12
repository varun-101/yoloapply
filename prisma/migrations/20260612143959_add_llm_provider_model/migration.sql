-- AlterTable
ALTER TABLE "SharedDeepseekKey" ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "llmProvider" TEXT NOT NULL DEFAULT 'deepseek';

-- AlterTable
ALTER TABLE "UserCredential" ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "llmProvider" TEXT NOT NULL DEFAULT 'deepseek';
