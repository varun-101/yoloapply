// Standalone job-discovery scan, for scheduled runs (Windows Task Scheduler).
// Run via:  npm run discover
//
// Does exactly what the dashboard's "Scan now" button does — pulls fresh
// postings from every configured source, dedupes, ingests, and fit-scores —
// without needing the Next.js server to be up.

import { prisma } from "../src/lib/db";
import { runDiscovery } from "../src/lib/discovery/pipeline";

try {
  process.loadEnvFile(".env");
} catch {
  // .env optional — env vars may come from the scheduler.
}

async function main() {
  const started = Date.now();
  const result = await runDiscovery();
  for (const s of result.sources) {
    // A source can partially fail (a few boards down) while the rest ingested
    // fine — only call it FAILED when nothing came back at all.
    const line =
      s.error && s.fetched === 0
        ? `${s.source}: FAILED — ${s.error}`
        : `${s.source}: ${s.created} new / ${s.fetched} fetched (${s.duplicates} dupes, ${s.alreadyApplied} already applied)${s.error ? ` — partial: ${s.error}` : ""}`;
    console.log(line);
  }
  if (result.scoreError) console.log(`scoring: ${result.scoreError}`);
  console.log(
    `total: ${result.created} new lead${result.created === 1 ? "" : "s"}, ${result.scored} scored, in ${Math.round((Date.now() - started) / 1000)}s`
  );
}

main()
  .catch((e) => {
    console.error("discover failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
