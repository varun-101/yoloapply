import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { sourceTier, SOURCE_LABEL } from "../discovery/types";
import { livenessChecker, type LivenessResult } from "../discovery/liveness";
import { setLeadStatus } from "../discovery/leadStatus";
import {
  ApplicationIndex,
  describeSalary,
  jdExperienceRequirement,
  jdQualityOf,
  jobExperienceFits,
  type ApplicationRef,
  type DuplicateMatch,
} from "./jobIdentity";

// Agent-facing catalog search. Unlike GET /api/discovery/leads (which keeps the
// newest 500 rows by postedAt, so undated Instahyre rows crowd out or vanish
// behind dated ones), this pages through the WHOLE catalog with a keyset cursor
// over COALESCE(postedAt, createdAt), so every source is reachable and the
// ordering is stable while the catalog grows.

export interface JobSearchFilters {
  status: "new" | "dismissed" | "closed" | "promoted" | "any";
  /** Only jobs the candidate starred in Discover. */
  favoritesOnly?: boolean;
  sources?: string[];
  locations?: string[];
  includeUnknownLocation: boolean;
  roleKeywords?: string[];
  excludeRoleKeywords?: string[];
  companies?: string[];
  jobType?: string;
  maxYearsExperience?: number;
  requireKnownExperience: boolean;
  minScore?: number;
  postedWithinDays?: number;
  requireDescription: boolean;
  duplicatePolicy: "exclude" | "flag";
  sort: "recent" | "score";
  /** Ask Greenhouse/Lever/Ashby whether each result is still listed; closed ones are skipped and marked. */
  verifyLive?: boolean;
}

export interface JobSearchInput extends JobSearchFilters {
  limit: number;
  cursor?: string;
}

interface CursorPayload {
  v: 1;
  f: string; // filter hash, so a cursor can't be replayed against other filters
  at: string; // effectiveAt of the last scanned row
  id: string;
  sc?: number; // score of the last scanned row (sort=score)
}

interface Row {
  id: string;
  source: string;
  sources: string | null;
  externalId: string;
  company: string;
  role: string;
  location: string | null;
  url: string | null;
  canonicalUrl: string | null;
  salary: string | null;
  jobType: string | null;
  experience: string | null;
  postedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  effectiveAt: Date;
  jdLength: number | null;
  jdHead: string | null;
  /** Full description, selected only when an experience filter needs it. */
  jdText: string | null;
  userStatus: string | null;
  score: number | null;
  scoreReason: string | null;
  applicationId: string | null;
  favoritedAt: Date | null;
}

const LIVE_CHECK_BUDGET_MS = 20_000;
// Return what was found before the 45 s tool timeout, with a cursor to go on.
const SEARCH_DEADLINE_MS = 30_000;
const LIVE_CHECK_AHEAD = 6;

export function filterHash(filters: JobSearchFilters): string {
  const normalized = JSON.stringify(filters, Object.keys(filters).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string, expectedHash: string): CursorPayload {
  let parsed: CursorPayload;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
  } catch {
    throw new ApiUserError("Invalid cursor. Start again without a cursor.", 400, "invalid_cursor");
  }
  if (parsed?.v !== 1 || typeof parsed.id !== "string" || typeof parsed.at !== "string" || Number.isNaN(Date.parse(parsed.at))) {
    throw new ApiUserError("Invalid cursor. Start again without a cursor.", 400, "invalid_cursor");
  }
  if (parsed.f !== expectedHash) {
    throw new ApiUserError(
      "This cursor belongs to a search with different filters. Repeat the original filters or start without a cursor.",
      400,
      "cursor_filter_mismatch"
    );
  }
  return parsed;
}

function likeAny(column: Prisma.Sql, terms: string[]): Prisma.Sql {
  const parts = terms.map((t) => Prisma.sql`${column} ILIKE ${"%" + escapeLike(t) + "%"}`);
  return Prisma.sql`(${Prisma.join(parts, " OR ")})`;
}

// The columns are timestamp(3) WITHOUT time zone holding UTC. A bound JS Date
// arrives as timestamptz and would be shifted by the session time zone, so
// compare against the UTC wall-clock value explicitly.
export function utc(date: Date): Prisma.Sql {
  return Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereClauses(f: JobSearchFilters, excludeUrls: string[]): Prisma.Sql[] {
  const w: Prisma.Sql[] = [];
  if (f.status === "new") w.push(Prisma.sql`(ul.status IS NULL OR ul.status = 'new')`);
  else if (f.status !== "any") w.push(Prisma.sql`ul.status = ${f.status}`);
  if (f.favoritesOnly) w.push(Prisma.sql`ul."favoritedAt" IS NOT NULL`);

  if (f.sources?.length) {
    const parts = f.sources.map(
      (s) => Prisma.sql`(jl.source = ${s} OR ${s} = ANY(string_to_array(replace(COALESCE(jl.sources, ''), ' ', ''), ',')))`
    );
    w.push(Prisma.sql`(${Prisma.join(parts, " OR ")})`);
  }
  if (f.locations?.length) {
    const loc = likeAny(Prisma.sql`jl.location`, f.locations);
    w.push(f.includeUnknownLocation ? Prisma.sql`(${loc} OR jl.location IS NULL OR jl.location = '')` : loc);
  }
  if (f.roleKeywords?.length) w.push(likeAny(Prisma.sql`jl.role`, f.roleKeywords));
  if (f.excludeRoleKeywords?.length) w.push(Prisma.sql`NOT ${likeAny(Prisma.sql`jl.role`, f.excludeRoleKeywords)}`);
  if (f.companies?.length) w.push(likeAny(Prisma.sql`jl.company`, f.companies));
  if (f.jobType) w.push(Prisma.sql`jl."jobType" ILIKE ${escapeLike(f.jobType)}`);
  if (f.minScore !== undefined) w.push(Prisma.sql`ul.score >= ${f.minScore}`);
  if (f.postedWithinDays !== undefined) {
    const since = new Date(Date.now() - f.postedWithinDays * 86_400_000);
    w.push(Prisma.sql`COALESCE(jl."postedAt", jl."createdAt") >= ${utc(since)}`);
  }
  if (f.requireDescription) w.push(Prisma.sql`length(COALESCE(jl."jdText", '')) >= 200`);
  if (f.duplicatePolicy === "exclude") {
    w.push(Prisma.sql`ul."applicationId" IS NULL`);
    if (excludeUrls.length) {
      w.push(Prisma.sql`(jl."canonicalUrl" IS NULL OR NOT (jl."canonicalUrl" = ANY(${excludeUrls}::text[])))`);
    }
  }
  return w;
}

function keysetClause(f: JobSearchFilters, cursor: CursorPayload | null): Prisma.Sql | null {
  if (!cursor) return null;
  const at = new Date(cursor.at);
  if (f.sort === "score") {
    const sc = cursor.sc ?? -1;
    return Prisma.sql`(COALESCE(ul.score, -1), COALESCE(jl."postedAt", jl."createdAt"), jl.id) < (${sc}, ${utc(at)}, ${cursor.id})`;
  }
  return Prisma.sql`(COALESCE(jl."postedAt", jl."createdAt"), jl.id) < (${utc(at)}, ${cursor.id})`;
}

async function fetchBatch(
  userId: string,
  f: JobSearchFilters,
  excludeUrls: string[],
  cursor: CursorPayload | null,
  take: number
): Promise<Row[]> {
  const clauses = whereClauses(f, excludeUrls);
  const keyset = keysetClause(f, cursor);
  if (keyset) clauses.push(keyset);
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
  const order =
    f.sort === "score"
      ? Prisma.sql`ORDER BY COALESCE(ul.score, -1) DESC, COALESCE(jl."postedAt", jl."createdAt") DESC, jl.id DESC`
      : Prisma.sql`ORDER BY COALESCE(jl."postedAt", jl."createdAt") DESC, jl.id DESC`;
  return prisma.$queryRaw<Row[]>`
    SELECT jl.id, jl.source, jl.sources, jl."externalId", jl.company, jl.role, jl.location, jl.url,
           jl."canonicalUrl", jl.salary, jl."jobType", jl.experience, jl."postedAt", jl."createdAt",
           jl."updatedAt", COALESCE(jl."postedAt", jl."createdAt") AS "effectiveAt",
           length(jl."jdText")::int AS "jdLength", left(jl."jdText", 1200) AS "jdHead",
           ${f.maxYearsExperience !== undefined ? Prisma.sql`jl."jdText"` : Prisma.sql`NULL::text`} AS "jdText",
           ul.status AS "userStatus", ul.score, ul."scoreReason", ul."applicationId", ul."favoritedAt"
    FROM "JobLead" jl
    LEFT JOIN "UserLead" ul ON ul."jobLeadId" = jl.id AND ul."userId" = ${userId}
    ${where}
    ${order}
    LIMIT ${take}`;
}

export async function loadApplicationIndex(userId: string): Promise<ApplicationIndex> {
  const apps: ApplicationRef[] = await prisma.application.findMany({
    where: { userId },
    select: {
      id: true,
      company: true,
      role: true,
      status: true,
      appliedAt: true,
      createdAt: true,
      jdUrl: true,
      applyUrl: true,
      canonicalUrl: true,
    },
  });
  return new ApplicationIndex(apps);
}

export function summarizeJob(row: Row, duplicates: DuplicateMatch[], liveness?: LivenessResult) {
  const sources = [...new Set([row.source, ...(row.sources ?? "").split(",").map((s) => s.trim()).filter(Boolean)])];
  return {
    jobId: row.id,
    company: row.company,
    role: row.role,
    location: row.location,
    jobType: row.jobType,
    experience: row.experience,
    // Read from the full description when an experience filter was applied:
    // listing bands ("0-1 yrs") often understate the employer's bar.
    experienceFromDescription: row.jdText ? jdExperienceRequirement(row.jdText) : undefined,
    salary: describeSalary(row.salary),
    url: row.url,
    sources,
    sourceLabel: SOURCE_LABEL[row.source] ?? row.source,
    sourceTier: sourceTier(row.source),
    postedAt: row.postedAt?.toISOString() ?? null,
    firstSeenAt: row.createdAt.toISOString(),
    // Which date ordered this row. "discovered" means the listing carried no
    // posting date (Instahyre never does), so firstSeenAt stood in for it.
    dateBasis: row.postedAt ? "posted" : "discovered",
    jdQuality: jdQualityOf(row.jdLength, row.jdHead),
    fit: row.score === null ? null : { score: row.score, reason: row.scoreReason },
    liveness: liveness ?? null,
    tracking: {
      overlayStatus: row.userStatus ?? "new",
      favorite: row.favoritedAt !== null,
      applicationId: row.applicationId,
      possibleDuplicates: duplicates,
    },
  };
}

export async function searchJobs(userId: string, input: JobSearchInput) {
  const { limit, cursor: cursorText, ...filters } = input;
  const hash = filterHash(filters);
  let cursor = cursorText ? decodeCursor(cursorText, hash) : null;
  const index = await loadApplicationIndex(userId);
  const excludeUrls = filters.duplicatePolicy === "exclude" ? index.canonicalUrls() : [];

  const started = Date.now();
  // Full descriptions ride along when an experience filter needs them, so
  // keep those batches smaller.
  const batchSize = Math.min(filters.maxYearsExperience !== undefined ? 120 : 400, Math.max(60, limit * 4));
  let partial = false;
  const maxScanned = 2_000;
  const results: ReturnType<typeof summarizeJob>[] = [];
  let scanned = 0;
  let exhausted = false;
  const filteredOut = { experience: 0, duplicates: 0, closed: 0 };
  const closedIds: string[] = [];
  // Live checks share the tool's time budget; past it, rows report "unknown".
  const check = filters.verifyLive ? livenessChecker(LIVE_CHECK_BUDGET_MS) : null;

  while (results.length < limit && scanned < maxScanned && !partial) {
    const rows = await fetchBatch(userId, filters, excludeUrls, cursor, batchSize);
    if (!rows.length) {
      exhausted = true;
      break;
    }
    // Cheap filters first, for the whole batch, so live checks can start a few
    // rows ahead of where results are consumed.
    const verdicts = rows.map((row) => {
      if (
        filters.maxYearsExperience !== undefined &&
        !jobExperienceFits(row.experience, row.jdText, filters.maxYearsExperience, filters.requireKnownExperience)
      ) {
        return { row, drop: "experience" as const, dupes: [] as DuplicateMatch[] };
      }
      const dupes = index.match({ urls: [row.url, row.canonicalUrl], company: row.company, role: row.role });
      if (filters.duplicatePolicy === "exclude" && dupes.length) return { row, drop: "duplicates" as const, dupes };
      return { row, drop: null, dupes };
    });
    const candidates = verdicts.filter((v) => !v.drop).map((v) => v.row);
    const checks = new Map<string, Promise<LivenessResult>>();
    const prefetch = (from: number) => {
      if (!check) return;
      for (const row of candidates.slice(from, from + LIVE_CHECK_AHEAD)) {
        if (!checks.has(row.id)) checks.set(row.id, check(row));
      }
    };
    let next = 0;
    for (const { row, drop, dupes } of verdicts) {
      // Stop at a row boundary: the cursor still points at the last row
      // actually consumed, so the next page resumes exactly here.
      if (Date.now() - started > SEARCH_DEADLINE_MS) {
        partial = true;
        break;
      }
      scanned++;
      cursor = { v: 1, f: hash, at: new Date(row.effectiveAt).toISOString(), id: row.id, sc: row.score ?? -1 };
      if (drop) {
        filteredOut[drop]++;
        continue;
      }
      let live: LivenessResult | undefined;
      if (check) {
        prefetch(next);
        live = await checks.get(row.id)!;
        next++;
        if (live.status === "closed") {
          filteredOut.closed++;
          // Only a "new" lead is moved; a dismissal stays a dismissal.
          if (!row.userStatus || row.userStatus === "new") closedIds.push(row.id);
          continue;
        }
      }
      results.push(summarizeJob(row, dupes, live));
      if (results.length >= limit) break;
    }
    if (rows.length < batchSize && results.length < limit) {
      exhausted = true;
      break;
    }
  }

  // The ATS itself says these are gone: record it so Discover and later
  // searches skip them too (per user, like the manual "No longer available").
  for (const id of closedIds) {
    await setLeadStatus(userId, id, "closed").catch(() => {});
  }

  return {
    jobs: results,
    nextCursor: exhausted && results.length < limit ? null : cursor ? encodeCursor(cursor) : null,
    scanned,
    filteredOut,
    markedUnavailable: closedIds,
    ...(partial
      ? { partial: true, note: "Stopped early to stay inside the tool timeout. Results so far are valid; continue with nextCursor (same filters)." }
      : {}),
    timingMs: Date.now() - started,
    ordering:
      filters.sort === "score"
        ? "fit score desc (unscored last), then COALESCE(postedAt, firstSeenAt) desc"
        : "COALESCE(postedAt, firstSeenAt) desc",
  };
}

/** Per-source counts under the same filters (no cursor, no cap). */
export async function sourceSummary(userId: string, filters: JobSearchFilters) {
  const started = Date.now();
  const index = filters.duplicatePolicy === "exclude" ? await loadApplicationIndex(userId) : null;
  const clauses = whereClauses(filters, index?.canonicalUrls() ?? []);
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { source: string; total: number; undated: number; scored: number; newest: Date | null }[]
  >`
    SELECT jl.source, count(*)::int AS total,
           count(*) FILTER (WHERE jl."postedAt" IS NULL)::int AS undated,
           count(ul.score)::int AS scored,
           max(COALESCE(jl."postedAt", jl."createdAt")) AS newest
    FROM "JobLead" jl
    LEFT JOIN "UserLead" ul ON ul."jobLeadId" = jl.id AND ul."userId" = ${userId}
    ${where}
    GROUP BY jl.source
    ORDER BY total DESC`;
  return {
    sources: rows.map((r) => ({
      source: r.source,
      label: SOURCE_LABEL[r.source] ?? r.source,
      tier: sourceTier(r.source),
      total: r.total,
      undated: r.undated,
      scored: r.scored,
      newestAt: r.newest ? new Date(r.newest).toISOString() : null,
    })),
    note:
      "Counts use SQL filters only. Experience and company+role duplicate filters are applied per page in search_jobs, so page totals can be lower.",
    timingMs: Date.now() - started,
  };
}
