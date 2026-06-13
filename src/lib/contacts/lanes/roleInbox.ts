import { hasMx, ROLE_LOCALS } from "../verify";
import type { LaneResult, RawCandidate } from "../types";

// Role-inbox lane: the guaranteed fallback. Almost every company reads
// careers@/jobs@/hr@. We only emit these when the domain actually has MX records
// (it can receive mail), and keep confidence modest — they're real addresses but
// impersonal, so they rank below any named person we found. Limited to the three
// highest-signal hiring inboxes to avoid flooding the list.
const EMIT: { local: string; confidence: number }[] = [
  { local: "careers", confidence: 0.4 },
  { local: "jobs", confidence: 0.38 },
  { local: "hr", confidence: 0.3 },
];

export async function fetchRoleInboxes(domain: string): Promise<LaneResult> {
  try {
    if (!(await hasMx(domain))) {
      return { source: "role_inbox", candidates: [], error: "no MX records for domain" };
    }
    const candidates: RawCandidate[] = EMIT.filter((e) => ROLE_LOCALS.includes(e.local)).map((e) => ({
      title: "Hiring inbox",
      email: `${e.local}@${domain}`,
      source: "role_inbox",
      confidence: e.confidence,
      verified: false, // MX proves the domain, not the specific mailbox
      verifyMethod: "mx",
    }));
    return { source: "role_inbox", candidates };
  } catch (e: unknown) {
    return { source: "role_inbox", candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
}
