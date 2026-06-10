// Seeds the AtsCompany watchlist from the one-time probe over the
// kalil0321/ats-scrapers dataset (scripts/probe-ats-companies.ts).
//
// Keeps every company whose board was live with >=1 posting located in India —
// even if nothing passes the title filter today, a company with an India
// office posts fresher roles eventually and a board scan costs one request.
// Remote-only companies are left out (mostly US/EU-remote, low hit rate).
//
// Idempotent: upserts on (ats, slug), so re-running after a fresh probe only
// adds new companies. Run via:  npx tsx scripts/seed-ats-companies.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

try {
  process.loadEnvFile(".env");
} catch {
  // .env optional
}

interface ProbeResult {
  ats: "greenhouse" | "lever" | "ashby";
  name: string;
  slug: string;
  status: "ok" | "gone" | "error";
  indiaJobs: number;
  relevantIndiaJobs: number;
}

// The original hand-picked watchlist, kept regardless of what the probe saw.
const ORIGINAL_WATCHLIST: Pick<ProbeResult, "ats" | "name" | "slug">[] = [
  { name: "Groww", ats: "greenhouse", slug: "groww" },
  { name: "Postman", ats: "greenhouse", slug: "postman" },
  { name: "PhonePe", ats: "greenhouse", slug: "phonepe" },
  { name: "CRED", ats: "lever", slug: "cred" },
  { name: "Meesho", ats: "lever", slug: "meesho" },
  { name: "Atlan", ats: "ashby", slug: "atlan" },
];

async function main() {
  const results: ProbeResult[] = JSON.parse(
    readFileSync(join(__dirname, "..", "data", "ats-companies", "probe-results.json"), "utf8")
  );

  const keep = results.filter((r) => r.status === "ok" && r.indiaJobs > 0);
  for (const w of ORIGINAL_WATCHLIST) {
    if (!keep.some((k) => k.ats === w.ats && k.slug === w.slug)) {
      keep.push({ ...w, status: "ok", indiaJobs: 0, relevantIndiaJobs: 0 });
    }
  }

  let created = 0;
  for (let i = 0; i < keep.length; i += 100) {
    const counts = await prisma.$transaction(
      keep.slice(i, i + 100).map((c) =>
        prisma.atsCompany.upsert({
          where: { ats_slug: { ats: c.ats, slug: c.slug } },
          update: { name: c.name },
          create: { ats: c.ats, slug: c.slug, name: c.name },
        })
      )
    );
    created += counts.length;
  }

  const byAts = await prisma.atsCompany.groupBy({
    by: ["ats"],
    where: { active: true },
    _count: true,
  });
  console.log(`upserted ${created} companies`);
  for (const g of byAts) console.log(`  ${g.ats}: ${g._count} active`);
}

main()
  .catch((e) => {
    console.error("seed failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
