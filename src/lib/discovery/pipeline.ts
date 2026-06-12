import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { fetchAtsLeads } from "./ats";
import { fetchHnLeads } from "./hn";
import { fetchJobfoundLeads } from "./jobfound";
import { fetchSheetLeads } from "./sheet";
import { scoreNewLeads, type ScoreOptions } from "./score";
import { ensureSearchPrefs, type SearchPrefs } from "../searchPrefs";
import type { FetchResult, RawLead } from "./types";

// Multi-user discovery: the four sources are fetched ONCE per tick and ingested
// into the GLOBAL JobLead catalog (a shared list, same for everyone). Each user's
// scan then fit-scores the new catalog postings with their own key/profile into
// their UserLead overlay (recorded as their ScanRun).

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
  // Catalog ingest is global (once per fetch); these stats are shared by every
  // user's ScanRun for this fetch.
  sourceStats: SourceStats[];
  created: number; // new catalog postings added by this fetch
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
  __userScoring?: Map<string, Promise<ScoringResult>>;
  __userScoringProgress?: Map<string, ScoringProgress>;
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

  // The union of participants' prefs drives the firehose prefilter — the shared
  // catalog keeps anything at least one participant cares about.
  const prefsList: SearchPrefs[] = [];
  for (const id of participantIds) prefsList.push(await ensureSearchPrefs(id));

  // Postings the shared catalog already holds WITH a job description: those skip
  // the per-job Greenhouse JD request and HN LLM re-extraction. A catalog row
  // missing its JD is left fetchable so it can be enriched.
  const haveJd = await prisma.jobLead.findMany({
    where: { jdText: { not: null } },
    select: { source: true, externalId: true },
  });
  const seenByAll = new Set(haveJd.map((l) => `${l.source}::${l.externalId}`));

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

    // Ingest into the shared catalog ONCE (dedupe across sources + history).
    const { stats, created } = await ingestCatalog(results);

    await prisma.fetchRun.update({
      where: { id: fetchRun.id },
      data: { finishedAt: new Date(), sourceStats: JSON.stringify(stats) },
    });
    return { fetchRunId: fetchRun.id, startedAt: fetchRun.startedAt, results, sourceStats: stats, created };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.fetchRun
      .update({ where: { id: fetchRun.id }, data: { finishedAt: new Date(), error: msg } })
      .catch(() => {});
    throw e;
  }
}

// ── Global catalog ingest ─────────────────────────────────────────────────────

type CatalogRow = {
  id: string;
  source: string;
  externalId: string;
  canonicalUrl: string | null;
  sources: string | null;
  jdText: string | null;
};

// Upserts fetched postings into the global JobLead catalog: dedupe by
// (source, externalId), cross-source-merge by canonical URL, enrich a JD-less
// row when a later source carries the description. Runs once per fetch.
async function ingestCatalog(
  results: FetchResult[]
): Promise<{ stats: SourceStats[]; created: number }> {
  const existing = await prisma.jobLead.findMany({
    select: { id: true, source: true, externalId: true, canonicalUrl: true, sources: true, jdText: true },
  });
  const bySourceId = new Map<string, CatalogRow>();
  const byCanonical = new Map<string, CatalogRow>();
  for (const l of existing) {
    bySourceId.set(`${l.source}::${l.externalId}`, l);
    if (l.canonicalUrl) byCanonical.set(l.canonicalUrl, l);
  }

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
      const existingRow = bySourceId.get(sourceKey);
      if (existingRow) {
        // Same posting already in the catalog — enrich a missing JD if we now have one.
        if (!existingRow.jdText && lead.jdText) {
          await prisma.jobLead.update({ where: { id: existingRow.id }, data: { jdText: lead.jdText } });
          existingRow.jdText = lead.jdText;
        }
        s.duplicates++;
        continue;
      }

      const canonical = canonicalizeUrl(lead.url);
      const cross = canonical ? byCanonical.get(canonical) : undefined;
      if (cross) {
        // Same posting found via another source — record the extra source label.
        const sources = cross.sources ?? cross.source;
        if (!sources.split(",").includes(lead.source)) {
          const merged = `${sources},${lead.source}`;
          await prisma.jobLead.update({
            where: { id: cross.id },
            data: { sources: merged, jdText: cross.jdText ?? lead.jdText ?? null },
          });
          cross.sources = merged;
          if (!cross.jdText && lead.jdText) cross.jdText = lead.jdText;
        }
        bySourceId.set(sourceKey, cross);
        s.duplicates++;
        continue;
      }

      let row;
      try {
        row = await prisma.jobLead.create({
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
          },
          select: { id: true, source: true, externalId: true, canonicalUrl: true, sources: true, jdText: true },
        });
      } catch (e: unknown) {
        // Another fetch in flight can insert the same posting between our snapshot
        // and this create — that's a duplicate, not a failure.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          s.duplicates++;
          continue;
        }
        throw e;
      }
      bySourceId.set(sourceKey, row);
      if (canonical) byCanonical.set(canonical, row);
      s.created++;
      createdTotal++;
    }

    stats.push(s);
  }

  return { stats, created: createdTotal };
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

// ── Standalone scoring ("Score now") ──────────────────────────────────────────

// Fit-scoring the shared catalog is decoupled from scanning: any user (not just
// scanners) can score the catalog with their own key on demand. It runs as its
// own long-running task — per-user lock + progress + a ScanRun row — so it
// survives a tab close and rejects duplicate kicks (the CLAUDE.md pattern).

export interface ScoringProgress {
  scanRunId: string | null;
  startedAt: string;
  phase: string; // "scoring" | "done"
  scored: number;
}

export interface ScoringResult {
  scanRunId: string;
  scored: number;
  total: number;
  error?: string;
}

function userScoring(): Map<string, Promise<ScoringResult>> {
  return (g.__userScoring ??= new Map());
}
function scoringProgressMap(): Map<string, ScoringProgress> {
  return (g.__userScoringProgress ??= new Map());
}

export function getUserScoringProgress(userId: string): ScoringProgress | null {
  const p = scoringProgressMap().get(userId);
  return p ? { ...p } : null;
}

export function runUserScoring(
  userId: string,
  opts: Pick<ScoreOptions, "maxPerScan" | "recencyDays"> = {}
): Promise<ScoringResult> {
  const tasks = userScoring();
  const existing = tasks.get(userId);
  if (existing) return existing;

  scoringProgressMap().set(userId, {
    scanRunId: null,
    startedAt: new Date().toISOString(),
    phase: "scoring",
    scored: 0,
  });
  const patch = (n: number) => {
    const p = scoringProgressMap().get(userId);
    if (p) p.scored = n;
  };
  const p = (async (): Promise<ScoringResult> => {
    // trigger "score" marks a score-only run (no catalog fetch) so the scan
    // status/history endpoints don't mistake it for a scan.
    const scanRun = await prisma.scanRun.create({ data: { userId, trigger: "score" } });
    const sp = scoringProgressMap().get(userId);
    if (sp) sp.scanRunId = scanRun.id;
    try {
      const r = await scoreNewLeads(userId, { ...opts, scanRunId: scanRun.id }, patch);
      await prisma.scanRun.update({
        where: { id: scanRun.id },
        data: { finishedAt: new Date(), created: 0, scored: r.scored, error: r.error ?? null },
      });
      return { scanRunId: scanRun.id, scored: r.scored, total: r.total, error: r.error };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.scanRun
        .update({ where: { id: scanRun.id }, data: { finishedAt: new Date(), error: msg } })
        .catch(() => {});
      throw e;
    }
  })().finally(() => {
    tasks.delete(userId);
    scoringProgressMap().delete(userId);
  });
  tasks.set(userId, p);
  return p;
}

// Fire-and-forget kick-off for POST /api/discovery/score.
export function startUserScoring(
  userId: string,
  opts: Pick<ScoreOptions, "maxPerScan" | "recencyDays"> = {}
): { alreadyRunning: boolean; progress: ScoringProgress } {
  const alreadyRunning = userScoring().has(userId);
  if (!alreadyRunning) {
    runUserScoring(userId, opts).catch(() => {});
  }
  return { alreadyRunning, progress: getUserScoringProgress(userId)! };
}

// The shared catalog is already refreshed by the global fetch; a user's fan-out
// just records their ScanRun and fit-scores the new catalog postings with their
// own key/profile (their saved scoring controls).
async function fanOutUser(
  userId: string,
  fetched: GlobalFetchOutput,
  trigger: string
): Promise<UserScanResult> {
  const scanRun = await prisma.scanRun.create({
    data: { userId, trigger, fetchRunId: fetched.fetchRunId },
  });
  patchProgress(userId, { scanRunId: scanRun.id, phase: "scoring new leads" });
  try {
    const scoring = await scoreNewLeads(userId, { scanRunId: scanRun.id }, (n) =>
      patchProgress(userId, { created: n })
    );
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        finishedAt: new Date(),
        created: fetched.created,
        scored: scoring.scored,
        sourceStats: JSON.stringify(fetched.sourceStats),
        error: scoring.error ?? null,
      },
    });
    return {
      scanRunId: scanRun.id,
      fetchRunId: fetched.fetchRunId,
      sources: fetched.sourceStats,
      created: fetched.created,
      scored: scoring.scored,
      scoreError: scoring.error,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.scanRun
      .update({ where: { id: scanRun.id }, data: { finishedAt: new Date(), error: msg } })
      .catch(() => {});
    throw e;
  }
}

// ── Full tick (cron / script) ───────────────────────────────────────────────

export interface FullTickResult {
  fetchRunId: string | null;
  users: { userId: string; email: string; result?: UserScanResult; error?: string }[];
}

// One scheduled tick (or an admin "scan everybody"): refresh the shared catalog
// once, then sequential fan-out scoring over every discovery-enabled user. One
// user's failure never blocks the others. `extraParticipants` widens the fetch's
// firehose prefilter and forces a catalog refresh even with no enabled users —
// used by the admin scan so the catalog updates regardless.
export async function runFullTick(
  trigger: "cron" | "script" = "cron",
  extraParticipants: string[] = []
): Promise<FullTickResult> {
  const users = await prisma.user.findMany({
    where: { searchPref: { is: { discoveryEnabled: true } } },
    select: { id: true, email: true },
  });
  if (users.length === 0 && extraParticipants.length === 0) {
    return { fetchRunId: null, users: [] };
  }

  const fetched = await runGlobalFetch(trigger, extraParticipants);
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
