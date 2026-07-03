import { createHmac, timingSafeEqual } from "crypto";
import { deriveKey } from "./crypto";

// Public share links for an application's resume PDF + cover letter.
//
// Stateless by design: the token itself carries { applicationId, userId, exp }
// and is HMAC-SHA256-signed with a key derived from APP_ENCRYPTION_KEY — no DB
// table, no migration, nothing to garbage-collect. Token format:
//   <base64url payload>.<base64url signature>
// Trade-offs baked in:
//   - an individual link cannot be revoked early; it dies at `exp` (rotating
//     the master key kills every link at once), so keep expiries modest;
//   - anyone holding the URL can view the artifacts until then — the share UI
//     says so explicitly.

export const DEFAULT_SHARE_DAYS = 30;
export const MAX_SHARE_DAYS = 90;

interface SharePayload {
  v: 1;
  app: string; // applicationId
  uid: string; // owning userId — keeps lookups tenant-scoped
  exp: number; // unix seconds
}

function sign(payloadB64: string): Buffer {
  return createHmac("sha256", deriveKey("share-link-v1")).update(payloadB64).digest();
}

export function createShareToken(
  userId: string,
  applicationId: string,
  expiresDays: number = DEFAULT_SHARE_DAYS
): { token: string; expiresAt: Date } {
  const days = Math.min(Math.max(Math.round(expiresDays) || DEFAULT_SHARE_DAYS, 1), MAX_SHARE_DAYS);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const payload: SharePayload = {
    v: 1,
    app: applicationId,
    uid: userId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${payloadB64}.${sign(payloadB64).toString("base64url")}`, expiresAt };
}

export type VerifiedShare =
  | { ok: true; applicationId: string; userId: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" };

export function verifyShareToken(token: string): VerifiedShare {
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return { ok: false, reason: "invalid" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payloadB64 = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = sign(payloadB64);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: SharePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    payload?.v !== 1 ||
    typeof payload.app !== "string" ||
    typeof payload.uid !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  return {
    ok: true,
    applicationId: payload.app,
    userId: payload.uid,
    expiresAt: new Date(payload.exp * 1000),
  };
}
