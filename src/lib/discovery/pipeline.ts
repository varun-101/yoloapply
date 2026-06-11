import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { fetchAtsLeads } from "./ats";
import { fetchHnLeads } from "./hn";
import { fetchJobfoundLeads } from "./jobfound";
import { fetchSheetLeads } from "./sheet";
import { scoreNewLeads } from "./score";
import type { RawLead } from "./types";

// Params that only track where a click came from. Everything else (ATS tokens,
// posting ids) must survive canonicalization or Greenhouse-style embed URLs
// would all collapse into one.
const TRACKING_PARAMS = new Set([
  "src",
  "source",
  "gh_src",
  "ref",
  "trk",
  "trackingid",
  "alternatechannel",
  "ebp",
  "lipi",
]);

export function canonicalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    u.searchParams.sort();
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function normKey(company: string, role: string): string {
  return `${company}::${role}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface SourceStats {
  source: string;
  fetched: number;
  created: number;
  duplicates: number;
  alreadyApplied: number;
  error?: string;
}

export interface DiscoveryRunResult {
  scanRunId: string;
  sources: SourceStats[];
  created: number;
  scored: number;
  scoreError?: string;
}

export interface DiscoveryProgress {
  scanRunId: string | null;
  startedAt: string;
  trigger: string;
  phase: string;
  sourcesDone: number;
  sourcesTotal: number;
  created: number;
}

// A scan takes minutes — if one is already running (double-click, button hit
// while the scheduled script runs), join it instead of racing it on inserts.
// Lock and progress live on globalThis so they survive dev HMR (same trick as
// the PrismaClient cache in db.ts) and are visible to the status GET handler.
type DiscoveryGlobal = {
  __discoveryRun?: Promise<DiscoveryRunResult> | null;
  __discoveryProgress?: DiscoveryProgress | null;
};
const g = globalThis as unknown as DiscoveryGlobal;

export function getDiscoveryProgress(): DiscoveryProgress | null {
  return g.__discoveryProgress ?? null;
}

function prog(patch: Partial<DiscoveryProgress>) {
  if (g.__discoveryProgress) Object.assign(g.__discoveryProgress, patch);
}

export function runDiscovery(trigger: "dashboard" | "script" = "dashboard"): Promise<DiscoveryRunResult> {
  if (!g.__discoveryRun) {
    g.__discoveryProgress = {
      scanRunId: null,
      startedAt: new Date().toISOString(),
      trigger,
      phase: "starting",
      sourcesDone: 0,
      sourcesTotal: 4,
      created: 0,
    };
    g.__discoveryRun = doRunDiscovery(trigger).finally(() => {
      g.__discoveryRun = null;
      g.__discoveryProgress = null;
    });
  }
  return g.__discoveryRun;
}

// Fire-and-forget kick-off for the API route: the response must not be tied to
// the run — outcome is persisted on the ScanRun row and the frontend polls.
export function startDiscovery(trigger: "dashboard" | "script" = "dashboard"): {
  alreadyRunning: boolean;
  progress: DiscoveryProgress;
} {
  const alreadyRunning = !!g.__discoveryRun;
  if (!alreadyRunning) {
    runDiscovery(trigger).catch(() => {});
  }
  return { alreadyRunning, progress: getDiscoveryProgress()! };
}

async function doRunDiscovery(trigger: string): Promise<DiscoveryRunResult> {
  const scanRun = await prisma.scanRun.create({ data: { trigger } });
  prog({ scanRunId: scanRun.id, startedAt: scanRun.startedAt.toISOString() });
  try {
    const result = await ingestAndScore(scanRun.id);
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        finishedAt: new Date(),
        created: result.created,
        scored: result.scored,
        sourceStats: JSON.stringify(result.sources),
        error: result.scoreError ?? null,
      },
    });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.scanRun
      .update({ where: { id: scanRun.id }, data: { finishedAt: new Date(), error: msg } })
      .catch(() => {});
    throw e;
  }
}

async function ingestAndScore(scanRunId: string): Promise<DiscoveryRunResult> {
  const [existingLeads, applications] = await Promise.all([
    prisma.jobLead.findMany({
      select: { id: true, source: true, externalId: true, canonicalUrl: true, sources: true },
    }),
    prisma.application.findMany({ select: { company: true, role: true, applyUrl: true } }),
  ]);

  const seenSourceIds = new Set(existingLeads.map((l) => `${l.source}::${l.externalId}`));

  // The ATS fetcher takes the seen ids so it can skip per-job JD requests for
  // postings that would be deduped below anyway.
  prog({ phase: "fetching sources" });
  const tick = <T,>(p: Promise<T>): Promise<T> =>
    p.then((r) => {
      if (g.__discoveryProgress) g.__discoveryProgress.sourcesDone++;
      return r;
    });
  const [sheet, jobfound, ats, hn] = await Promise.all([
    tick(fetchSheetLeads()),
    tick(fetchJobfoundLeads()),
    tick(fetchAtsLeads(seenSourceIds)),
    tick(fetchHnLeads()),
  ]);
  prog({ phase: "processing leads" });
  const results = [sheet, jobfound, ...ats, hn];
  const byCanonical = new Map<string, { id: string; sources: string | null; source: string }>();
  for (const l of existingLeads) {
    if (l.canonicalUrl) byCanonical.set(l.canonicalUrl, l);
  }
  const appliedUrls = new Set(
    applications.map((a) => canonicalizeUrl(a.applyUrl ?? undefined)).filter(Boolean)
  );
  const appliedKeys = new Set(applications.map((a) => normKey(a.company, a.role)));

  const stats: SourceStats[] = [];
  let createdTotal = 0;

  for (const result of results) {
    const s: SourceStats = {
      source: result.source,
      fetched: result.leads.length,
      created: 0,
      duplicates: 0,
      alreadyApplied: 0,
      error: result.error,
    };

    for (const lead of result.leads) {
      const sourceKey = `${lead.source}::${lead.externalId}`;
      if (seenSourceIds.has(sourceKey)) {
        s.duplicates++;
        continue;
      }
      seenSourceIds.add(sourceKey);

      const canonical = canonicalizeUrl(lead.url);

      // Same posting already ingested from another source — record the extra
      // source on the existing lead instead of duplicating it.
      const cross = canonical ? byCanonical.get(canonical) : undefined;
      if (cross) {
        const sources = cross.sources ?? cross.source;
        if (!sources.split(",").includes(lead.source)) {
          await prisma.jobLead.update({
            where: { id: cross.id },
            data: { sources: `${sources},${lead.source}` },
          });
          cross.sources = `${sources},${lead.source}`;
        }
        s.duplicates++;
        continue;
      }

      // Already-applied guard: skip postings matching an existing application.
      if ((canonical && appliedUrls.has(canonical)) || appliedKeys.has(normKey(lead.company, lead.role))) {
        s.alreadyApplied++;
        continue;
      }

      let created;
      try {
        created = await prisma.jobLead.create({
          data: {
            source: lead.source,
            externalId: lead.externalId,
            company: lead.company,
            role: lead.role,
            location: lead.location ?? null,
            url: lead.url ?? null,
            canonicalUrl: canonical ?? null,
            jdText: lead.jdText ?? null,
            salary: lead.salary ?? null,
            jobType: lead.jobType ?? null,
            experience: lead.experience ?? null,
            skills: lead.skills ?? null,
            contactEmail: lead.contactEmail ?? null,
            postedAt: lead.postedAt ?? null,
            scanRunId,
          },
        });
      } catch (e: unknown) {
        // A scan in another process (scheduled script vs. dashboard button)
        // can insert the same lead between our snapshot and this create —
        // that's just a duplicate, not a failure.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          s.duplicates++;
          continue;
        }
        throw e;
      }
      if (canonical) {
        byCanonical.set(canonical, { id: created.id, sources: null, source: lead.source });
      }
      s.created++;
      createdTotal++;
      prog({ created: createdTotal });
    }

    stats.push(s);
  }

  prog({ phase: "scoring new leads" });
  const scoring = await scoreNewLeads();

  return {
    scanRunId,
    sources: stats,
    created: createdTotal,
    scored: scoring.scored,
    scoreError: scoring.error,
  };
}

export type { RawLead };
