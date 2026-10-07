import { randomBytes } from "crypto";

// Never let these tests reach the configured (production) database: the URL
// is pinned here, before any module creates a PrismaClient, and must be the
// loopback disposable database.
const url =
  process.env.MCP_TEST_DATABASE_URL ??
  "postgresql://yoloapply_test:local_autoapply_test_only@127.0.0.1:55439/yoloapply_mcp_test";
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/yoloapply_mcp_test") {
  throw new Error("Refusing to run DB tests against a non-disposable database.");
}
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.MICROSOFT_CLIENT_ID = "test-client";
process.env.MICROSOFT_CLIENT_SECRET = "test-secret";
process.env.MICROSOFT_REDIRECT_URI = "http://127.0.0.1/callback";
delete process.env.SUPABASE_URL;
