import { htmlToText } from "../html";
import type { FetchResult, RawLead } from "./types";

// Jobfound's current site reads from this unauthenticated REST endpoint. The
// previous public Hygraph project is still reachable, but stopped receiving
// new postings in August 2026.
const JOBFOUND_API_URL = process.env.JOBFOUND_API_URL ?? "https://jobfound.org/api/jobs";

const MAX_AGE_DAYS = 14;
const PAGE_SIZE = 100;
// Safety valve for a malformed response that reports hasMore forever.
const MAX_PAGES = 50;

interface JobfoundJob {
  $id: string;
  title: string;
  companyName: string;
  description?: string | null;
  jobType?: string | null;
  salary?: string | null;
  experience?: string | null;
  domain?: string | null;
  location?: string | null;
  country?: string | null;
  skills?: string | null;
  applyUrl?: string | null;
  workplaceType?: string | null;
  postedAt: string;
}

interface JobsResponse {
  jobs?: JobfoundJob[];
  total?: number;
  page?: number;
  limit?: number;
  hasMore?: boolean;
}

function pageUrl(page: number): string {
  const url = new URL(JOBFOUND_API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("sort", "newest");
  url.searchParams.set("country", "India");
  url.searchParams.set("postedWithin", String(MAX_AGE_DAYS));
  return url.toString();
}

function jobLocation(job: JobfoundJob): string | undefined {
  const location = job.location?.trim();
  if (location) return location;
  if (job.workplaceType?.trim().toLowerCase() === "remote") return "Remote";
  return job.country?.trim() || undefined;
}

export async function fetchJobfoundLeads(): Promise<FetchResult> {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const leads: RawLead[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(pageUrl(page), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Jobfound returned HTTP ${res.status}`);

      const json = (await res.json()) as JobsResponse;
      if (!Array.isArray(json.jobs)) throw new Error("Jobfound returned an invalid jobs response");

      let reachedCutoff = false;
      for (const job of json.jobs) {
        const postedAt = new Date(job.postedAt);
        if (Number.isNaN(postedAt.getTime())) continue;
        if (postedAt.getTime() < cutoff) {
          reachedCutoff = true;
          break;
        }

        // The API applies this filter too, but keep the source boundary intact
        // if its filtering behavior changes again.
        if (job.country?.trim().toLowerCase() !== "india") continue;

        const externalId = job.$id?.trim();
        const company = job.companyName?.trim();
        const role = job.title?.trim();
        if (!externalId || !company || !role) continue;

        const jdText = job.description ? htmlToText(job.description) : undefined;
        leads.push({
          source: "jobfound",
          externalId,
          company,
          role,
          location: jobLocation(job),
          url: job.applyUrl?.trim() || undefined,
          jdText: jdText && jdText.length >= 50 ? jdText : undefined,
          salary: job.salary?.trim() || undefined,
          jobType: job.jobType?.trim() || undefined,
          experience: job.experience?.trim() || undefined,
          skills: job.skills?.trim() || undefined,
          postedAt,
        });
      }

      if (reachedCutoff || json.jobs.length === 0 || json.hasMore !== true) break;
    }

    return { source: "jobfound", leads };
  } catch (e: unknown) {
    return { source: "jobfound", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
