import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Secrets at rest (per-user DeepSeek keys, SMTP app passwords) are encrypted
// with AES-256-GCM under a single server-side key. Token format:
//   v1.<iv b64>.<ciphertext b64>.<authTag b64>
// The "v1" prefix leaves room for key rotation later.

function masterKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${ciphertext.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptSecret(token: string): string {
  const [version, ivB64, ctB64, tagB64] = token.split(".");
  if (version !== "v1" || !ivB64 || !ctB64 || !tagB64) {
    throw new Error("Unrecognized secret token format.");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// Extension tokens are stored hashed (lookup by hash), never encrypted.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
