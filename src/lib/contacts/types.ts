// Contact enrichment ("Find contacts" for cold email): given a company + domain,
// fan out across lanes, dedupe, rank, and cache the result globally per domain —
// the email-equivalent of the discovery pipeline. Each lane returns RawCandidate[]
// and never throws (it catches and reports a per-lane error instead) so one slow
// or failing source never sinks the whole run.

export type ContactSource =
  | "lead" // contactEmail already on the JobLead (HN posts often carry one)
  | "apollo" // Apollo people-DB: who works there by title (+ verified email)
  | "site" // company website scrape (/about, /team, /contact, footer)
  | "github" // GitHub org members' public profile emails
  | "hn" // surfaced via the HN lane's contact email
  | "portfolio" // personal site / GitHub found via web search, email extracted
  | "role_inbox" // derived careers@/hr@/jobs@ on a domain with valid MX
  | "pattern"; // name + inferred/standard pattern → guessed address (MX-checked)

export interface RawCandidate {
  name?: string;
  title?: string;
  email?: string; // may be absent — a person located but address not yet resolved
  linkedinUrl?: string;
  source: ContactSource;
  confidence: number; // 0..1, lane's own confidence in the EMAIL (0 when no email)
  verified?: boolean; // address confirmed real (published / provider-verified)
  verifyMethod?: "published" | "apollo" | "mx" | "pattern";
}

export interface LaneResult {
  source: ContactSource;
  candidates: RawCandidate[];
  error?: string;
}

// A merged, ranked candidate as persisted to DiscoveredContact and returned to the UI.
export interface RankedContact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: ContactSource;
  sources: string | null; // comma-joined when several lanes agreed
  confidence: number;
  verified: boolean;
  verifyMethod: string | null;
  seniorityRank: number;
  rank: number; // composite sort score
}

// Titles we ask Apollo for and recognise when ranking. Order ~ desirability as a
// cold-email target for an early-career SWE: a founder/eng-lead reply is gold; a
// recruiter is a solid, legitimate target too.
export const TARGET_TITLES = [
  "founder",
  "co-founder",
  "ceo",
  "cto",
  "chief technology officer",
  "vp engineering",
  "head of engineering",
  "director of engineering",
  "engineering manager",
  "head of talent",
  "head of people",
  "technical recruiter",
  "recruiter",
  "talent acquisition",
];
