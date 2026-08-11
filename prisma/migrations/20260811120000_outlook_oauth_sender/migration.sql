-- Outlook / Microsoft 365 as a second outbound-email sender.
-- Purely additive: every column is nullable or defaulted, so existing rows
-- keep sending over SMTP exactly as before.
ALTER TABLE "UserCredential" ADD COLUMN     "emailProvider" TEXT NOT NULL DEFAULT 'smtp',
ADD COLUMN     "msAccessTokenEnc" TEXT,
ADD COLUMN     "msConnectedAt" TIMESTAMP(3),
ADD COLUMN     "msDisplayName" TEXT,
ADD COLUMN     "msEmail" TEXT,
ADD COLUMN     "msRefreshTokenEnc" TEXT,
ADD COLUMN     "msScopes" TEXT,
ADD COLUMN     "msTokenExpiresAt" TIMESTAMP(3);
