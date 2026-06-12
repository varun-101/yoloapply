import { prisma } from "./db";

// Per-user discovery filters (SearchPreference table). Replaces the old
// hardcoded src/lib/discovery/config.ts; the matcher logic moved here
// verbatim as pure functions over a prefs object.

export interface SearchPrefs {
  userId: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  locationKeywords: string[];
  discoveryEnabled: boolean;
}

// Generic engineering defaults prefilled for new users (they tune them in
// Settings → Search). Locations intentionally start empty — discovery stays
// off until the user says where they can work.
export const DEFAULT_INCLUDE_KEYWORDS = [
  "software engineer",
  "software developer",
  "backend",
  "back end",
  "back-end",
  "frontend",
  "front end",
  "front-end",
  "full stack",
  "fullstack",
  "full-stack",
  "platform engineer",
  "sde",
  "swe",
  "developer",
  "engineer intern",
  "engineering intern",
];

export const DEFAULT_EXCLUDE_KEYWORDS = [
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

export async function getSearchPrefs(userId: string): Promise<SearchPrefs | null> {
  const row = await prisma.searchPreference.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    userId,
    includeKeywords: row.includeKeywords,
    excludeKeywords: row.excludeKeywords,
    locationKeywords: row.locationKeywords,
    discoveryEnabled: row.discoveryEnabled,
  };
}

export async function ensureSearchPrefs(userId: string): Promise<SearchPrefs> {
  const existing = await getSearchPrefs(userId);
  if (existing) return existing;
  const row = await prisma.searchPreference.create({
    data: {
      userId,
      includeKeywords: DEFAULT_INCLUDE_KEYWORDS,
      excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
      locationKeywords: [],
      discoveryEnabled: false,
    },
  });
  return {
    userId,
    includeKeywords: row.includeKeywords,
    excludeKeywords: row.excludeKeywords,
    locationKeywords: row.locationKeywords,
    discoveryEnabled: row.discoveryEnabled,
  };
}

// Whole-word match — "swe" must not match "Swedish", "lead" must not match "leader".
function wordMatch(text: string, keyword: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${keyword.replace(/[-\s]+/g, "[-\\s]")}([^a-z0-9]|$)`).test(text);
}

export function titleMatches(prefs: Pick<SearchPrefs, "includeKeywords" | "excludeKeywords">, title: string): boolean {
  const t = title.toLowerCase();
  if (prefs.excludeKeywords.some((k) => wordMatch(t, k.toLowerCase()))) return false;
  return prefs.includeKeywords.some((k) => wordMatch(t, k.toLowerCase()));
}

export function locationMatches(
  prefs: Pick<SearchPrefs, "locationKeywords">,
  location: string | undefined,
  isRemote?: boolean
): boolean {
  if (isRemote) return true;
  if (!location) return true; // unknown — let it through, the human review filters it
  const l = location.toLowerCase();
  return prefs.locationKeywords.some((k) => l.includes(k.toLowerCase()));
}
