// Contact enrichment ("Find contacts" for cold email): given a company + domain,
// fan out across lanes, dedupe, rank, and cache the result globally per domain —
// the email-equivalent of the discovery pipeline. Each lane returns RawCandidate[]
// and never throws (it catches and reports a per-lane error instead) so one slow
// or failing source never sinks the whole run.

export type ContactSource =
  | "lead" // contactEmail already on the JobLead (HN posts often carry one)
  | "listing" // the recruiter the job listing itself names (Instahyre publishes one)
  | "apollo" // Apollo people-DB: who works there by title (+ verified email)
  | "signalhire"
  | "manual"
  | "site" // company website scrape (/about, /team, /contact, footer)
  | "github" // GitHub org members' public profile emails
  | "hn" // surfaced via the HN lane's contact email
  | "portfolio" // personal site / GitHub found via web search, email extracted
  | "role_inbox" // derived careers@/hr@/jobs@ on a domain with valid MX
  | "pattern"; // name + inferred/standard pattern → guessed address (MX-checked)

export interface RawCandidate {
  name?: string;
  phone?: string;
  title?: string;
  email?: string; // may be absent — a person located but address not yet resolved
  linkedinUrl?: string;
  location?: string;
  providerPersonId?: string;
  contactStatus?: "not_requested" | "resolving" | "resolved" | "failed";
  source: ContactSource;
  confidence: number; // 0..1, lane's own confidence in the EMAIL (0 when no email)
  verified?: boolean; // address confirmed real (published / provider-verified)
  verifyMethod?: "published" | "apollo" | "mx" | "pattern" | "llm";
  // Set when this person does NOT work at the company we resolved a domain for
  // (an external agency recruiter). They're a real, useful contact, but guessing
  // an address at that domain — or web-searching them against it — would invent
  // a person who doesn't exist there, so both steps skip them.
  skipResolve?: boolean;
}

export interface LaneResult {
  source: ContactSource;
  candidates: RawCandidate[];
  error?: string;
  status?: "ok" | "not_configured" | "plan_required" | "quota_exhausted" | "auth_error" | "rate_limited" | "error";
  creditsRemaining?: string;
}

// A merged, ranked candidate as persisted to DiscoveredContact and returned to the UI.
export interface RankedContact {
  id?: string;
  name: string | null;
  phone: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  location: string | null;
  providerPersonId: string | null;
  contactStatus: string;
  source: ContactSource;
  sources: string | null; // comma-joined when several lanes agreed
  confidence: number;
  verified: boolean;
  verifyMethod: string | null;
  seniorityRank: number;
  skipResolve: boolean; // see RawCandidate.skipResolve
  rank: number; // composite sort score
}

// Titles we ask Apollo for and recognise when ranking. Order ~ desirability as a
// cold-email target for an early-career SWE: a founder/eng-lead reply is gold; a
// recruiter is a solid, legitimate target too.
export const TARGET_TITLES = [
  "technical recruiter",
  "engineering recruiter",
  "technical talent acquisition",
  "talent acquisition partner",
  "talent acquisition",
  "recruiter",
  "head of talent",
  "head of people",
  "recruiting manager",
  "people partner",
  "hr manager",
];
