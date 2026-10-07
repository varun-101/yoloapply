import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Unit tests run in a plain Node environment (no DB, no network). The suite
// targets pure helpers in src/lib/**; modules that import ./db pull in a
// PrismaClient but never query it, so no DATABASE_URL is needed.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // DB integration tests need the disposable database: npm run test:db.
    exclude: ["tests/db/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
  },
});
