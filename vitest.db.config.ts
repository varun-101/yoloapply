import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Integration tests against the DISPOSABLE loopback database only
// (node scripts/mcp-test-db.mjs migrate deploy first). tests/db/setup.ts
// pins DATABASE_URL/DIRECT_URL and refuses any non-loopback target.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
