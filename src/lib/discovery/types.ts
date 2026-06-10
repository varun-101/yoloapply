// Normalized posting shape every source fetcher returns. The pipeline turns
// these into JobLead rows (dedupe, canonical URLs, upsert).
export interface RawLead {
  source: string; // "sheet" | "jobfound"
  externalId: string; // stable per-source id (hygraph id; hash for sheet rows)
  company: string;
  role: string;
  location?: string;
  url?: string;
  jdText?: string;
  salary?: string;
  jobType?: string; // "Full Time" | "Internship"
  experience?: string;
  skills?: string;
  contactEmail?: string;
  postedAt?: Date;
}

export interface FetchResult {
  source: string;
  leads: RawLead[];
  error?: string;
}

// Tier 1 = most-trusted sources, always shown first in the queue.
export const SOURCE_TIER: Record<string, number> = {
  sheet: 1,
  jobfound: 1,
  greenhouse: 2,
  lever: 2,
  ashby: 2,
  hn: 3,
};

export const SOURCE_LABEL: Record<string, string> = {
  sheet: "Freshers Sheet",
  jobfound: "JobFound",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  hn: "HN Who's Hiring",
};

export function sourceTier(source: string): number {
  return SOURCE_TIER[source] ?? 9;
}
