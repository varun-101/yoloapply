import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { setCredentials } from "@/lib/credentials";
import { decryptSecret } from "@/lib/crypto";

// BYO credentials: the user's own DeepSeek key and SMTP (Gmail app password).
// Secrets are write-only — GET returns presence + a last-4 hint, never the
// value itself.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const cred = await prisma.userCredential.findUnique({ where: { userId: user.id } });
    const deepseekLast4 = cred?.deepseekKeyEnc
      ? decryptSecret(cred.deepseekKeyEnc).slice(-4)
      : null;
    return NextResponse.json({
      deepseekKeySet: !!cred?.deepseekKeyEnc,
      deepseekLast4,
      llmProvider: cred?.llmProvider ?? "deepseek",
      llmModel: cred?.llmModel ?? null,
      smtpHost: cred?.smtpHost ?? null,
      smtpPort: cred?.smtpPort ?? null,
      smtpUser: cred?.smtpUser ?? null,
      smtpFromName: cred?.smtpFromName ?? null,
      smtpPassSet: !!cred?.smtpPassEnc,
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
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFromName?: string | null;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as CredentialsBody;
    await setCredentials(user.id, {
      deepseekKey: body.deepseekKey,
      llmProvider: body.llmProvider,
      llmModel: body.llmModel,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpUser: body.smtpUser,
      smtpPass: body.smtpPass,
      smtpFromName: body.smtpFromName,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
