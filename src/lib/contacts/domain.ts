// Resolve a company's real email domain from a lead. This is the load-bearing
// step: most apply URLs point at a JOB BOARD (boards.greenhouse.io/acme,
// jobs.lever.co/acme, linkedin.com/jobs/…), not the company, so we can't just
// take the apply URL's hostname. Strategy:
//   1. If the apply/JD URL's host is a real company site (not a known board),
//      use its registrable domain.
//   2. Otherwise fall back to Clearbit's free autocomplete, which maps a company
//      NAME → its primary domain (no key required).

// Hosts that are job boards / ATSes / social sites — their hostname is never the
// employer's email domain (the company is a path slug instead).
const BOARD_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "recruitee.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "myworkdayjobs.com",
  "workday.com",
  "keka.com",
  "zohorecruit.com",
  "freshteam.com",
  "jobvite.com",
  "icims.com",
  "breezy.hr",
  "teamtailor.com",
  "ycombinator.com",
  "workatastartup.com",
  "wellfound.com",
  "angel.co",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "instahyre.com",
  "cutshort.io",
  "hirist.com",
  "monster.com",
  "ziprecruiter.com",
  "google.com",
  "notion.site",
  "notion.so",
  "airtable.com",
  "docs.google.com",
  "forms.gle",
  "typeform.com",
  "lnkd.in",
  "bit.ly",
];

// Hosting/mail providers that are valid hostnames but never an employer's own domain.
const GENERIC_HOSTS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
  "icloud.com",
];

export function isBoardHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return BOARD_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

export function isGenericHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return GENERIC_HOSTS.includes(h);
}

// Strip to the registrable domain. Naive but adequate: drop www and any single
// leading subdomain label only when the remainder still has a dot (so
// "careers.acme.com" → "acme.com" but "acme.com" stays). Multi-label public
// suffixes (co.uk, co.in) are handled by not collapsing two-letter final labels.
export function registrableDomain(host: string): string {
  let h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const parts = h.split(".");
  // Known two-level TLDs where we keep the last three labels.
  const twoLevel = ["co.uk", "co.in", "com.au", "co.nz", "co.za", "com.br", "org.uk"];
  const lastTwo = parts.slice(-2).join(".");
  const keep = twoLevel.includes(lastTwo) ? 3 : 2;
  if (parts.length > keep) h = parts.slice(-keep).join(".");
  return h;
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname;
    if (isBoardHost(host) || isGenericHost(host)) return null;
    return registrableDomain(host);
  } catch {
    return null;
  }
}

interface ClearbitSuggestion {
  name: string;
  domain: string;
  logo: string;
}

// Company NAME → primary domain via Clearbit's free, keyless autocomplete.
// Best-effort: returns null on any failure so the caller can degrade.
async function domainFromCompanyName(company: string): Promise<string | null> {
  const q = company.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const list = (await res.json()) as ClearbitSuggestion[];
    if (!Array.isArray(list) || list.length === 0) return null;
    // Prefer an exact-ish name match, else the first suggestion.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const exact = list.find((s) => norm(s.name) === norm(q));
    const pick = (exact ?? list[0]).domain;
    return pick ? registrableDomain(pick) : null;
  } catch {
    return null;
  }
}

export interface ResolvedDomain {
  domain: string | null;
  via: "url" | "name" | "none";
}

// Resolve the best email domain for a company, trying the lead's URLs first
// (when they're a real company site), then the company-name lookup.
export async function resolveCompanyDomain(opts: {
  company: string;
  urls?: (string | null | undefined)[];
}): Promise<ResolvedDomain> {
  for (const url of opts.urls ?? []) {
    const d = domainFromUrl(url);
    if (d) return { domain: d, via: "url" };
  }
  const byName = await domainFromCompanyName(opts.company);
  if (byName) return { domain: byName, via: "name" };
  return { domain: null, via: "none" };
}
