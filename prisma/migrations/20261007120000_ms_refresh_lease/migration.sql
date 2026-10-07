-- Cross-process Outlook refresh lease. IF NOT EXISTS because databases that
-- already applied the local-browser auto-apply migration have these columns.
ALTER TABLE "UserCredential" ADD COLUMN IF NOT EXISTS "msRefreshLeaseOwner" TEXT;
ALTER TABLE "UserCredential" ADD COLUMN IF NOT EXISTS "msRefreshLeaseExpiresAt" TIMESTAMP(3);
