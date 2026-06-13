import { fetchJson } from "../http";
import { isPlausibleEmail } from "../verify";
import { TARGET_TITLES, type LaneResult, type RawCandidate } from "../types";

// Apollo people-DB lane (the "who works there" lane): query people at the
// company's domain filtered to the target titles. Apollo returns names + titles
// always, and a real email when the record is unlocked/known; locked records
// come back as "email_not_unlocked@domain.com", which we drop to email-less (the
// resolve step will pattern-guess those). Runs only when the user supplied a key.

const ENDPOINT = "https://api.apollo.io/api/v1/mixed_people/search";
const LOCKED_RE = /email_not_unlocked|not_unlocked|locked/i;

interface ApolloPerson {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string | null;
  email_status?: string | null; // "verified" | "guessed" | "unavailable" | null
  linkedin_url?: string | null;
}
interface ApolloResponse {
  people?: ApolloPerson[];
}

export async function fetchApolloContacts(
  domain: string | null,
  company: string,
  apiKey: string
): Promise<LaneResult> {
  try {
    const body: Record<string, unknown> = {
      person_titles: TARGET_TITLES,
      page: 1,
      per_page: 25,
    };
    if (domain) body.q_organization_domains_list = [domain];
    else body.q_organization_name = company;

    const res = await fetchJson<ApolloResponse>(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apiKey },
      body: JSON.stringify(body),
    });
    if (!res) return { source: "apollo", candidates: [], error: "Apollo request failed (key/credits?)" };

    const candidates: RawCandidate[] = [];
    for (const p of res.people ?? []) {
      const name = (p.name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`).trim() || undefined;
      const title = p.title ?? undefined;
      const linkedinUrl = p.linkedin_url ?? undefined;
      const email = p.email ?? "";
      const usable = email && !LOCKED_RE.test(email) && isPlausibleEmail(email);
      if (usable) {
        const verified = p.email_status === "verified";
        candidates.push({
          name,
          title,
          email: email.toLowerCase(),
          linkedinUrl,
          source: "apollo",
          confidence: verified ? 0.92 : 0.65,
          verified,
          verifyMethod: verified ? "apollo" : undefined,
        });
      } else if (name) {
        // Located the person; address locked → resolve step fills it in.
        candidates.push({ name, title, linkedinUrl, source: "apollo", confidence: 0 });
      }
    }
    return { source: "apollo", candidates };
  } catch (e: unknown) {
    return { source: "apollo", candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
}
