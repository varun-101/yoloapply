import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SOURCE_LABEL, SOURCE_TIER } from "@/lib/discovery/types";
import { ACTED_LEAD_STATUSES } from "@/lib/discovery/leadStatus";
import { escapeLike, utc } from "@/lib/mcp/jobSearch";
import { requireUser, apiError } from "@/lib/auth";

export type LeadSort = "trust" | "newest" | "oldest" | "score" | "company";

const VALID_SORTS: LeadSort[] = ["trust", "newest", "oldest", "score", "company"];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
// Callers that don't ask for a page (scan history, the extension) get one
// unpaged array, capped like before.
const LEGACY_CAP = 500;

const EFFECTIVE_AT = Prisma.sql`COALESCE(jl."postedAt", jl."createdAt")`;

// Search fields and how much a hit in each counts toward relevance. Each space-
// separated term must hit at least one field; the best field per term is summed.
// shortcut: unindexed ILIKE (~0.5s over ~14k rows / 33 MB of JD text), add a
// pg_trgm GIN index on jdText/company/role if the catalog grows several-fold.
type SearchField = { weight: number; match: (pattern: string, term: string) => Prisma.Sql };
const col =
  (c: string): SearchField["match"] =>
  (p) =>
    Prisma.sql`${Prisma.raw(c)} ILIKE ${p}`;
const SEARCH_FIELDS: SearchField[] = [
  { weight: 100, match: col("jl.company") },
  { weight: 60, match: col("jl.role") },
  { weight: 25, match: col("jl.skills") },
  { weight: 20, match: col("jl.location") },
  { weight: 20, match: col(`jl."contactEmail"`) },
  {
    // Sources match on the raw key and on the human label ("freshers" finds sheet).
    weight: 15,
    match: (p, term) => {
      const keys = Object.keys(SOURCE_LABEL).filter((k) => SOURCE_LABEL[k].toLowerCase().includes(term));
      const pats = [p, ...keys.map((k) => `%${k}%`)];
      return Prisma.sql`(${Prisma.join(
        pats.map((x) => Prisma.sql`COALESCE(jl.sources, jl.source) ILIKE ${x}`),
        " OR "
      )})`;
    },
  },
  { weight: 10, match: col("jl.salary") },
  { weight: 10, match: col(`jl."jobType"`) },
  { weight: 10, match: col("jl.experience") },
  { weight: 5, match: col(`ul."scoreReason"`) },
  { weight: 1, match: col(`jl."jdText"`) },
];

function searchTerms(q: string | null): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.slice(0, 100));
}

function orderBy(sort: LeadSort): Prisma.Sql {
  switch (sort) {
    case "newest":
      return Prisma.sql`${EFFECTIVE_AT} DESC`;
    case "oldest":
      return Prisma.sql`${EFFECTIVE_AT} ASC`;
    case "score":
      // Unscored leads sink to the bottom rather than mixing in at zero.
      return Prisma.sql`COALESCE(ul.score, -1) DESC, ${EFFECTIVE_AT} DESC`;
    case "company":
      return Prisma.sql`lower(jl.company) ASC, ${EFFECTIVE_AT} DESC`;
    default: {
      // Trusted sources first, newest within each tier.
      const tiers = Object.entries(SOURCE_TIER).map(
        ([s, t]) => Prisma.sql`WHEN ${s} THEN ${Prisma.raw(String(t))}`
      );
      return Prisma.sql`CASE jl.source ${Prisma.join(tiers, " ")} ELSE 9 END ASC, ${EFFECTIVE_AT} DESC`;
    }
  }
}

// Sorting, search and paging all happen in SQL, so every page is a true slice
// of the whole filtered catalog (the per-user score and status come from the
// LEFT JOINed overlay row; [userId, jobLeadId] is unique, so it never fans out).
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "new";
    const source = sp.get("source");
    const jobType = sp.get("jobType");
    const days = Number(sp.get("days") ?? 0);
    const scannedDays = Number(sp.get("scannedDays") ?? 0);
    const sortParam = sp.get("sort") ?? "trust";
    const sort: LeadSort = VALID_SORTS.includes(sortParam as LeadSort) ? (sortParam as LeadSort) : "trust";
    const scanRunId = sp.get("scanRunId");
    const paged = sp.has("page");
    const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
    const pageSize = paged
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(sp.get("pageSize")) || DEFAULT_PAGE_SIZE)))
      : LEGACY_CAP;
    const terms = searchTerms(sp.get("q"));

    const w: Prisma.Sql[] = [];
    if (source) w.push(Prisma.sql`(jl.source = ${source} OR jl.sources LIKE ${"%" + escapeLike(source) + "%"})`);
    if (jobType) w.push(Prisma.sql`jl."jobType" = ${jobType}`);
    if (days > 0) {
      // Window on when it was posted, falling back to when we ingested it: many
      // sheet rows ship without a postedAt and would otherwise vanish.
      w.push(Prisma.sql`${EFFECTIVE_AT} >= ${utc(new Date(Date.now() - days * 86_400_000))}`);
    }
    // "Recently scanned": when the catalog discovered the posting, regardless of
    // how old the posting itself is.
    if (scannedDays > 0) {
      w.push(Prisma.sql`jl."createdAt" >= ${utc(new Date(Date.now() - scannedDays * 86_400_000))}`);
    }

    // Per-user overlay filters. A scan-history view (scanRunId) shows the leads
    // that run scored for this user; otherwise filter by the user's status.
    if (scanRunId) w.push(Prisma.sql`ul."scanRunId" = ${scanRunId}`);
    // Starred leads in any status, so a promoted or dismissed favorite still shows.
    else if (status === "favorites") w.push(Prisma.sql`ul."favoritedAt" IS NOT NULL`);
    else if ((ACTED_LEAD_STATUSES as string[]).includes(status)) w.push(Prisma.sql`ul.status = ${status}`);
    // "new" = catalog rows the user hasn't promoted, dismissed or marked closed.
    else if (status === "new") {
      w.push(Prisma.sql`(ul.status IS NULL OR NOT (ul.status = ANY(${ACTED_LEAD_STATUSES}::text[])))`);
    } // status === "all" → no overlay filter

    const relevance: Prisma.Sql[] = [];
    for (const term of terms) {
      const pattern = "%" + escapeLike(term) + "%";
      w.push(Prisma.sql`(${Prisma.join(SEARCH_FIELDS.map((f) => f.match(pattern, term)), " OR ")})`);
      const hits = SEARCH_FIELDS.map(
        (f) => Prisma.sql`CASE WHEN ${f.match(pattern, term)} THEN ${Prisma.raw(String(f.weight))} ELSE 0 END`
      );
      relevance.push(Prisma.sql`GREATEST(${Prisma.join(hits)})`);
    }

    const from = Prisma.sql`FROM "JobLead" jl LEFT JOIN "UserLead" ul ON ul."jobLeadId" = jl.id AND ul."userId" = ${user.id}`;
    const where = w.length ? Prisma.sql`WHERE ${Prisma.join(w, " AND ")}` : Prisma.empty;
    // With a search active the strongest matches (company/role) lead and the
    // chosen sort breaks ties; the id keeps page boundaries stable either way.
    const order = relevance.length
      ? Prisma.sql`ORDER BY (${Prisma.join(relevance, " + ")}) DESC, ${orderBy(sort)}, jl.id`
      : Prisma.sql`ORDER BY ${orderBy(sort)}, jl.id`;

    const [idRows, countRows] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`SELECT jl.id ${from} ${where} ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      paged ? prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${from} ${where}` : Promise.resolve([]),
    ]);

    const ids = idRows.map((r) => r.id);
    const rows = await prisma.jobLead.findMany({
      where: { id: { in: ids } },
      include: {
        userLeads: {
          where: { userId: user.id },
          select: { status: true, score: true, scoreReason: true, applicationId: true, favoritedAt: true },
        },
      },
    });
    const position = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => position.get(a.id)! - position.get(b.id)!);

    // Flatten the overlay onto each catalog row (defaults when no overlay exists).
    const leads = rows.map((l) => {
      const ul = l.userLeads[0];
      const { userLeads: _omit, ...rest } = l;
      void _omit;
      return {
        ...rest,
        status: ul?.status ?? "new",
        score: ul?.score ?? null,
        scoreReason: ul?.scoreReason ?? null,
        applicationId: ul?.applicationId ?? null,
        favorite: !!ul?.favoritedAt,
      };
    });

    if (!paged) return NextResponse.json(leads);
    return NextResponse.json({ leads, total: countRows[0]?.n ?? 0, page, pageSize });
  } catch (e) {
    return apiError(e);
  }
}
