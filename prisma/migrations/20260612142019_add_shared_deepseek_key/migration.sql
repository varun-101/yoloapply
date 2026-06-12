-- CreateTable
CREATE TABLE "SharedDeepseekKey" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "keyEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedDeepseekKey_pkey" PRIMARY KEY ("id")
);
