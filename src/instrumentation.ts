// Next.js instrumentation hook (next.config.mjs: experimental.instrumentationHook).
// The NEXT_RUNTIME check must wrap the import directly — webpack's edge
// compilation dead-code-eliminates the branch, keeping node-only modules
// (node-cron, prisma) out of the edge bundle.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
