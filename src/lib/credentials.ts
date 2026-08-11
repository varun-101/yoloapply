import { randomBytes } from "crypto";
import { prisma } from "./db";
import { encryptSecret, decryptSecret, sha256Hex } from "./crypto";
import { ApiUserError } from "./auth";
import { type LlmConfig } from "./llm";
import { getProviderConfig, DEFAULT_PROVIDER } from "./providers";

// Per-user BYO credentials: DeepSeek API key, SMTP (Gmail app password),
// and the extension API token. Secrets are AES-256-GCM encrypted at rest
// (src/lib/crypto.ts); the extension token is stored hashed.

async function getActiveSharedLlmConfig(): Promise<LlmConfig | null> {
  const row = await prisma.sharedDeepseekKey.findUnique({ where: { id: 1 } });
  if (!row || row.expiresAt <= new Date()) return null;
  const cfg = getProviderConfig(row.llmProvider);
  return {
    apiKey: decryptSecret(row.keyEnc),
    baseURL: cfg.baseURL,
    model: row.llmModel || cfg.defaultModel,
  };
}

function buildLlmConfig(encKey: string, provider?: string | null, model?: string | null): LlmConfig {
  const cfg = getProviderConfig(provider);
  return {
    apiKey: decryptSecret(encKey),
    baseURL: cfg.baseURL,
    model: model || cfg.defaultModel,
  };
}

export async function getLlmConfig(userId: string): Promise<LlmConfig> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (cred?.deepseekKeyEnc) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = cred as any;
    return buildLlmConfig(cred.deepseekKeyEnc, c.llmProvider, c.llmModel);
  }
  const shared = await getActiveSharedLlmConfig();
  if (shared) return shared;
  throw new ApiUserError(
    "Add your LLM API key first (Settings → Credentials).",
    400,
    "no_llm_key"
  );
}

export async function getLlmConfigOrNull(userId: string): Promise<LlmConfig | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (cred?.deepseekKeyEnc) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = cred as any;
    return buildLlmConfig(cred.deepseekKeyEnc, c.llmProvider, c.llmModel);
  }
  return getActiveSharedLlmConfig();
}

// Contact-finder lane keys (cold-email enrichment). Both optional — the free
// lanes (site scrape, GitHub, role inboxes, pattern+MX) run without either.
export async function getApolloKey(userId: string): Promise<string | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  return cred?.apolloKeyEnc ? decryptSecret(cred.apolloKeyEnc) : null;
}

export async function getSignalHireKey(userId: string): Promise<string | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  return cred?.signalhireKeyEnc ? decryptSecret(cred.signalhireKeyEnc) : null;
}

export async function getSearchKey(userId: string): Promise<string | null> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  return cred?.searchKeyEnc ? decryptSecret(cred.searchKeyEnc) : null;
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

// Which mailbox outbound email leaves from. Both providers can be configured
// at once, so the choice is stored explicitly (UserCredential.emailProvider)
// rather than inferred from what happens to be set up — connecting Outlook to
// try it must not silently change the sender on cold emails.
export type SenderConfig =
  | { provider: "smtp"; address: string; fromName: string; smtp: SmtpConfig }
  | { provider: "microsoft"; address: string; fromName: string };

export interface MicrosoftAccount {
  connected: boolean;
  email: string | null;
  displayName: string | null;
  connectedAt: Date | null;
}

export async function getMicrosoftAccount(userId: string): Promise<MicrosoftAccount> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  return {
    connected: Boolean(cred?.msRefreshTokenEnc && cred?.msEmail),
    email: cred?.msEmail ?? null,
    displayName: cred?.msDisplayName ?? null,
    connectedAt: cred?.msConnectedAt ?? null,
  };
}

export async function getSenderConfig(userId: string): Promise<SenderConfig> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });

  if (cred?.emailProvider === "microsoft") {
    if (!cred.msRefreshTokenEnc || !cred.msEmail) {
      throw new ApiUserError(
        "Your Outlook account isn't connected — reconnect it in Settings → Credentials.",
        400,
        "no_smtp"
      );
    }
    return {
      provider: "microsoft",
      address: cred.msEmail,
      fromName: cred.msDisplayName ?? cred.msEmail,
    };
  }

  const smtp = await getSmtpConfig(userId);
  return { provider: "smtp", address: smtp.user, fromName: smtp.fromName, smtp };
}

// Display-only: the address mail would actually leave from right now, or null
// if the selected provider isn't usable yet. Resolves through getSenderConfig
// so the UI can never disagree with what sendEmail will do — but swallows the
// error, because "no sender configured" is a label, not a failure, on a screen
// that is merely showing the user where their email will come from.
export async function getSenderAddressOrNull(userId: string): Promise<string | null> {
  try {
    return (await getSenderConfig(userId)).address;
  } catch {
    return null;
  }
}

export interface CredentialUpdate {
  deepseekKey?: string | null; // undefined = leave, null = clear, string = set
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

export async function setCredentials(userId: string, update: CredentialUpdate) {
  const data: Record<string, unknown> = {};
  if (update.deepseekKey !== undefined) {
    data.deepseekKeyEnc = update.deepseekKey ? encryptSecret(update.deepseekKey) : null;
  }
  if (update.llmProvider !== undefined) {
    data.llmProvider = update.llmProvider || DEFAULT_PROVIDER;
  }
  if (update.llmModel !== undefined) {
    data.llmModel = update.llmModel || null;
  }
  if (update.apolloKey !== undefined) {
    data.apolloKeyEnc = update.apolloKey ? encryptSecret(update.apolloKey) : null;
  }
  if (update.signalhireKey !== undefined) {
    data.signalhireKeyEnc = update.signalhireKey ? encryptSecret(update.signalhireKey) : null;
  }
  if (update.searchKey !== undefined) {
    data.searchKeyEnc = update.searchKey ? encryptSecret(update.searchKey) : null;
  }
  if (update.smtpPass !== undefined) {
    data.smtpPassEnc = update.smtpPass ? encryptSecret(update.smtpPass) : null;
  }
  for (const k of ["smtpHost", "smtpUser", "smtpFromName"] as const) {
    if (update[k] !== undefined) data[k] = update[k] || null;
  }
  if (update.smtpPort !== undefined) data.smtpPort = update.smtpPort ?? null;
  if (update.emailProvider !== undefined) {
    data.emailProvider = update.emailProvider === "microsoft" ? "microsoft" : "smtp";
  }

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
