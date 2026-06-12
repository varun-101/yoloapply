// Standalone discovery tick: one global source fetch, then a fan-out for
// every user with discovery enabled. Run via:  npm run discover
//
// Same as the in-server cron tick (src/instrumentation.ts) — useful for
// one-off manual runs without the Next.js server up.

import { prisma } from "../src/lib/db";
import { runFullTick } from "../src/lib/discovery/pipeline";

try {
  process.loadEnvFile(".env");
} catch {
  // .env optional — env vars may come from the environment.
}

async function main() {
  const started = Date.now();
  const tick = await runFullTick("script");
  if (tick.users.length === 0) {
    console.log("no users with discovery enabled — nothing to scan");
    return;
  }
  for (const u of tick.users) {
    if (!u.result) {
      console.log(`${u.email}: FAILED — ${u.error}`);
      continue;
    }
    for (const s of u.result.sources) {
      // A source can partially fail (a few boards down) while the rest
      // ingested fine — only call it FAILED when nothing came back at all.
      const line =
        s.error && s.fetched === 0
          ? `${u.email} · ${s.source}: FAILED — ${s.error}`
          : `${u.email} · ${s.source}: ${s.created} new / ${s.fetched} matched (${s.duplicates} dupes, ${s.alreadyApplied} already applied)${s.error ? ` — partial: ${s.error}` : ""}`;
      console.log(line);
    }
    if (u.result.scoreError) console.log(`${u.email} · scoring: ${u.result.scoreError}`);
    console.log(
      `${u.email} · total: ${u.result.created} new lead${u.result.created === 1 ? "" : "s"}, ${u.result.scored} scored`
    );
  }
  console.log(`tick finished in ${Math.round((Date.now() - started) / 1000)}s`);
}

main()
  .catch((e) => {
    console.error("discover failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
