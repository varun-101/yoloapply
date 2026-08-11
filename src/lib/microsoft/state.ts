import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { deriveKey } from "../crypto";

// The OAuth `state` parameter for the Outlook connect flow.
//
// Stateless and HMAC-signed, exactly like the share-link tokens in
// src/lib/shareLink.ts — no table, nothing to garbage-collect. It carries the
// userId, which does two jobs:
//   - CSRF defence: an attacker can't forge a callback that binds their
//     mailbox to someone else's account without the derived key;
//   - it frees the callback from depending on the Clerk session cookie
//     surviving the redirect back from login.microsoftonline.com.
// Short-lived by design: a consent screen left open for hours should fail
// closed and be restarted, not silently connect.

const TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  v: 1;
  uid: string;
  n: string; // nonce — makes each authorize URL unique
  exp: number; // unix seconds
}

function sign(payloadB64: string): Buffer {
  return createHmac("sha256", deriveKey("ms-oauth-state-v1")).update(payloadB64).digest();
}

export function createOAuthState(userId: string): string {
  const payload: StatePayload = {
    v: 1,
    uid: userId,
    n: randomBytes(9).toString("base64url"),
    exp: Math.floor((Date.now() + TTL_MS) / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64).toString("base64url")}`;
}

export type VerifiedState =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

export function verifyOAuthState(state: string | null): VerifiedState {
  if (typeof state !== "string" || state.length < 10 || state.length > 2048) {
    return { ok: false, reason: "invalid" };
  }
  const dot = state.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const payloadB64 = state.slice(0, dot);
  const sig = Buffer.from(state.slice(dot + 1), "base64url");
  const expected = sign(payloadB64);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return { ok: false, reason: "invalid" };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (payload?.v !== 1 || typeof payload.uid !== "string" || typeof payload.exp !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (payload.exp * 1000 < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: payload.uid };
}
