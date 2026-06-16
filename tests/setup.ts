import { randomBytes } from "crypto";

// crypto.ts requires a 32-byte base64 APP_ENCRYPTION_KEY. Generate an ephemeral
// one for the test run so encrypt/decrypt round-trips work without touching the
// real .env secret.
if (!process.env.APP_ENCRYPTION_KEY) {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}
