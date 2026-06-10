import { htmlToText } from "../extractJob";
import { LOCATION_KEYWORDS, locationMatches, titleMatches, WATCHLIST, WatchlistEntry } from "./config";
import type { FetchResult, RawLead } from "./types";

// Official, unauthenticated job-board APIs for companies on the watchlist.
// Unlike the curated tier-1 sources these boards list every open role, so the
// keyword + location filters from config.ts apply here.

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

async function fetchGreenhouse(entry: WatchlistEntry): Promise<RawLead[]> {
  const res = await fetch(
    `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs?content=true`
  );
  if (!res.ok) throw new Error(`${entry.slug}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    jobs: {
      id: number;
      title: string;
      absolute_url: string;
      location?: { name?: string };
      content?: string;
      first_published?: string;
      updated_at?: string;
    }[];
  };
  return json.jobs.map((j) => ({
    source: "greenhouse",
    externalId: String(j.id),
    company: entry.name,
    role: j.title.trim(),
    location: j.location?.name,
    url: j.absolute_url,
    jdText: j.content ? htmlToText(unescapeHtml(j.content)) : undefined,
    postedAt: j.first_published ? new Date(j.first_published) : j.updated_at ? new Date(j.updated_at) : undefined,
  }));
}

async function fetchLever(entry: WatchlistEntry): Promise<RawLead[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${entry.slug}?mode=json`);
  if (!res.ok) throw new Error(`${entry.slug}: HTTP ${res.status}`);
  const json = (await res.json()) as {
    id: string;
    text: string;
    hostedUrl: string;
    createdAt?: number;
    descriptionPlain?: string;
    categories?: { location?: string; commitment?: string };
  }[];
  return json.map((j) => ({
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

async function fetchAshby(entry: WatchlistEntry): Promise<RawLead[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`);
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
    .filter((j) => j.isListed !== false)
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
      // Ashby marks remote explicitly; surface it in the location string so the
      // shared location filter (and the UI) can see it.
      ...(j.isRemote && !LOCATION_KEYWORDS.some((k) => (j.location ?? "").toLowerCase().includes(k))
        ? { location: [j.location, "Remote"].filter(Boolean).join(" · ") }
        : {}),
    }));
}

const FETCHERS = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
} as const;

export async function fetchAtsLeads(): Promise<FetchResult[]> {
  const byAts = new Map<string, { leads: RawLead[]; errors: string[] }>();
  for (const ats of Object.keys(FETCHERS)) byAts.set(ats, { leads: [], errors: [] });

  await Promise.all(
    WATCHLIST.map(async (entry) => {
      const bucket = byAts.get(entry.ats)!;
      try {
        const all = await FETCHERS[entry.ats](entry);
        bucket.leads.push(
          ...all.filter((l) => titleMatches(l.role) && locationMatches(l.location))
        );
      } catch (e: unknown) {
        bucket.errors.push(e instanceof Error ? e.message : String(e));
      }
    })
  );

  return [...byAts.entries()].map(([source, { leads, errors }]) => ({
    source,
    leads,
    error: errors.length ? errors.join("; ") : undefined,
  }));
}
