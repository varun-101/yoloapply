#!/usr/bin/env node
// Run a Prisma command against the DISPOSABLE MCP test database only.
//
// Prisma migrate reads DIRECT_URL (not DATABASE_URL) and falls back to .env,
// which points at the real database. This wrapper pins both URLs, asks Prisma
// which datasource it resolved, and refuses unless it is the loopback test
// database. Usage: node scripts/mcp-test-db.mjs migrate deploy
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

export const MCP_TEST_URL =
  process.env.MCP_TEST_DATABASE_URL ??
  "postgresql://yoloapply_test:local_autoapply_test_only@127.0.0.1:55439/yoloapply_mcp_test";
const TARGET = /Datasource "db": PostgreSQL database "yoloapply_mcp_test", schema "public" at "(127\.0\.0\.1|localhost):\d+"/;

const env = { ...process.env, DATABASE_URL: MCP_TEST_URL, DIRECT_URL: MCP_TEST_URL };
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/mcp-test-db.mjs <prisma args>");
  process.exit(2);
}
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const probe = spawnSync(process.execPath, [prismaCli, "migrate", "status"], { env, encoding: "utf8" });
const probeText = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
if (!TARGET.test(probeText)) {
  console.error("Refusing: Prisma did not resolve the disposable MCP test database.");
  console.error(probeText.split("\n").find((line) => line.includes("Datasource")) ?? "(no datasource line)");
  process.exit(1);
}
const result = spawnSync(process.execPath, [prismaCli, ...args], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
