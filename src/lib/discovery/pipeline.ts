import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { fetchAtsLeads } from "./ats";
import { fetchHnLeads } from "./hn";
import { fetchJobfoundLeads } from "./jobfound";
import { fetchSheetLeads } from "./sheet";
import { scoreNewLeads } from "./score";
import {
  ensureSearchPrefs,
  titleMatches,
  locationMatches,
  type SearchPrefs,
} from "../searchPrefs";
import type { FetchResult, RawLead } from "./types";

// Multi-user discovery: the four sources are fetched ONCE per tick (a global
// FetchRun — sources return full current snapshots), then fanned out per user:
// each user's keyword/location filters, dedupe and scoring run over the shared
// results and land in their own ScanRun.

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

// Tier-1 sources (sheet, jobfound) are curated for freshers — per-user filters
// only apply to the firehose sources.
const FILTERED_SOURCES = new Set(["greenhouse", "lever", "ashby", "hn"]);

export interface SourceStats {
  source: string;
  fetched: number; // for filtered sources: postings passing THIS user's filters
  created: number;
  duplicates: number;
  alreadyApplied: number;
  error?: string;
}

export interface UserScanResult {
  scanRunId: string;
  fetchRunId: string;
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

interface GlobalFetchOutput {
  fetchRunId: string;
  startedAt: Date;
  results: FetchResult[];
}

interface GlobalFetchState {
  promise: Promise<GlobalFetchOutput>;
  sourcesDone: number;
  sourcesTotal: number;
}

// Locks and progress live on globalThis so they survive dev HMR (same trick as
// the PrismaClient cache in db.ts) and are visible to the status GET handler.
// One global fetch lock (concurrent ticks/scans join the in-flight fetch — the
// CLAUDE.md reference pattern) plus per-user scan locks.
type DiscoveryGlobal = {
  __globalFetch?: GlobalFetchState | null;
  __userScans?: Map<string, Promise<UserScanResult>>;
  __userScanProgress?: Map<string, DiscoveryProgress>;
};
const g = globalThis as unknown as DiscoveryGlobal;

function userScans(): Map<string, Promise<UserScanResult>> {
  return (g.__userScans ??= new Map());
}
function progressMap(): Map<string, DiscoveryProgress> {
  return (g.__userScanProgress ??= new Map());
}
function patchProgress(userId: string, patch: Partial<DiscoveryProgress>) {
  const p = progressMap().get(userId);
  if (p) Object.assign(p, patch);
}

export function getUserScanProgress(userId: string): DiscoveryProgress | null {
  const p = progressMap().get(userId);
  if (!p) return null;
  // While the shared fetch runs, its source counter is the real progress.
  if (p.phase === "fetching sources" && g.__globalFetch) {
    return { ...p, sourcesDone: g.__globalFetch.sourcesDone };
  }
  return { ...p };
}

// ── Global fetch ────────────────────────────────────────────────────────────

// Fetch all sources once. `extraUserIds` widens the participant set beyond
// discovery-enabled users — a manual "Scan now" must see leads matching the
// requesting user's filters even if their scheduled discovery is off.
export function runGlobalFetch(
  trigger: "manual" | "cron" | "script",
  extraUserIds: string[] = []
): Promise<GlobalFetchOutput> {
  if (!g.__globalFetch) {
    const state: GlobalFetchState = {
      promise: Promise.resolve(null as never), // replaced synchronously below
      sourcesDone: 0,
      sourcesTotal: 4,
    };
    g.__globalFetch = state;
    state.promise = doGlobalFetch(trigger, extraUserIds, state).finally(() => {
      g.__globalFetch = null;
    });
  }
  return g.__globalFetch.promise;
}

async function doGlobalFetch(
  trigger: string,
  extraUserIds: string[],
  state: GlobalFetchState
): Promise<GlobalFetchOutput> {
  const enabled = await prisma.user.findMany({
    where: { searchPref: { is: { discoveryEnabled: true } } },
    select: { id: true },
  });
  const participantIds = [...new Set([...enabled.map((u) => u.id), ...extraUserIds])];

  const prefsList: SearchPrefs[] = [];
  for (const id of participantIds) prefsList.push(await ensureSearchPrefs(id));

  // Leads every participant already has: those skip the per-job Greenhouse JD
  // request and HN LLM re-extraction (a lead missing for even one user still
  // needs its detail so that user's fan-out can ingest it complete).
  const seenByAll = new Set<string>();
  if (participantIds.length > 0) {
    const rows = await prisma.jobLead.findMany({
      where: { userId: { in: participantIds } },
      select: { userId: true, source: true, externalId: true },
    });
    const holders = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = `${r.source}::${r.externalId}`;
      let set = holders.get(key);
      if (!set) holders.set(key, (set = new Set()));
      set.add(r.userId);
    }
    for (const [key, set] of holders) {
      if (set.size >= participantIds.length) seenByAll.add(key);
    }
  }

  const fetchRun = await prisma.fetchRun.create({ data: { trigger } });
  try {
    const tick = <T,>(p: Promise<T>): Promise<T> =>
      p.then((r) => {
        state.sourcesDone++;
        return r;
      });
    const [sheet, jobfound, ats, hn] = await Promise.all([
      tick(fetchSheetLeads()),
      tick(fetchJobfoundLeads()),
      tick(fetchAtsLeads(prefsList, seenByAll)),
      tick(fetchHnLeads(seenByAll)),
    ]);
    const results = [sheet, jobfound, ...ats, hn];
    await prisma.fetchRun.update({
      where: { id: fetchRun.id },
      data: {
        finishedAt: new Date(),
        sourceStats: JSON.stringify(
          results.map((r) => ({ source: r.source, fetched: r.leads.length, error: r.error }))
        ),
      },
    });
    return { fetchRunId: fetchRun.id, startedAt: fetchRun.startedAt, results };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.fetchRun
      .update({ where: { id: fetchRun.id }, data: { finishedAt: new Date(), error: msg } })
      .catch(() => {});
    throw e;
  }
}

// ── Per-user fan-out ────────────────────────────────────────────────────────

// Runs one user's scan: joins (or starts) the global fetch, then filters,
// ingests and scores for that user. Per-user lock — a second call for the
// same user joins the in-flight scan instead of racing it on inserts.
export function runUserScan(
  userId: string,
  trigger: "manual" | "cron" | "script" = "manual",
  prefetched?: GlobalFetchOutput
): Promise<UserScanResult> {
  const scans = userScans();
  const existing = scans.get(userId);
  if (existing) return existing;

  progressMap().set(userId, {
    scanRunId: null,
    startedAt: new Date().toISOString(),
    trigger,
    phase: "starting",
    sourcesDone: 0,
    sourcesTotal: 4,
    created: 0,
  });
  const p = (async () => {
    let fetched = prefetched;
    if (!fetched) {
      patchProgress(userId, { phase: "fetching sources" });
      fetched = await runGlobalFetch(trigger, [userId]);
    }
    patchProgress(userId, { phase: "processing leads", sourcesDone: 4 });
    return fanOutUser(userId, fetched, trigger);
  })().finally(() => {
    scans.delete(userId);
    progressMap().delete(userId);
  });
  scans.set(userId, p);
  return p;
}

// Fire-and-forget kick-off for the API route: the response must not be tied to
// the run — outcome is persisted on the ScanRun row and the frontend polls.
export function startUserScan(userId: string): {
  alreadyRunning: boolean;
  progress: DiscoveryProgress;
} {
  const alreadyRunning = userScans().has(userId);
  if (!alreadyRunning) {
    runUserScan(userId, "manual").catch(() => {});
  }
  return { alreadyRunning, progress: getUserScanProgress(userId)! };
}

async function fanOutUser(
  userId: string,
  fetched: GlobalFetchOutput,
  trigger: string
): Promise<UserScanResult> {
  const scanRun = await prisma.scanRun.create({
    data: { userId, trigger, fetchRunId: fetched.fetchRunId },
  });
  patchProgress(userId, { scanRunId: scanRun.id });
  try {
    const result = await ingestAndScore(userId, scanRun.id, fetched);
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

async function ingestAndScore(
  userId: string,
  scanRunId: string,
  fetched: GlobalFetchOutput
): Promise<UserScanResult> {
  const [prefs, existingLeads, applications] = await Promise.all([
    ensureSearchPrefs(userId),
    prisma.jobLead.findMany({
      where: { userId },
      select: { id: true, source: true, externalId: true, canonicalUrl: true, sources: true },
    }),
    prisma.application.findMany({
      where: { userId },
      select: { company: true, role: true, applyUrl: true },
    }),
  ]);

  const seenSourceIds = new Set(existingLeads.map((l) => `${l.source}::${l.externalId}`));
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

  for (const result of fetched.results) {
    // Firehose sources get this user's keyword/location filters; the curated
    // tier-1 sources pass through unfiltered (same rule as the old config.ts).
    const leads = FILTERED_SOURCES.has(result.source)
      ? result.leads.filter(
          (l) => titleMatches(prefs, l.role) && locationMatches(prefs, l.location)
        )
      : result.leads;

    const s: SourceStats = {
      source: result.source,
      fetched: leads.length,
      created: 0,
      duplicates: 0,
      alreadyApplied: 0,
      error: result.error,
    };

    for (const lead of leads) {
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

      // Greenhouse skips the per-job JD request when another user already has
      // the posting — copy their JD text instead of leaving the lead bare.
      let jdText = lead.jdText;
      if (!jdText && lead.source === "greenhouse") {
        const sibling = await prisma.jobLead.findFirst({
          where: { source: lead.source, externalId: lead.externalId, jdText: { not: null } },
          select: { jdText: true },
        });
        jdText = sibling?.jdText ?? undefined;
      }

      let created;
      try {
        created = await prisma.jobLead.create({
          data: {
            userId,
            source: lead.source,
            externalId: lead.externalId,
            company: lead.company,
            role: lead.role,
            location: lead.location ?? null,
            url: lead.url ?? null,
            canonicalUrl: canonical ?? null,
            jdText: jdText ?? null,
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
        // A scan in another process can insert the same lead between our
        // snapshot and this create — that's just a duplicate, not a failure.
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
      patchProgress(userId, { created: createdTotal });
    }

    stats.push(s);
  }

  patchProgress(userId, { phase: "scoring new leads" });
  const scoring = await scoreNewLeads(userId);

  return {
    scanRunId,
    fetchRunId: fetched.fetchRunId,
    sources: stats,
    created: createdTotal,
    scored: scoring.scored,
    scoreError: scoring.error,
  };
}

// ── Full tick (cron / script) ───────────────────────────────────────────────

export interface FullTickResult {
  fetchRunId: string | null;
  users: { userId: string; email: string; result?: UserScanResult; error?: string }[];
}

// One scheduled tick: global fetch, then sequential fan-out over every user
// with discovery enabled. One user's failure never blocks the others.
export async function runFullTick(trigger: "cron" | "script" = "cron"): Promise<FullTickResult> {
  const users = await prisma.user.findMany({
    where: { searchPref: { is: { discoveryEnabled: true } } },
    select: { id: true, email: true },
  });
  if (users.length === 0) return { fetchRunId: null, users: [] };

  const fetched = await runGlobalFetch(trigger);
  const out: FullTickResult = { fetchRunId: fetched.fetchRunId, users: [] };
  for (const u of users) {
    try {
      const result = await runUserScan(u.id, trigger, fetched);
      out.users.push({ userId: u.id, email: u.email, result });
    } catch (e: unknown) {
      out.users.push({ userId: u.id, email: u.email, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export type { RawLead };
