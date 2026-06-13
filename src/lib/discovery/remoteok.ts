import { htmlToText } from "../extractJob";
import type { SearchPrefs } from "../searchPrefs";
import { anyUserMatcher } from "./ats";
import { remoteScope } from "./remoteParse";
import type { FetchResult, RawLead } from "./types";

// remoteok.com — public JSON API (no key; their ToS asks for attribution, which
// the lead's source label provides). The first array element is a legal/metadata
// object, not a job. Firehose, so the global prefilter applies (see ats.ts).
const API = "https://remoteok.com/api?tags=dev";
const MAX_AGE_DAYS = 21;
const TIMEOUT_MS = 20_000;

interface RemoteOkJob {
  id?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  description?: string; // HTML
  location?: string;
  tags?: string[];
  url?: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
}

export async function fetchRemoteOkLeads(prefsList: SearchPrefs[]): Promise<FetchResult> {
  try {
    if (prefsList.length === 0) return { source: "remoteok", leads: [] };
    const matches = anyUserMatcher(prefsList);

    const res = await fetch(API, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RemoteOK returned HTTP ${res.status}`);
    const json = (await res.json()) as RemoteOkJob[];

    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const leads: RawLead[] = [];
    for (const j of json) {
      // The metadata head element has no id/company/position — this skips it too.
      if (!j.id || !j.company || !j.position) continue;
      const postedAt = j.epoch ? new Date(j.epoch * 1000) : j.date ? new Date(j.date) : undefined;
      if (postedAt && postedAt.getTime() < cutoff) continue;

      const { location, isRemote } = remoteScope(j.location ? [j.location] : []);
      if (!matches(j.position, location, isRemote)) continue;

      const jd = j.description ? htmlToText(j.description) : undefined;
      const min = Number(j.salary_min);
      const max = Number(j.salary_max);
      leads.push({
        source: "remoteok",
        externalId: String(j.id),
        company: j.company,
        role: j.position.trim(),
        location,
        url: j.url || j.apply_url,
        jdText: jd && jd.length >= 50 ? jd : undefined,
        skills: Array.isArray(j.tags) ? j.tags.slice(0, 12).join(", ") : undefined,
        salary: min && max ? `$${min}–$${max}` : undefined,
        postedAt,
      });
    }
    return { source: "remoteok", leads };
  } catch (e: unknown) {
    return { source: "remoteok", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
