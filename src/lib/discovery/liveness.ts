import { prisma } from "../db";

// Is a catalog posting still open? Answered from the ATS's own public job API
// (Greenhouse, Lever, Ashby), never by scraping a careers page: those APIs
// return a clean 404 / absent id for a closed posting, while HTML pages vary
// and some boards serve bot challenges. Anything else is "unknown", and
// unknown is never treated as closed.
//
// Results are cached on globalThis (same single-instance caveat as the
// discovery locks): an agent paging search_jobs re-checks the same postings,
// and two users' agents often look at the same popular jobs.

export type LivenessStatus = "open" | "closed" | "unknown";

export interface LivenessResult {
  status: LivenessStatus;
  checkedAt: string;
  /** e.g. "greenhouse_api", "lever_api", "ashby_board", or why it couldn't be checked. */
  method: string;
}

export interface AtsPosting {
  ats: "greenhouse" | "lever" | "ashby";
  slug: string;
  id: string;
  eu?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FETCH_TIMEOUT_MS = 8_000;
const OPEN_TTL_MS = 30 * 60 * 1000;
const CLOSED_TTL_MS = 6 * 60 * 60 * 1000;
const BOARD_TTL_MS = 10 * 60 * 1000;

/** Board slug + posting id from a hosted ATS posting URL. Pure. */
export function atsPostingFromUrl(raw: string | null | undefined): AtsPosting | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const forSlug = url.searchParams.get("for");
    const token = url.searchParams.get("token");
    if (forSlug && token && /^\d+$/.test(token)) return { ats: "greenhouse", slug: forSlug, id: token };
    const i = parts.indexOf("jobs");
    if (i >= 1 && /^\d+$/.test(parts[i + 1] ?? "")) return { ats: "greenhouse", slug: parts[i - 1], id: parts[i + 1] };
    return null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    if (parts.length >= 2 && UUID.test(parts[1])) {
      return { ats: "lever", slug: parts[0], id: parts[1].toLowerCase(), eu: host.includes(".eu.") };
    }
    return null;
  }
  if (host === "jobs.ashbyhq.com") {
    if (parts.length >= 2 && UUID.test(parts[1])) return { ats: "ashby", slug: parts[0], id: parts[1].toLowerCase() };
    return null;
  }
  return null;
}

type Cache = Map<string, { result: LivenessResult; expires: number }>;
type BoardCache = Map<string, { ids: Set<string> | null; expires: number }>;
const g = globalThis as unknown as { __jobLiveness?: Cache; __ashbyBoards?: BoardCache };
const cache: Cache = (g.__jobLiveness ??= new Map());
const ashbyBoards: BoardCache = (g.__ashbyBoards ??= new Map());

function result(status: LivenessStatus, method: string): LivenessResult {
  return { status, method, checkedAt: new Date().toISOString() };
}

async function httpStatus(url: string): Promise<{ status: number; body?: unknown } | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status !== 200) return { status: res.status };
    return { status: 200, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

async function ashbyBoardIds(slug: string): Promise<Set<string> | null> {
  const hit = ashbyBoards.get(slug);
  if (hit && hit.expires > Date.now()) return hit.ids;
  const res = await httpStatus(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
  const jobs = res?.status === 200 ? (res.body as { jobs?: { id?: string }[] } | null)?.jobs : null;
  const ids = Array.isArray(jobs) ? new Set(jobs.map((j) => String(j.id ?? "").toLowerCase()).filter(Boolean)) : null;
  // A failed board fetch is remembered briefly too, so one dead board isn't
  // re-requested for every posting on a page.
  ashbyBoards.set(slug, { ids, expires: Date.now() + (ids ? BOARD_TTL_MS : 60_000) });
  return ids;
}

/** Asks the ATS whether one posting is still listed. Network; cached. */
export async function checkAtsPosting(p: AtsPosting, opts: { network?: boolean } = {}): Promise<LivenessResult> {
  const key = `${p.ats}:${p.slug}:${p.id}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.result;
  if (opts.network === false) return result("unknown", "check_budget_spent");

  let out: LivenessResult;
  if (p.ats === "ashby") {
    const ids = await ashbyBoardIds(p.slug);
    out = ids ? result(ids.has(p.id) ? "open" : "closed", "ashby_board") : result("unknown", "ashby_board_unavailable");
  } else {
    const url =
      p.ats === "greenhouse"
        ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(p.slug)}/jobs/${p.id}`
        : `https://api${p.eu ? ".eu" : ""}.lever.co/v0/postings/${encodeURIComponent(p.slug)}/${p.id}`;
    const res = await httpStatus(url);
    const method = `${p.ats}_api`;
    out = !res ? result("unknown", `${method}_unreachable`) : res.status === 200 ? result("open", method) : res.status === 404 ? result("closed", method) : result("unknown", `${method}_${res.status}`);
  }
  if (out.status !== "unknown") cache.set(key, { result: out, expires: Date.now() + (out.status === "open" ? OPEN_TTL_MS : CLOSED_TTL_MS) });
  return out;
}

export interface LeadForLiveness {
  source: string;
  externalId: string;
  company: string;
  url: string | null;
}

/**
 * A per-call checker: resolves Greenhouse leads whose URL is an employer
 * careers page (?gh_jid=) to their board slug via the AtsCompany watchlist,
 * and stops making network calls once `budgetMs` is spent so a search page
 * never blows its tool timeout (later rows report "unknown").
 */
export function livenessChecker(budgetMs: number) {
  const started = Date.now();
  let ghSlugs: Promise<Map<string, string>> | null = null;
  const greenhouseSlugs = () =>
    (ghSlugs ??= prisma.atsCompany
      .findMany({ where: { ats: "greenhouse" }, select: { slug: true, name: true } })
      .then((rows) => new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.slug]))));

  return async (lead: LeadForLiveness): Promise<LivenessResult> => {
    let posting = atsPostingFromUrl(lead.url);
    if (!posting && lead.source === "greenhouse" && /^\d+$/.test(lead.externalId)) {
      const slug = (await greenhouseSlugs()).get(lead.company.trim().toLowerCase());
      if (slug) posting = { ats: "greenhouse", slug, id: lead.externalId };
    }
    if (!posting) return result("unknown", "not_an_ats_posting");
    return checkAtsPosting(posting, { network: Date.now() - started <= budgetMs });
  };
}
