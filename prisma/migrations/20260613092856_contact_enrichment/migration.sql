-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifyMethod" TEXT;

-- AlterTable
ALTER TABLE "UserCredential" ADD COLUMN     "apolloKeyEnc" TEXT,
ADD COLUMN     "searchKeyEnc" TEXT;

-- CreateTable
CREATE TABLE "CompanyContactCache" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "company" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "pattern" TEXT,
    "sourceStats" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "enrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContactCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredContact" (
    "id" TEXT NOT NULL,
    "cacheId" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "email" TEXT,
    "linkedinUrl" TEXT,
    "source" TEXT NOT NULL,
    "sources" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyMethod" TEXT,
    "seniorityRank" INTEGER NOT NULL DEFAULT 0,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContactCache_domain_key" ON "CompanyContactCache"("domain");

-- CreateIndex
CREATE INDEX "DiscoveredContact_cacheId_idx" ON "DiscoveredContact"("cacheId");

-- AddForeignKey
ALTER TABLE "DiscoveredContact" ADD CONSTRAINT "DiscoveredContact_cacheId_fkey" FOREIGN KEY ("cacheId") REFERENCES "CompanyContactCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;
