import { htmlToText } from "../html";
import type { FetchResult, RawLead } from "./types";

// jobfound.org is a thin Next.js front-end over a public Hygraph (GraphCMS)
// project — the content API needs no auth. We query it directly instead of
// scraping the site.
const HYGRAPH_URL =
  process.env.JOBFOUND_HYGRAPH_URL ??
  "https://ap-south-1.cdn.hygraph.com/content/clyfggcvi02yv07uxmtl5gva8/master";

// Posts arrive in daily batches; don't bother ingesting anything older than this.
const MAX_AGE_DAYS = 14;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

const QUERY = `
  query JobPosts($first: Int, $skip: Int) {
    jobPosts(orderBy: createdAt_DESC, first: $first, skip: $skip) {
      id
      title
      slug
      body { html }
      salary
      createdAt
      skill { skills }
      experience { experience }
      domain { domain }
      jobTypeReference { jobType }
      apply
      country { country }
    }
  }
`;

interface JobPost {
  id: string;
  title: string;
  slug: string;
  body?: { html?: string } | null;
  salary?: string | null;
  createdAt: string;
  skill?: { skills?: string } | { skills?: string }[] | null;
  experience?: { experience?: string } | null;
  domain?: { domain?: string } | null;
  jobTypeReference?: { jobType?: string } | null;
  apply?: string | null;
  country?: { country?: string } | null;
}

// Titles follow "Company is hiring for Role | Location". Fall back gracefully
// when a post doesn't match the pattern.
function parseTitle(title: string): { company: string; role: string; location?: string } {
  const [head, ...locParts] = title.split("|");
  const location = locParts.join("|").trim() || undefined;
  const m = head.match(/^(.*?)\s+is hiring for\s+(.*)$/i);
  if (m) return { company: m[1].trim(), role: m[2].trim(), location };
  return { company: head.trim(), role: head.trim(), location };
}

export async function fetchJobfoundLeads(): Promise<FetchResult> {
  try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400 * 1000;
    const leads: RawLead[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(HYGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: QUERY,
          variables: { first: PAGE_SIZE, skip: page * PAGE_SIZE },
          operationName: "JobPosts",
        }),
      });
      if (!res.ok) throw new Error(`Hygraph returned HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: { jobPosts?: JobPost[] };
        errors?: { message: string }[];
      };
      if (json.errors?.length) throw new Error(json.errors[0].message);
      const posts = json.data?.jobPosts ?? [];

      let reachedCutoff = false;
      for (const post of posts) {
        const postedAt = new Date(post.createdAt);
        if (postedAt.getTime() < cutoff) {
          reachedCutoff = true;
          break;
        }
        // The feed also carries non-India listings (mostly US data-entry spam).
        if ((post.country?.country ?? "").trim() !== "India") continue;

        const { company, role, location } = parseTitle(post.title ?? "");
        if (!company || !role) continue;

        const skills = Array.isArray(post.skill)
          ? post.skill.map((s) => s?.skills).filter(Boolean).join(", ")
          : post.skill?.skills;
        const jdText = post.body?.html ? htmlToText(post.body.html) : undefined;

        leads.push({
          source: "jobfound",
          externalId: post.id,
          company,
          role,
          location,
          url: post.apply ?? undefined,
          jdText: jdText && jdText.length >= 50 ? jdText : undefined,
          salary: post.salary?.trim() || undefined,
          jobType: post.jobTypeReference?.jobType ?? undefined,
          experience: post.experience?.experience ?? undefined,
          skills: skills || undefined,
          postedAt,
        });
      }

      if (reachedCutoff || posts.length < PAGE_SIZE) break;
    }

    return { source: "jobfound", leads };
  } catch (e: unknown) {
    return { source: "jobfound", leads: [], error: e instanceof Error ? e.message : String(e) };
  }
}
