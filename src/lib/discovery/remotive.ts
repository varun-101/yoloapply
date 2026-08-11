import { htmlToText } from "../html";
import type { SearchPrefs } from "../searchPrefs";
import { anyUserMatcher } from "./ats";
import { remoteScope, normalizeEmployment } from "./remoteParse";
import type { FetchResult, RawLead } from "./types";

// remotive.com — public JSON API (no key; ToS asks for attribution, provided by
// the source label). We pull the software-dev category. Firehose, so the global
// prefilter applies (see ats.ts).
const API = "https://remotive.com/api/remote-jobs?category=software-dev&limit=200";
const MAX_AGE_DAYS = 21;
const TIMEOUT_MS = 20_000;

interface RemotiveJob {
  id?: number;
  url?: string;
  title?: string;
  company_name?: string;
  tags?: string[];
  job_type?: string;
  publication_date?: string; // ISO
  candidate_required_location?: string; // "Worldwide" | "USA" | "India, USA" | ...
  salary?: string;
  description?: string; // HTML
}

export async function fetchRemotiveLeads(prefsList: SearchPrefs[]): Promise<FetchResult> {
  try {
    if (prefsList.length === 0) return { source: "remotive", leads: [] };
    const matches = anyUserMatcher(prefsList);

    const res = await fetch(API, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Remotive returned HTTP ${res.status}`);
    const json = (await res.json()) as { jobs?: RemotiveJob[] };

    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const leads: RawLead[] = [];
    for (const j of json.jobs ?? []) {
      if (!j.id || !j.title || !j.company_name) continue;
      const postedAt = j.publication_date ? new Date(j.publication_date) : undefined;
      if (postedAt && postedAt.getTime() < cutoff) continue;

      // Remotive lists the required region as one comma-joined string.
      const restrictions = j.candidate_required_location
        ? j.candidate_required_location.split(",").map((s) => s.trim())
        : [];
      const { location, isRemote } = remoteScope(restrictions);
      if (!matches(j.title, location, isRemote)) continue;

      const jd = j.description ? htmlToText(j.description) : undefined;
      leads.push({
        source: "remotive",
        externalId: String(j.id),
        company: j.company_name,
        role: j.title.trim(),
        location,
        url: j.url,
        jdText: jd && jd.length >= 50 ? jd : undefined,
        jobType: normalizeEmployment(j.job_type),
        skills: Array.isArray(j.tags) ? j.tags.slice(0, 12).join(", ") : undefined,
        salary: j.salary?.trim() || undefined,
        postedAt,
      });
    }
    return { source: "remotive", leads };
  } catch (e: unknown) {
    return { source: "remotive", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
