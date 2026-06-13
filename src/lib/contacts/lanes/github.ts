import { fetchJson } from "../http";
import { isPlausibleEmail } from "../verify";
import type { LaneResult, RawCandidate } from "../types";

// GitHub lane: for dev-tool startups, founders/engineers frequently expose a
// public email on their GitHub profile even when they don't on LinkedIn. We find
// the company's org, list its PUBLIC members, and read each member's profile
// email + name. Unauthenticated GitHub is rate-limited to 60 req/hr, so an
// optional GITHUB_TOKEN env raises the ceiling; without it we cap tightly and
// degrade quietly on a 403.

const API = "https://api.github.com";
const MAX_MEMBERS = 12;

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface GhSearch {
  items?: { login: string; type: string }[];
}
interface GhUser {
  login: string;
  name?: string | null;
  email?: string | null;
  bio?: string | null;
  blog?: string | null;
  html_url?: string;
}

// Pick the org whose login best matches the company/domain slug.
async function findOrg(company: string, domain: string): Promise<string | null> {
  const slug = domain.split(".")[0];
  const q = encodeURIComponent(`${company} type:org`);
  const res = await fetchJson<GhSearch>(`${API}/search/users?q=${q}&per_page=5`, { headers: authHeaders() });
  const orgs = res?.items?.filter((i) => i.type === "Organization") ?? [];
  if (orgs.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const exact = orgs.find((o) => norm(o.login) === norm(slug) || norm(o.login) === norm(company));
  return (exact ?? orgs[0]).login;
}

export async function fetchGithubContacts(company: string, domain: string): Promise<LaneResult> {
  try {
    const org = await findOrg(company, domain);
    if (!org) return { source: "github", candidates: [] };

    const members = await fetchJson<{ login: string }[]>(
      `${API}/orgs/${org}/public_members?per_page=${MAX_MEMBERS}`,
      { headers: authHeaders() }
    );
    if (!members || members.length === 0) return { source: "github", candidates: [] };

    const candidates: RawCandidate[] = [];
    for (const m of members.slice(0, MAX_MEMBERS)) {
      const user = await fetchJson<GhUser>(`${API}/users/${m.login}`, { headers: authHeaders() });
      if (!user) continue;
      if (user.email && isPlausibleEmail(user.email)) {
        candidates.push({
          name: user.name ?? user.login,
          email: user.email.toLowerCase(),
          linkedinUrl: undefined,
          source: "github",
          confidence: 0.75, // a published profile email is real, but role unknown
          verified: true,
          verifyMethod: "published",
        });
      } else if (user.name) {
        // No email, but a real person at the org → feed name to the resolve step.
        candidates.push({ name: user.name, source: "github", confidence: 0 });
      }
    }
    return { source: "github", candidates };
  } catch (e: unknown) {
    return { source: "github", candidates: [], error: e instanceof Error ? e.message : String(e) };
  }
}
