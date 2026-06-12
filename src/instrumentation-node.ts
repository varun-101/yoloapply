// Node-runtime boot code, loaded once per server process by instrumentation.ts.
// Registers the discovery cron when ENABLE_CRON=1 (replaces the old Windows
// Task Scheduler entry; set it on exactly ONE instance — the tick locks live
// in-process).

import cron from "node-cron";
import { runFullTick } from "./lib/discovery/pipeline";

// Guard on globalThis: dev HMR can re-evaluate this module, and a second
// schedule would double every tick.
const g = globalThis as unknown as { __discoveryCron?: boolean };

if (process.env.ENABLE_CRON === "1" && !g.__discoveryCron) {
  g.__discoveryCron = true;
  cron.schedule("0 */3 * * *", () => {
    runFullTick("cron").catch((e) => {
      console.error("[cron] discovery tick failed:", e instanceof Error ? e.message : e);
    });
  });
  console.log("[cron] discovery tick scheduled (every 3h)");
}
