import { htmlToText } from "../html";
import type { SearchPrefs } from "../searchPrefs";
import { anyUserMatcher } from "./ats";
import { remoteScope } from "./remoteParse";
import type { FetchResult, RawLead } from "./types";

// weworkremotely.com — public RSS feed, no key. Unlike a general remote-jobs
// aggregator, the feed is scoped to the programming category (its parent feed
// aggregates every programming sub-category), so almost everything is a software
// role — a much better signal-to-noise ratio than an all-categories firehose.
// Still a firehose w.r.t. seniority/location, so the global prefilter applies
// (see ats.ts): keep a posting only if it matches ANY participating user's prefs.
const FEED = "https://weworkremotely.com/categories/remote-programming-jobs.rss";
const MAX_AGE_DAYS = 30;
const TIMEOUT_MS = 20_000;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(itemBody: string, name: string): string {
  const m = itemBody.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : "";
}

export async function fetchWeWorkRemotelyLeads(prefsList: SearchPrefs[]): Promise<FetchResult> {
  try {
    if (prefsList.length === 0) return { source: "weworkremotely", leads: [] };
    const matches = anyUserMatcher(prefsList);

    const res = await fetch(FEED, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`WeWorkRemotely returned HTTP ${res.status}`);
    const xml = await res.text();

    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const leads: RawLead[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const body = m[1];
      const title = tag(body, "title");
      const link = tag(body, "guid") || tag(body, "link");
      if (!title || !link) continue;

      // Titles read "Company: Role — region (Remote)". Split off the company; the
      // role keeps any trailing noise, which the keyword filter ignores.
      const idx = title.indexOf(":");
      const company = idx > 0 ? title.slice(0, idx).trim() : "";
      const role = (idx > 0 ? title.slice(idx + 1) : title).trim();
      if (!company || !role) continue;

      const region = tag(body, "region"); // "Anywhere in the World" | "USA Only" | ...
      const { location, isRemote } = remoteScope(region ? [region] : []);
      if (!matches(role, location, isRemote)) continue;

      const pub = tag(body, "pubDate");
      const postedAt = pub ? new Date(pub) : undefined;
      if (postedAt && !isNaN(postedAt.getTime()) && postedAt.getTime() < cutoff) continue;

      const jd = htmlToText(tag(body, "description"));
      leads.push({
        source: "weworkremotely",
        externalId: link,
        company,
        role,
        location,
        url: link,
        jdText: jd && jd.length >= 50 ? jd : undefined,
        skills: tag(body, "category") || undefined,
        postedAt: postedAt && !isNaN(postedAt.getTime()) ? postedAt : undefined,
      });
    }
    return { source: "weworkremotely", leads };
  } catch (e: unknown) {
    return { source: "weworkremotely", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
