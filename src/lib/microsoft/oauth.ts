import { prisma } from "../db";
import { encryptSecret, decryptSecret } from "../crypto";
import { ApiUserError } from "../auth";

// OAuth against the Microsoft identity platform, so a user can connect their
// Outlook / Microsoft 365 mailbox by logging in instead of pasting an app
// password. Outbound mail then goes through Graph (src/lib/microsoft/graphMail.ts).
//
// Why OAuth + Graph and not SMTP: Microsoft is retiring Basic auth for SMTP
// client submission — disabled by default for existing tenants at the end of
// December 2026, unavailable to new tenants after that. An app-password path
// for Outlook would have a known expiry date.
//
// Hand-rolled rather than @azure/msal-node: MSAL wants to own its own token
// cache, which would mean an ICachePlugin plus a per-user client per request to
// replace what is really three HTTP calls. This way the refresh token lands in
// the same encryptSecret() column as every other secret in the app.

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

// `common` = work/school AND personal Microsoft accounts. Mail.Read is granted
// now but not used yet — src/lib/application-agent/replies.ts defines a
// ReplyProvider interface with no concrete implementation, and Graph is the
// obvious one to add. Asking for it up front avoids making every connected
// user re-consent later. Deliberately NOT Mail.ReadWrite: that would allow the
// draft-then-send flow (which hands back a message id directly) but it is a
// visibly heavier consent screen for a modest gain — see graphMail.ts.
export const MS_SCOPES = "offline_access User.Read Mail.Send Mail.Read";

// Refresh a little before expiry so an access token can't die mid-send.
const REFRESH_SKEW_MS = 5 * 60 * 1000;

interface MsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function microsoftConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID &&
      process.env.MICROSOFT_CLIENT_SECRET &&
      process.env.MICROSOFT_REDIRECT_URI
  );
}

function msOAuthConfig(): MsOAuthConfig {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new ApiUserError(
      "Outlook sign-in isn't configured on this server. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_REDIRECT_URI.",
      500,
      "microsoft_not_configured"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// Raised for a failed token exchange; `oauthCode` is Microsoft's own error
// code, which is how we tell "the grant is dead, reconnect" apart from a
// transient network/service problem.
export class MicrosoftAuthError extends Error {
  constructor(
    message: string,
    public readonly oauthCode: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "MicrosoftAuthError";
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string; // absent on some refreshes — keep the existing one
  expires_in: number;
  scope?: string;
}

export function authorizeUrl(state: string): string {
  const cfg = msOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: MS_SCOPES,
    state,
    // Always show the picker: people connecting a mailbox often want a
    // different account from the one their browser is already signed into.
    prompt: "select_account",
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const cfg = msOAuthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    ...params,
  });

  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  const data = (await res.json().catch(() => ({}))) as
    | TokenResponse
    | { error?: string; error_description?: string };

  if (!res.ok || !("access_token" in data)) {
    const err = data as { error?: string; error_description?: string };
    throw new MicrosoftAuthError(
      err.error_description ?? err.error ?? `Microsoft token request failed (${res.status}).`,
      err.error ?? "unknown_error",
      res.status
    );
  }
  return data;
}

interface GraphMe {
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
}

async function fetchProfile(accessToken: string): Promise<GraphMe> {
  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!res.ok) {
    throw new ApiUserError(
      `Couldn't read your Microsoft profile (${res.status}). Try connecting again.`,
      502,
      "microsoft_profile_failed"
    );
  }
  return (await res.json()) as GraphMe;
}

async function persistTokens(userId: string, tokens: TokenResponse): Promise<void> {
  await prisma.userCredential.update({
    where: { userId },
    data: {
      msAccessTokenEnc: encryptSecret(tokens.access_token),
      msTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      // Microsoft rotates the refresh token on most refreshes; when it issues
      // a new one the old one is dead, so it must be written every time.
      ...(tokens.refresh_token ? { msRefreshTokenEnc: encryptSecret(tokens.refresh_token) } : {}),
      ...(tokens.scope ? { msScopes: tokens.scope } : {}),
    },
  });
}

// Completes the connect flow: code → tokens → whose mailbox is this → persist.
export async function connectMicrosoftAccount(
  userId: string,
  code: string
): Promise<{ email: string; displayName: string | null }> {
  const cfg = msOAuthConfig();
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    scope: MS_SCOPES,
  });

  const me = await fetchProfile(tokens.access_token);
  const email = me.mail ?? me.userPrincipalName;
  if (!email) {
    throw new ApiUserError(
      "That Microsoft account has no mailbox address, so it can't send email.",
      400,
      "microsoft_no_mailbox"
    );
  }

  const data = {
    msAccessTokenEnc: encryptSecret(tokens.access_token),
    msTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    msRefreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    msEmail: email,
    msDisplayName: me.displayName ?? null,
    msConnectedAt: new Date(),
    msScopes: tokens.scope ?? MS_SCOPES,
  };
  await prisma.userCredential.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return { email, displayName: me.displayName ?? null };
}

export async function disconnectMicrosoft(userId: string): Promise<void> {
  await prisma.userCredential.updateMany({
    where: { userId },
    data: {
      msAccessTokenEnc: null,
      msRefreshTokenEnc: null,
      msTokenExpiresAt: null,
      msEmail: null,
      msDisplayName: null,
      msConnectedAt: null,
      msScopes: null,
      // Don't strand the user on a provider that can no longer send.
      emailProvider: "smtp",
    },
  });
}

// Per-user in-flight refresh, mirroring the runUserScan lock in
// src/lib/discovery/pipeline.ts. This one is not just an optimisation: the
// refresh token ROTATES, so two concurrent sends both spending the same one
// would leave the loser holding a dead token and silently break the
// connection. Same single-instance caveat as every other globalThis lock here.
type MicrosoftGlobal = { __msTokenRefresh?: Map<string, Promise<string>> };
const g = globalThis as unknown as MicrosoftGlobal;
function refreshLocks(): Map<string, Promise<string>> {
  return (g.__msTokenRefresh ??= new Map());
}

async function refreshAccessToken(userId: string, refreshToken: string): Promise<string> {
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MS_SCOPES,
    });
  } catch (e) {
    // invalid_grant = revoked, expired, password changed, or consent pulled.
    // Nothing to retry: drop the connection so the UI asks for a reconnect
    // instead of failing on every send from here on.
    if (e instanceof MicrosoftAuthError && e.oauthCode === "invalid_grant") {
      await disconnectMicrosoft(userId);
      throw new ApiUserError(
        "Your Outlook connection expired — reconnect it in Settings → Credentials.",
        400,
        "microsoft_disconnected"
      );
    }
    throw e;
  }
  await persistTokens(userId, tokens);
  return tokens.access_token;
}

export async function getMicrosoftAccessToken(userId: string): Promise<string> {
  const cred = await prisma.userCredential.findUnique({ where: { userId } });
  if (!cred?.msRefreshTokenEnc) {
    throw new ApiUserError(
      "Connect your Outlook account first (Settings → Credentials).",
      400,
      "no_microsoft"
    );
  }

  if (
    cred.msAccessTokenEnc &&
    cred.msTokenExpiresAt &&
    cred.msTokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS
  ) {
    return decryptSecret(cred.msAccessTokenEnc);
  }

  const locks = refreshLocks();
  const inflight = locks.get(userId);
  if (inflight) return inflight;

  const pending = refreshAccessToken(userId, decryptSecret(cred.msRefreshTokenEnc)).finally(() => {
    locks.delete(userId);
  });
  locks.set(userId, pending);
  return pending;
}
