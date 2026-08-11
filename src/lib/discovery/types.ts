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
  // The person named on the listing as hiring for it (Instahyre publishes one).
  // Their company is kept separately because it is frequently a staffing agency,
  // not the employer — the contact finder needs to tell the two apart.
  recruiterName?: string;
  recruiterTitle?: string;
  recruiterCompany?: string;
  companyUrl?: string; // employer's own site, when the source knows it
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
  instahyre: 2,
  hn: 3,
  weworkremotely: 3,
  remoteok: 3,
  remotive: 3,
};

export const SOURCE_LABEL: Record<string, string> = {
  sheet: "Freshers Sheet",
  jobfound: "JobFound",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  instahyre: "Instahyre",
  hn: "HN Who's Hiring",
  weworkremotely: "WeWorkRemotely",
  remoteok: "RemoteOK",
  remotive: "Remotive",
};

export function sourceTier(source: string): number {
  return SOURCE_TIER[source] ?? 9;
}

// A ScanRun with finishedAt = null is "running" only this long after it
// started; older open rows belong to a process that died mid-run. Scans take
// a few minutes — 30 min leaves generous headroom.
export const SCAN_STALE_MS = 30 * 60_000;
