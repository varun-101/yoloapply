// One-time filtering pass over the kalil0321/ats-scrapers company dataset
// (data/ats-companies/*.csv). Fetches every company's public board once and
// records which ones have postings relevant to us, so the watchlist can be
// built from data instead of hand-picked slugs.
//
// Run via:  npx tsx scripts/probe-ats-companies.ts
// Output:   data/ats-companies/probe-results.json + summary stats on stdout

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
  titleMatches,
} from "../src/lib/searchPrefs";

const DATA_DIR = join(__dirname, "..", "data", "ats-companies");
const CONCURRENCY = 16;
const TIMEOUT_MS = 20_000;

// Probe criteria are operator-level, not per-user: the dataset was curated as
// "boards with ≥1 India posting", so the location list stays inlined here.
// Titles use the generic engineering defaults from searchPrefs.
const PROBE_PREFS = {
  includeKeywords: DEFAULT_INCLUDE_KEYWORDS,
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
};

// "remote" passes the runtime location filter, but a "Remote - US only" role is
// useless from India — so the probe tracks India and remote separately.
const INDIA_KEYWORDS = [
  "india",
  "bengaluru",
  "bangalore",
  "mumbai",
  "pune",
  "hyderabad",
  "chennai",
  "gurgaon",
  "gurugram",
  "noida",
  "delhi",
];

interface Company {
  ats: "greenhouse" | "lever" | "ashby";
  name: string;
  slug: string;
}

interface Posting {
  title: string;
  location: string;
  isRemote?: boolean;
}

interface ProbeResult extends Company {
  status: "ok" | "gone" | "error";
  error?: string;
  totalJobs: number;
  indiaJobs: number; // location names an Indian city / "india"
  remoteJobs: number; // remote, but not identifiably India
  relevantIndiaJobs: number; // indiaJobs that also pass the title filter
  relevantRemoteJobs: number; // remoteJobs that also pass the title filter
  sampleRoles: string[]; // up to 3 relevant titles, for eyeballing the results
}

function parseCsv(file: string, ats: Company["ats"]): Company[] {
  const lines = readFileSync(join(DATA_DIR, file), "utf8").split(/\r?\n/).slice(1);
  const companies: Company[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // name,slug,url — name may contain commas, so peel slug/url off the end.
    const parts = line.split(",");
    if (parts.length < 3) continue;
    parts.pop(); // url — derivable from ats + slug
    const slug = parts.pop()!.trim();
    const name = parts.join(",").trim().replace(/^"|"$/g, "");
    if (slug) companies.push({ ats, name, slug });
  }
  return companies;
}

async function fetchBoard(c: Company): Promise<{ postings: Posting[] } | { gone: true }> {
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`,
    lever: `https://api.lever.co/v0/postings/${c.slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`,
  };

  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(urls[c.ats], { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
  }
  if (res!.status === 404) return { gone: true };
  if (!res!.ok) throw new Error(`HTTP ${res!.status}`);
  const json = await res!.json();

  if (c.ats === "greenhouse") {
    const jobs = (json as { jobs?: { title: string; location?: { name?: string } }[] }).jobs ?? [];
    return { postings: jobs.map((j) => ({ title: j.title, location: j.location?.name ?? "" })) };
  }
  if (c.ats === "lever") {
    const jobs = json as { text: string; categories?: { location?: string }; workplaceType?: string }[];
    return {
      postings: jobs.map((j) => ({
        title: j.text,
        location: j.categories?.location ?? "",
        isRemote: j.workplaceType === "remote",
      })),
    };
  }
  const jobs =
    (json as { jobs?: { title: string; location?: string; isRemote?: boolean; isListed?: boolean }[] })
      .jobs ?? [];
  return {
    postings: jobs
      .filter((j) => j.isListed !== false)
      .map((j) => ({ title: j.title, location: j.location ?? "", isRemote: j.isRemote })),
  };
}

function probeCompany(c: Company, postings: Posting[]): ProbeResult {
  const result: ProbeResult = {
    ...c,
    status: "ok",
    totalJobs: postings.length,
    indiaJobs: 0,
    remoteJobs: 0,
    relevantIndiaJobs: 0,
    relevantRemoteJobs: 0,
    sampleRoles: [],
  };
  for (const p of postings) {
    const loc = p.location.toLowerCase();
    const india = INDIA_KEYWORDS.some((k) => loc.includes(k));
    const remote = !india && (p.isRemote || loc.includes("remote"));
    if (!india && !remote) continue;
    if (india) result.indiaJobs++;
    else result.remoteJobs++;
    if (titleMatches(PROBE_PREFS, p.title)) {
      if (india) result.relevantIndiaJobs++;
      else result.relevantRemoteJobs++;
      if (result.sampleRoles.length < 3) result.sampleRoles.push(p.title.trim());
    }
  }
  return result;
}

async function main() {
  const companies = [
    ...parseCsv("greenhouse.csv", "greenhouse"),
    ...parseCsv("lever.csv", "lever"),
    ...parseCsv("ashby.csv", "ashby"),
  ];
  console.log(`probing ${companies.length} companies (concurrency ${CONCURRENCY})...`);

  const results: ProbeResult[] = [];
  let next = 0;
  let done = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < companies.length) {
        const c = companies[next++];
        try {
          const board = await fetchBoard(c);
          results.push(
            "gone" in board
              ? { ...c, status: "gone", totalJobs: 0, indiaJobs: 0, remoteJobs: 0, relevantIndiaJobs: 0, relevantRemoteJobs: 0, sampleRoles: [] }
              : probeCompany(c, board.postings)
          );
        } catch (e) {
          results.push({
            ...c,
            status: "error",
            error: e instanceof Error ? e.message : String(e),
            totalJobs: 0, indiaJobs: 0, remoteJobs: 0, relevantIndiaJobs: 0, relevantRemoteJobs: 0,
            sampleRoles: [],
          });
        }
        if (++done % 500 === 0) {
          const rate = done / ((Date.now() - started) / 1000);
          console.log(`  ${done}/${companies.length} (${rate.toFixed(0)}/s, eta ${Math.round((companies.length - done) / rate)}s)`);
        }
      }
    })
  );

  writeFileSync(join(DATA_DIR, "probe-results.json"), JSON.stringify(results, null, 1));

  const by = (pred: (r: ProbeResult) => boolean) => {
    const counts = { greenhouse: 0, lever: 0, ashby: 0 };
    for (const r of results) if (pred(r)) counts[r.ats]++;
    return { ...counts, total: counts.greenhouse + counts.lever + counts.ashby };
  };
  const fmt = (c: ReturnType<typeof by>) =>
    `${String(c.total).padStart(5)}  (gh ${c.greenhouse}, lever ${c.lever}, ashby ${c.ashby})`;

  console.log(`\n=== probe stats (${Math.round((Date.now() - started) / 1000)}s) ===`);
  console.log(`probed:                      ${fmt(by(() => true))}`);
  console.log(`board live (ok):             ${fmt(by((r) => r.status === "ok"))}`);
  console.log(`board gone (404):            ${fmt(by((r) => r.status === "gone"))}`);
  console.log(`fetch errors:                ${fmt(by((r) => r.status === "error"))}`);
  console.log(`has any India posting:       ${fmt(by((r) => r.indiaJobs > 0))}`);
  console.log(`  ...passing title filter:   ${fmt(by((r) => r.relevantIndiaJobs > 0))}`);
  console.log(`has remote (non-India):      ${fmt(by((r) => r.remoteJobs > 0))}`);
  console.log(`  ...passing title filter:   ${fmt(by((r) => r.relevantRemoteJobs > 0))}`);
  console.log(`India OR remote + title:     ${fmt(by((r) => r.relevantIndiaJobs + r.relevantRemoteJobs > 0))}`);

  const errs = new Map<string, number>();
  for (const r of results) if (r.error) errs.set(r.error, (errs.get(r.error) ?? 0) + 1);
  if (errs.size) {
    console.log(`\ntop errors:`);
    for (const [msg, n] of [...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${n}x ${msg}`);
    }
  }

  const top = results
    .filter((r) => r.relevantIndiaJobs > 0)
    .sort((a, b) => b.relevantIndiaJobs - a.relevantIndiaJobs)
    .slice(0, 20);
  console.log(`\ntop companies by relevant India postings:`);
  for (const r of top) {
    console.log(`  ${r.name} [${r.ats}]: ${r.relevantIndiaJobs} relevant / ${r.indiaJobs} India / ${r.totalJobs} total — ${r.sampleRoles.join(" | ")}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exitCode = 1;
});
