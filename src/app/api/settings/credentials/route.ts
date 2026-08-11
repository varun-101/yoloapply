import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { setCredentials, getSenderAddressOrNull } from "@/lib/credentials";
import { decryptSecret } from "@/lib/crypto";
import { microsoftConfigured } from "@/lib/microsoft/oauth";

// BYO credentials: the user's own DeepSeek key and SMTP (Gmail app password).
// Secrets are write-only — GET returns presence + a last-4 hint, never the
// value itself.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const cred = await prisma.userCredential.findUnique({ where: { userId: user.id } });
    // Decrypt only to expose the last-4 hint (never the key itself). Guard each
    // so a single undecryptable secret can't 500 the whole settings page.
    const last4 = (enc: string | null | undefined): string | null => {
      if (!enc) return null;
      try {
        return decryptSecret(enc).slice(-4);
      } catch {
        return null;
      }
    };
    const deepseekLast4 = last4(cred?.deepseekKeyEnc);
    return NextResponse.json({
      deepseekKeySet: !!cred?.deepseekKeyEnc,
      deepseekLast4,
      llmProvider: cred?.llmProvider ?? "deepseek",
      llmModel: cred?.llmModel ?? null,
      apolloKeySet: !!cred?.apolloKeyEnc,
      apolloLast4: last4(cred?.apolloKeyEnc),
      signalhireKeySet: !!cred?.signalhireKeyEnc,
      signalhireLast4: last4(cred?.signalhireKeyEnc),
      searchKeySet: !!cred?.searchKeyEnc,
      searchLast4: last4(cred?.searchKeyEnc),
      smtpHost: cred?.smtpHost ?? null,
      smtpPort: cred?.smtpPort ?? null,
      smtpUser: cred?.smtpUser ?? null,
      smtpFromName: cred?.smtpFromName ?? null,
      smtpPassSet: !!cred?.smtpPassEnc,
      emailProvider: cred?.emailProvider ?? "smtp",
      // The address mail actually leaves from, resolved through the same
      // getSenderConfig that sendEmail uses — so surfaces like the cold-email
      // composer can show the selected sender instead of guessing at smtpUser.
      senderAddress: await getSenderAddressOrNull(user.id),
      // Whether the operator has set MICROSOFT_* at all — the UI hides the
      // Connect button entirely rather than offering a flow that must fail.
      microsoftAvailable: microsoftConfigured(),
      microsoftConnected: !!(cred?.msRefreshTokenEnc && cred?.msEmail),
      microsoftEmail: cred?.msEmail ?? null,
      microsoftDisplayName: cred?.msDisplayName ?? null,
      extensionTokenPrefix: cred?.extensionTokenPrefix ?? null,
    });
  } catch (e) {
    return apiError(e);
  }
}

interface CredentialsBody {
  deepseekKey?: string | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  apolloKey?: string | null;
  signalhireKey?: string | null;
  searchKey?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFromName?: string | null;
  emailProvider?: string | null;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as CredentialsBody;
    await setCredentials(user.id, {
      deepseekKey: body.deepseekKey,
      llmProvider: body.llmProvider,
      llmModel: body.llmModel,
      apolloKey: body.apolloKey,
      signalhireKey: body.signalhireKey,
      searchKey: body.searchKey,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpUser: body.smtpUser,
      smtpPass: body.smtpPass,
      smtpFromName: body.smtpFromName,
      emailProvider: body.emailProvider,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
