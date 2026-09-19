// One-off diagnostic: run every discovery source in isolation, with a wall clock
// and a hard cap, and report what each one actually returns right now.
try { process.loadEnvFile(".env") } catch {}

import { prisma } from "../src/lib/db";
import { ensureSearchPrefs, type SearchPrefs } from "../src/lib/searchPrefs";
import { fetchSheetLeads } from "../src/lib/discovery/sheet";
import { fetchJobfoundLeads } from "../src/lib/discovery/jobfound";
import { fetchAtsLeads } from "../src/lib/discovery/ats";
import { fetchHnLeads } from "../src/lib/discovery/hn";
import { fetchWeWorkRemotelyLeads } from "../src/lib/discovery/weworkremotely";
import { fetchRemoteOkLeads } from "../src/lib/discovery/remoteok";
import { fetchRemotiveLeads } from "../src/lib/discovery/remotive";
import { fetchInstahyreLeads } from "../src/lib/discovery/instahyre";
import { runFundingScan } from "../src/lib/discovery/funding";
import type { FetchResult } from "../src/lib/discovery/types";

const CAP_MS = Number(process.env.PROBE_CAP_MS ?? 180_000);
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

function withCap<T>(name: string, p: Promise<T>): Promise<T | "TIMED_OUT"> {
  return Promise.race([
    p,
    new Promise<"TIMED_OUT">((r) => setTimeout(() => r("TIMED_OUT"), CAP_MS).unref?.()),
  ]);
}

async function run(name: string, fn: () => Promise<FetchResult | FetchResult[] | unknown>) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  process.stdout.write(`\n── ${name} `.padEnd(60, "─") + "\n");
  try {
    const out = await withCap(name, fn() as Promise<any>);
    const ms = Date.now() - t0;
    if (out === "TIMED_OUT") {
      console.log(`  STILL RUNNING after ${(ms / 1000).toFixed(1)}s (cap hit)`);
      return;
    }
    const results: FetchResult[] = Array.isArray(out) ? out : [out as FetchResult];
    for (const r of results) {
      if (!r || typeof r !== "object" || !("source" in r)) { console.log("  (non-lead result)", JSON.stringify(out).slice(0, 300)); break; }
      const verdict = r.error ? (r.leads.length ? "PARTIAL" : "FAIL") : r.leads.length ? "OK" : "EMPTY";
      console.log(`  [${verdict}] ${r.source}: ${r.leads.length} leads in ${(ms / 1000).toFixed(1)}s`);
      if (r.error) console.log(`      error: ${String(r.error).slice(0, 400)}`);
      if (r.leads[0]) console.log(`      e.g. ${r.leads[0].company} — ${r.leads[0].role} (${r.leads[0].location ?? "?"})${r.leads[0].jdText ? " [+JD]" : ""}`);
    }
  } catch (e: unknown) {
    console.log(`  [THREW] after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const enabled = await prisma.user.findMany({ select: { id: true, email: true, searchPref: true } });
  const prefsList: SearchPrefs[] = [];
  for (const u of enabled) prefsList.push(await ensureSearchPrefs(u.id));
  console.log(`users: ${enabled.length}, prefs loaded: ${prefsList.length}, cap ${CAP_MS / 1000}s/source`);
  console.log(`titles: ${JSON.stringify(prefsList.map((p) => p.includeKeywords))}`);
  console.log(`locations: ${JSON.stringify(prefsList.map((p) => p.locationKeywords))}`);
  const active = await prisma.atsCompany.count({ where: { active: true } });
  console.log(`active ATS boards: ${active}`);

  await run("sheet", () => fetchSheetLeads());
  await run("jobfound", () => fetchJobfoundLeads());
  await run("hn", () => fetchHnLeads(new Set()));
  await run("weworkremotely", () => fetchWeWorkRemotelyLeads(prefsList));
  await run("remoteok", () => fetchRemoteOkLeads(prefsList));
  await run("remotive", () => fetchRemotiveLeads(prefsList));
  await run("instahyre", () => fetchInstahyreLeads(prefsList, new Set()));
  await run("funding", () => runFundingScan());
  await run("ats", () => fetchAtsLeads(prefsList, new Set()));
  await prisma.$disconnect();
  process.exit(0);
}
main();
