// Keyword config for the non-curated discovery sources (ATS boards, HN). The
// tier-1 sources (freshers sheet, jobfound) are already curated for freshers,
// so these filters do NOT apply to them.
//
// The ATS company watchlist lives in the AtsCompany table, seeded from the
// kalil0321/ats-scrapers dataset — see scripts/seed-ats-companies.ts.

// A role's title must match at least one of these.
export const INCLUDE_KEYWORDS = [
  "software engineer",
  "software developer",
  "backend",
  "back end",
  "back-end",
  "full stack",
  "fullstack",
  "full-stack",
  "java",
  "node",
  "platform engineer",
  "sde",
  "swe",
  "developer",
  "engineer intern",
  "engineering intern",
];

// ...and none of these as whole words (senior roles and non-engineering tracks).
export const EXCLUDE_KEYWORDS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "head",
  "architect",
  "sr",
  "vp",
  "sales",
  "marketing",
  "designer",
  "recruiter",
  "ii",
  "iii",
  "iv",
];

// Locations worth applying from Mumbai: anywhere in India, or remote.
export const LOCATION_KEYWORDS = [
  "india",
  "remote",
  "bengaluru",
  "bangalore",
  "mumbai",
  "pune",
  "hyderabad",
  "chennai",
  "gurgaon",
  "gurugram",
  "noida",
  "delhi",
];

// Whole-word match — "swe" must not match "Swedish", "lead" must not match "leader".
function wordMatch(text: string, keyword: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[-\s]+/g, "[-\\s]")}([^a-z0-9]|$)`).test(text);
}

export function titleMatches(title: string): boolean {
  const t = title.toLowerCase();
  if (EXCLUDE_KEYWORDS.some((k) => wordMatch(t, k))) return false;
  return INCLUDE_KEYWORDS.some((k) => wordMatch(t, k));
}

export function locationMatches(location: string | undefined, isRemote?: boolean): boolean {
  if (isRemote) return true;
  if (!location) return true; // unknown — let it through, the human review filters it
  const l = location.toLowerCase();
  return LOCATION_KEYWORDS.some((k) => l.includes(k));
}
