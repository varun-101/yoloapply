import { prisma } from "../db";
import { htmlToText } from "../html";
import { titleMatches, locationMatches, type SearchPrefs } from "../searchPrefs";
import type { FetchResult, RawLead } from "./types";

// Official, unauthenticated job-board APIs. Companies come from the AtsCompany
// table (seeded from the kalil0321/ats-scrapers dataset — see
// scripts/seed-ats-companies.ts). These boards list every open role, so a
// global prefilter applies here: a posting is kept if it matches ANY
// participating user's keyword/location prefs (each user's own filters run
// again at fan-out).

const CONCURRENCY = 12;
const TIMEOUT_MS = 20_000;
// A board that fails this many scans in a row (404 after an ATS migration,
// usually) gets active=false and is skipped until manually revived.
const MAX_CONSECUTIVE_FAILURES = 5;
// Greenhouse JDs need a per-job detail request; cap them per board so one
// giant board can't turn a scan into thousands of requests. Uncapped jobs
// still become leads, just without JD text.
const MAX_JD_FETCHES_PER_BOARD = 25;

interface BoardCompany {
  name: string;
  slug: string;
}

// True when the posting matches at least one participating user's filters.
export type LeadMatcher = (title: string, location: string | undefined, isRemote?: boolean) => boolean;

// Shared by the firehose sources (ATS boards + the remote aggregators): keep a
// posting if ANY participating user's title/location prefs want it.
export function anyUserMatcher(prefsList: SearchPrefs[]): LeadMatcher {
  return (title, location, isRemote) =>
    prefsList.some((p) => titleMatches(p, title) && locationMatches(p, location, isRemote));
}

function get(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Greenhouse ships the JD HTML entity-escaped inside JSON.
function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeJobType(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("intern")) return "Internship";
  if (t.includes("fulltime")) return "Full Time";
  return s;
}

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
}

async function fetchGreenhouse(
  entry: BoardCompany,
  matches: LeadMatcher,
  seenIds: ReadonlySet<string>
): Promise<RawLead[]> {
  // List without content — the matched jobs get a detail fetch below. Pulling
  // content board-wide would download every JD on every board on every scan.
  const res = await get(`https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs`);
  if (!res.ok) throw new Error(`${entry.slug}: HTTP ${res.status}`);
  const json = (await res.json()) as { jobs: GreenhouseJob[] };

  const matched = json.jobs.filter((j) => matches(j.title, j.location?.name));

  let jdFetches = 0;
  const leads: RawLead[] = [];
  for (const j of matched) {
    let detail: GreenhouseJob | undefined;
    if (!seenIds.has(`greenhouse::${j.id}`) && jdFetches < MAX_JD_FETCHES_PER_BOARD) {
      jdFetches++;
      try {
        const dres = await get(`https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs/${j.id}`);
        if (dres.ok) detail = (await dres.json()) as GreenhouseJob;
      } catch {
        // JD is nice-to-have; the lead is still worth ingesting without it.
      }
    }
    const published = j.first_published ?? detail?.first_published;
    const updated = j.updated_at ?? detail?.updated_at;
    leads.push({
      source: "greenhouse",
      externalId: String(j.id),
      company: entry.name,
      role: j.title.trim(),
      location: j.location?.name,
      url: j.absolute_url,
      jdText: detail?.content ? htmlToText(unescapeHtml(detail.content)) : undefined,
      postedAt: published ? new Date(published) : updated ? new Date(updated) : undefined,
    });
  }
  return leads;
}

async function fetchLever(
  entry: BoardCompany,
  matches: LeadMatcher,
  _seenIds: ReadonlySet<string>
): Promise<RawLead[]> {
  const res = await get(`https://api.lever.co/v0/postings/${entry.slug}?mode=json`);
  if (!res.ok) throw new Error(`${entry.slug}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    id: string;
    text: string;
    hostedUrl: string;
    createdAt?: number;
    descriptionPlain?: string;
    categories?: { location?: string; commitment?: string };
  }[];
  return json
    .filter((j) => matches(j.text, j.categories?.location))
    .map((j) => ({
      source: "lever",
      externalId: j.id,
      company: entry.name,
      role: j.text.trim(),
      location: j.categories?.location,
      url: j.hostedUrl,
      jdText: j.descriptionPlain?.trim() || undefined,
      jobType: normalizeJobType(j.categories?.commitment),
      postedAt: j.createdAt ? new Date(j.createdAt) : undefined,
    }));
}

async function fetchAshby(
  entry: BoardCompany,
  matches: LeadMatcher,
  _seenIds: ReadonlySet<string>
): Promise<RawLead[]> {
  const res = await get(`https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`);
  if (!res.ok) throw new Error(`${entry.slug}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    jobs: {
      id: string;
      title: string;
      location?: string;
      isRemote?: boolean;
      isListed?: boolean;
      employmentType?: string;
      publishedAt?: string;
      jobUrl?: string;
      applyUrl?: string;
      descriptionPlain?: string;
    }[];
  };
  return json.jobs
    .filter((j) => j.isListed !== false && matches(j.title, j.location, j.isRemote))
    .map((j) => ({
      source: "ashby",
      externalId: j.id,
      company: entry.name,
      role: j.title.trim(),
      location: j.location,
      url: j.jobUrl ?? j.applyUrl,
      jdText: j.descriptionPlain?.trim() || undefined,
      jobType: normalizeJobType(j.employmentType),
      postedAt: j.publishedAt ? new Date(j.publishedAt) : undefined,
      // Ashby marks remote explicitly; surface it in the location string so
      // the per-user location filters (and the UI) can see it.
      ...(j.isRemote && !/remote/i.test(j.location ?? "")
        ? { location: [j.location, "Remote"].filter(Boolean).join(" · ") }
        : {}),
    }));
}

const FETCHERS = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
} as const;

function summarizeErrors(errors: string[]): string | undefined {
  if (!errors.length) return undefined;
  if (errors.length <= 3) return errors.join("; ");
  return `${errors.slice(0, 3).join("; ")} (+${errors.length - 3} more boards failed)`;
}

// `prefsList` = every participating user's search prefs (the union drives the
// global prefilter). `seenIds` ("source::externalId" already ingested by ALL
// participants) lets the greenhouse fetcher skip JD detail requests for jobs
// every fan-out will dedupe anyway.
export async function fetchAtsLeads(
  prefsList: SearchPrefs[],
  seenIds: ReadonlySet<string> = new Set()
): Promise<FetchResult[]> {
  // Nobody is scanning — don't hit ~1k boards for leads no one will keep.
  if (prefsList.length === 0) {
    return Object.keys(FETCHERS).map((source) => ({ source, leads: [] }));
  }
  const matches = anyUserMatcher(prefsList);
  const companies = await prisma.atsCompany.findMany({ where: { active: true } });

  const byAts = new Map<string, { leads: RawLead[]; errors: string[] }>();
  for (const ats of Object.keys(FETCHERS)) byAts.set(ats, { leads: [], errors: [] });

  const bookkeeping: { id: string; data: Record<string, unknown> }[] = [];
  let next = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < companies.length) {
        const c = companies[next++];
        const fetcher = FETCHERS[c.ats as keyof typeof FETCHERS];
        const bucket = byAts.get(c.ats);
        const now = new Date();
        if (!fetcher || !bucket) {
          bookkeeping.push({
            id: c.id,
            data: { active: false, lastError: `unknown ats "${c.ats}"` },
          });
          continue;
        }
        try {
          const leads = await fetcher({ name: c.name, slug: c.slug }, matches, seenIds);
          bucket.leads.push(...leads);
          bookkeeping.push({
            id: c.id,
            data: {
              consecutiveFailures: 0,
              lastError: null,
              lastFetchedAt: now,
              ...(leads.length > 0
                ? { lastMatchAt: now, totalMatches: { increment: leads.length } }
                : {}),
            },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const failures = c.consecutiveFailures + 1;
          bucket.errors.push(msg);
          bookkeeping.push({
            id: c.id,
            data: {
              consecutiveFailures: failures,
              lastError: msg,
              lastFetchedAt: now,
              ...(failures >= MAX_CONSECUTIVE_FAILURES ? { active: false } : {}),
            },
          });
        }
      }
    })
  );

  // Persist per-board health/yield in chunked transactions — one update per
  // board per scan would be ~1k round-trips.
  for (let i = 0; i < bookkeeping.length; i += 100) {
    await prisma.$transaction(
      bookkeeping
        .slice(i, i + 100)
        .map((u) => prisma.atsCompany.update({ where: { id: u.id }, data: u.data }))
    );
  }

  return [...byAts.entries()].map(([source, { leads, errors }]) => ({
    source,
    leads,
    error: summarizeErrors(errors),
  }));
}
