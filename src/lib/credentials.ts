import { randomBytes } from "crypto";
import { prisma } from "./db";
import { encryptSecret, decryptSecret, sha256Hex } from "./crypto";
import { ApiUserError } from "./auth";

// Per-user BYO credentials: DeepSeek API key, SMTP (Gmail app password),
// and the extension API token. Secrets are AES-256-GCM encrypted at rest
// (src/lib/crypto.ts); the extension token is stored hashed.

export async function getDeepseekKey(userId: string): Promise<string> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (!cred?.deepseekKeyEnc) {
    throw new ApiUserError(
      "Add your DeepSeek API key first (Settings → Credentials).",
      400,
      "no_llm_key"
    );
  }
  return decryptSecret(cred.deepseekKeyEnc);
}

export async function getDeepseekKeyOrNull(userId: string): Promise<string | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  return cred?.deepseekKeyEnc ? decryptSecret(cred.deepseekKeyEnc) : null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
}

export async function getSmtpConfig(userId: string): Promise<SmtpConfig> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (!cred?.smtpHost || !cred.smtpUser || !cred.smtpPassEnc) {
    throw new ApiUserError(
      "Configure your SMTP credentials first (Settings → Credentials) — use a Gmail App Password.",
      400,
      "no_smtp"
    );
  }
  return {
    host: cred.smtpHost,
    port: cred.smtpPort ?? 587,
    user: cred.smtpUser,
    pass: decryptSecret(cred.smtpPassEnc),
    fromName: cred.smtpFromName ?? cred.smtpUser,
  };
}

export interface CredentialUpdate {
  deepseekKey?: string | null; // undefined = leave, null = clear, string = set
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPass?: string | null;
  smtpFromName?: string | null;
}

export async function setCredentials(userId: string, update: CredentialUpdate) {
  const data: Record<string, unknown> = {};
  if (update.deepseekKey !== undefined) {
    data.deepseekKeyEnc = update.deepseekKey ? encryptSecret(update.deepseekKey) : null;
  }
  if (update.smtpPass !== undefined) {
    data.smtpPassEnc = update.smtpPass ? encryptSecret(update.smtpPass) : null;
  }
  for (const k of ["smtpHost", "smtpUser", "smtpFromName"] as const) {
    if (update[k] !== undefined) data[k] = update[k] || null;
  }
  if (update.smtpPort !== undefined) data.smtpPort = update.smtpPort ?? null;

  return prisma.userCredential.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

// Returns the FULL token exactly once — only the hash is stored.
export async function generateExtensionToken(userId: string): Promise<string> {
  const token = `yolo_${randomBytes(24).toString("base64url")}`;
  await prisma.userCredential.upsert({
    where: { userId },
    create: {
      userId,
      extensionTokenHash: sha256Hex(token),
      extensionTokenPrefix: token.slice(0, 12),
    },
    update: {
      extensionTokenHash: sha256Hex(token),
      extensionTokenPrefix: token.slice(0, 12),
    },
  });
  return token;
}

export async function revokeExtensionToken(userId: string): Promise<void> {
  await prisma.userCredential.updateMany({
    where: { userId },
    data: { extensionTokenHash: null, extensionTokenPrefix: null },
  });
}
