import { htmlToText } from "../html";
import type { SearchPrefs } from "../searchPrefs";
import { anyUserMatcher } from "./ats";
import type { FetchResult, RawLead } from "./types";

// instahyre.com — India-focused curated board, reached through the two public,
// keyless endpoints its own web app uses:
//   1. /job_search — paginated listing (company, title, locations, keywords).
//   2. /employer_misc/employer_profile/anon_employer/{employerId}?jobId={jobId}
//      — the full JD for ONE posting plus the employer's profile. This is where
//      the recruiter named on the listing lives (name / designation / agency),
//      which the contact finder reuses as a real, already-known person for the
//      role (src/lib/contacts/pipeline.ts).
//
// ~15k live postings, so this is a firehose: the global prefilter applies (see
// ats.ts) and only postings that survive it earn a detail request.
//
// Two quirks worth knowing:
//   • job_search carries NO date field and is ordered by a ranking that rotates
//     between requests, not newest-first. So a sweep is a *sample*, and
//     successive ticks see different slices — catalog dedupe absorbs the overlap.
//   • jobLocations is validated against Instahyre's own vocabulary and the API
//     400s on anything else, hence the fixed map below.

const SEARCH_API = "https://www.instahyre.com/api/v1/job_search";
const DETAIL_API = "https://www.instahyre.com/api/v1/employer_misc/employer_profile/anon_employer";
// Single posting by job id alone — the sweep doesn't need it (it already holds
// the employer id), but a bare posting URL does. Same job payload as the
// employer_profile detail, minus the employer's profile.
const JOB_API = "https://www.instahyre.com/api/v1/employer_public_jobs";

const PAGE_SIZE = 35; // server-enforced — a larger `limit` is silently ignored
const MAX_PAGES = 12;
const PAGE_DELAY_MS = 300; // bursts get throttled; pace the sweep
const MAX_DETAIL_FETCHES = 40; // one request per posting — cap them per tick
const DETAIL_CONCURRENCY = 4;
const TIMEOUT_MS = 20_000;

const ANYWHERE = "Anywhere in India";

// Every value here was verified against the live API; sending an unlisted one
// fails the whole query with {"job_locations": ["Invalid location"]}.
const LOCATION_VALUES: Record<string, string> = {
  ahmedabad: "Ahmedabad",
  bangalore: "Bangalore",
  bengaluru: "Bangalore",
  bhubaneswar: "Bhubaneswar",
  chandigarh: "Chandigarh",
  chennai: "Chennai",
  cochin: "Kochi",
  coimbatore: "Coimbatore",
  delhi: "Delhi",
  "new delhi": "Delhi",
  gurgaon: "Gurgaon",
  gurugram: "Gurgaon",
  hyderabad: "Hyderabad",
  indore: "Indore",
  jaipur: "Jaipur",
  kochi: "Kochi",
  kolkata: "Kolkata",
  mumbai: "Mumbai",
  noida: "Noida",
  pune: "Pune",
  anywhere: ANYWHERE,
  india: ANYWHERE,
  remote: "Work From Home",
  wfh: "Work From Home",
  "work from home": "Work From Home",
};

interface SearchJob {
  id?: number;
  title?: string;
  locations?: string; // comma-joined: "Bangalore,Gurgaon"
  keywords?: string[];
  public_url?: string;
  employer?: { id?: number; company_name?: string };
}

interface DetailJob {
  id?: number;
  title?: string;
  hiring_company_name?: string;
  opportunity_url?: string; // site-relative
  locations?: string[];
  description?: string; // HTML
  is_active?: boolean;
  is_internship?: boolean;
  keywords?: string[];
  workex_min?: number | null;
  workex_max?: number | null;
  recruiter_name?: string | null;
  recruiter_designation?: string | null;
  recruiter_company_name?: string | null;
}

interface EmployerProfile {
  jobs?: DetailJob[];
  social_accounts?: { website?: string | null } | null;
}

function get(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One user's location keyword → Instahyre's value for it. Exact match first,
// then a whole-word scan so free text like "navi mumbai" or "bangalore, india"
// still resolves. Within a single keyword a city beats the country-wide value:
// "bangalore, india" means Bangalore.
function matchLocation(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const exact = LOCATION_VALUES[key];
  if (exact) return exact;
  let countryWide: string | null = null;
  for (const [name, value] of Object.entries(LOCATION_VALUES)) {
    if (!new RegExp(`(^|[^a-z])${name}([^a-z]|$)`).test(key)) continue;
    if (value === ANYWHERE) countryWide = ANYWHERE;
    else return value;
  }
  return countryWide;
}

// The cities to sweep, from the union of participants' location prefs.
// A keyword we can't place is dropped rather than allowed to widen the query:
// the sweep only samples a few hundred of ~15k postings, so spending that
// budget country-wide on behalf of one unrecognized keyword starves everyone
// else's actual cities. Nothing is lost by dropping it — this board is
// India-only, and each user's own locationMatches filter runs again at fan-out.
// Only when NOTHING maps do we fall back to the whole country.
export function instahyreLocations(prefsList: SearchPrefs[]): string[] {
  const out = new Set<string>();
  for (const prefs of prefsList) {
    for (const raw of prefs.locationKeywords) {
      const mapped = matchLocation(raw);
      if (mapped) out.add(mapped);
    }
  }
  if (out.size === 0 || out.has(ANYWHERE)) return [ANYWHERE];
  return [...out];
}

// Repeat jobLocations to OR several cities into one query.
function searchUrl(locations: string[], offset: number): string {
  const params = new URLSearchParams({
    company_size: "0",
    job_type: "0",
    source: "opportunities",
    status: "0",
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  for (const location of locations) params.append("jobLocations", location);
  return `${SEARCH_API}?${params.toString()}`;
}

function experienceLabel(min?: number | null, max?: number | null): string | undefined {
  if (min == null && max == null) return undefined;
  if (min != null && max != null) return min === max ? `${min} yrs` : `${min}-${max} yrs`;
  return min != null ? `${min}+ yrs` : `up to ${max} yrs`;
}

// Enriches `lead` in place. Returns false when the detail says the posting is
// no longer open, so the caller can drop it.
async function fetchDetail(employerId: number, jobId: number, lead: RawLead): Promise<boolean> {
  const res = await get(`${DETAIL_API}/${employerId}?jobId=${jobId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const profile = (await res.json()) as EmployerProfile;
  const job = profile.jobs?.find((j) => j.id === jobId);
  if (!job) return true; // detail unavailable — the listing itself still stands
  if (job.is_active === false) return false;

  const jd = job.description ? htmlToText(job.description) : undefined;
  if (jd && jd.length >= 50) lead.jdText = jd;
  lead.jobType = job.is_internship ? "Internship" : "Full Time";
  lead.experience = experienceLabel(job.workex_min, job.workex_max) ?? lead.experience;
  if (!lead.skills && job.keywords?.length) lead.skills = job.keywords.slice(0, 12).join(", ");

  // The person actually hiring for this posting. Often an external agency
  // recruiter, so their company is kept alongside the name — the contact finder
  // uses it to decide whether guessing an address at the employer's domain
  // would be a fabrication.
  lead.recruiterName = job.recruiter_name?.trim() || undefined;
  lead.recruiterTitle = job.recruiter_designation?.trim() || undefined;
  lead.recruiterCompany = job.recruiter_company_name?.trim() || undefined;

  // The employer's own site. The listing URL is instahyre.com, which is useless
  // for working out the company's email domain; this is not.
  lead.companyUrl = profile.social_accounts?.website?.trim() || undefined;
  return true;
}

export interface InstahyrePosting {
  company: string;
  role: string;
  location?: string;
  jdText: string;
  applyUrl?: string;
  experience?: string;
  skills?: string;
  jobType?: string;
  recruiterName?: string;
  recruiterTitle?: string;
  recruiterCompany?: string;
}

// Posting URLs look like /job-437684-senior-software-engineer-at-amazon-bangalore/.
// Returns null for any other URL so callers can fall through to their normal path.
export function instahyreJobIdFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (!/(^|\.)instahyre\.com$/i.test(parsed.hostname)) return null;
    const m = parsed.pathname.match(/\/job-(\d+)(?:-|\/|$)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// One posting, by id, straight from the board's API. Instahyre's HTML pages are
// behind a Cloudflare bot challenge (a server-side fetch gets 403), so this is
// the ONLY way the backend can read a posting it wasn't handed by the sweep.
//
// null means the posting is genuinely gone (404 / no longer active). Anything
// else — a rate limit, a 5xx, a timeout — throws, because telling someone their
// posting was withdrawn when the board was briefly unreachable is a lie that
// makes them give up on a live job.
export async function fetchInstahyrePosting(jobId: number): Promise<InstahyrePosting | null> {
  let res: Response;
  try {
    res = await get(`${JOB_API}/${jobId}`);
  } catch (e: unknown) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new Error(`Instahyre's API ${reason}. Try again in a moment.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Instahyre's API returned HTTP ${res.status}. Try again in a moment.`);
  const job = (await res.json()) as DetailJob;
  if (!job?.id || job.is_active === false) return null;

  const company = job.hiring_company_name?.trim();
  const role = job.title?.trim();
  if (!company || !role) return null;

  return {
    company,
    role,
    location: job.locations?.length ? job.locations.join(", ") : undefined,
    jdText: job.description ? htmlToText(job.description) : "",
    applyUrl: job.opportunity_url ? new URL(job.opportunity_url, "https://www.instahyre.com").toString() : undefined,
    experience: experienceLabel(job.workex_min, job.workex_max),
    skills: job.keywords?.length ? job.keywords.slice(0, 12).join(", ") : undefined,
    jobType: job.is_internship ? "Internship" : "Full Time",
    recruiterName: job.recruiter_name?.trim() || undefined,
    recruiterTitle: job.recruiter_designation?.trim() || undefined,
    recruiterCompany: job.recruiter_company_name?.trim() || undefined,
  };
}

export async function fetchInstahyreLeads(
  prefsList: SearchPrefs[],
  seenIds: ReadonlySet<string> = new Set()
): Promise<FetchResult> {
  try {
    if (prefsList.length === 0) return { source: "instahyre", leads: [] };
    const matches = anyUserMatcher(prefsList);
    const locations = instahyreLocations(prefsList);

    const leads: RawLead[] = [];
    const pending: { lead: RawLead; employerId: number; jobId: number }[] = [];
    const seenJobIds = new Set<number>();
    let pageError: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE;
      let jobs: SearchJob[];
      let total: number;
      try {
        const res = await get(searchUrl(locations, offset));
        if (!res.ok) throw new Error(`Instahyre search returned HTTP ${res.status}`);
        const json = (await res.json()) as { objects?: SearchJob[]; meta?: { total_count?: number } };
        jobs = json.objects ?? [];
        total = json.meta?.total_count ?? 0;
      } catch (e: unknown) {
        // The pages already collected are a valid (smaller) sample — keep them
        // and report the failure as a partial-source note.
        pageError = e instanceof Error ? e.message : String(e);
        break;
      }

      for (const job of jobs) {
        const company = job.employer?.company_name?.trim();
        const employerId = job.employer?.id;
        if (!job.id || !job.title || !company || !employerId) continue;
        if (seenJobIds.has(job.id)) continue; // the rotating order can repeat a row across pages
        seenJobIds.add(job.id);

        const cities = (job.locations ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const isRemote = cities.some((c) => /work from home/i.test(c));
        const location = cities.join(", ") || undefined;
        if (!matches(job.title, location, isRemote)) continue;

        const lead: RawLead = {
          source: "instahyre",
          externalId: String(job.id),
          company,
          role: job.title.trim(),
          location,
          url: job.public_url,
          skills: job.keywords?.length ? job.keywords.slice(0, 12).join(", ") : undefined,
        };
        leads.push(lead);
        // Skip the detail request for postings the catalog already holds with a
        // JD — same rule as the Greenhouse/HN JD fetches.
        if (!seenIds.has(`instahyre::${job.id}`) && pending.length < MAX_DETAIL_FETCHES) {
          pending.push({ lead, employerId, jobId: job.id });
        }
      }

      if (jobs.length < PAGE_SIZE || offset + jobs.length >= total) break;
      await sleep(PAGE_DELAY_MS);
    }

    // Enrich the matched postings (JD + recruiter + employer site). Best-effort:
    // a failed detail request leaves a usable, JD-less lead behind.
    const detailErrors: string[] = [];
    const closed = new Set<RawLead>();
    let next = 0;
    await Promise.all(
      Array.from({ length: DETAIL_CONCURRENCY }, async () => {
        while (next < pending.length) {
          const item = pending[next++];
          try {
            if (!(await fetchDetail(item.employerId, item.jobId, item.lead))) closed.add(item.lead);
          } catch (e: unknown) {
            detailErrors.push(e instanceof Error ? e.message : String(e));
          }
        }
      })
    );

    const live = leads.filter((l) => !closed.has(l));
    const notes = [pageError, detailErrors.length ? `${detailErrors.length} detail fetches failed` : undefined]
      .filter(Boolean)
      .join("; ");
    return { source: "instahyre", leads: live, error: notes || undefined };
  } catch (e: unknown) {
    return { source: "instahyre", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
