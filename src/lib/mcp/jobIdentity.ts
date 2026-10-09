import { canonicalizeJobUrl } from "../jobs/url";

// Pure helpers for telling whether two job references are the same posting,
// and for describing a catalog row honestly (dates, salary, JD quality).
// No database or network access, so they are unit-tested directly.

/**
 * A board-independent identity for a posting, derived from its URL. Two URLs
 * with the same key are the same posting even when one carries extra path
 * segments (Lever's /apply, Ashby's /application) or a different board host
 * (boards.greenhouse.io vs job-boards.greenhouse.io).
 */
export function postingKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d+$/.test(ghJid)) return `greenhouse:${ghJid}`;
  if (host.endsWith("greenhouse.io")) {
    const m = /\/jobs\/(\d+)/.exec(path);
    if (m) return `greenhouse:${m[1]}`;
  }
  if (host.endsWith("lever.co")) {
    const m = new RegExp(`/(${uuid})`, "i").exec(path);
    if (m) return `lever:${m[1].toLowerCase()}`;
  }
  if (host.endsWith("ashbyhq.com")) {
    const m = new RegExp(`/(${uuid})`, "i").exec(path);
    if (m) return `ashby:${m[1].toLowerCase()}`;
  }
  if (host.endsWith("rippling.com")) {
    const m = new RegExp(`/jobs/(${uuid})`, "i").exec(path);
    if (m) return `rippling:${m[1].toLowerCase()}`;
  }
  if (host.endsWith("workable.com")) {
    const m = /\/j\/([A-Za-z0-9]+)/.exec(path);
    if (m) return `workable:${m[1].toUpperCase()}`;
  }
  if (host.endsWith("smartrecruiters.com")) {
    const m = /\/(\d{6,})(?:-|$|\/)/.exec(path);
    if (m) return `smartrecruiters:${m[1]}`;
  }
  if (host.endsWith("instahyre.com")) {
    const m = /\/job-(\d+)/.exec(path);
    if (m) return `instahyre:${m[1]}`;
  }
  const canonical = canonicalizeJobUrl(raw);
  return canonical ? `url:${canonical}` : null;
}

const COMPANY_SUFFIXES = new Set([
  "inc", "llc", "ltd", "limited", "pvt", "private", "corp", "corporation", "co", "gmbh", "plc", "llp", "ag", "sa",
]);

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeCompany(company: string): string {
  const words = normalizeWords(company);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

// Trailing words that name a regional entity rather than the employer:
// "Qualcomm India Private Limited" mails as "Qualcomm Careers".
const REGION_WORDS = new Set([
  "india", "usa", "us", "uk", "america", "americas", "emea", "apac", "asia", "europe", "global", "international",
  "worldwide", "germany", "singapore", "canada", "australia", "japan", "china", "ireland", "netherlands", "france",
  "technologies", "solutions", "services", "group", "holdings",
]);
const JOINERS = new Set(["of", "for", "and", "the", "de", "la"]);
// A core this generic would match unrelated mail, so the full name is kept.
const GENERIC_CORES = new Set(["software", "systems", "data", "cloud", "digital", "tech", "technology", "labs", "the", "new", "one"]);

/**
 * Names an employer goes by in mail: the normalized legal name, plus a core
 * name with trailing region/entity words removed ("qualcomm india" ->
 * "qualcomm"). Stripping stops before a joiner, so "Bank of India" stays whole,
 * and never leaves a core shorter than 3 characters.
 */
export function companyAliases(company: string): string[] {
  const full = normalizeCompany(company);
  if (!full) return [];
  const words = full.split(" ");
  while (
    words.length > 1 &&
    (REGION_WORDS.has(words[words.length - 1]) || COMPANY_SUFFIXES.has(words[words.length - 1])) &&
    !JOINERS.has(words[words.length - 2])
  ) {
    words.pop();
  }
  const core = words.join(" ");
  const usable = core.length >= 3 && !GENERIC_CORES.has(core) && !REGION_WORDS.has(core);
  return core !== full && usable ? [full, core] : [full];
}

export function normalizeRole(role: string): string {
  return normalizeWords(role).join(" ");
}

/** Company + role key. Null when either half is empty (too weak to match on). */
export function companyRoleKey(company: string | null | undefined, role: string | null | undefined): string | null {
  const c = normalizeCompany(company ?? "");
  const r = normalizeRole(role ?? "");
  return c && r ? `${c}|${r}` : null;
}

export interface ExperienceRange {
  min: number;
  max: number | null;
}

/** Parses listing experience text such as "0-2 years", "1+ yrs", "Fresher". */
export function parseExperienceRange(text: string | null | undefined): ExperienceRange | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(fresher|freshers|entry[- ]level|new grad|no experience)\b/.test(t)) return { min: 0, max: 1 };
  let m = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?|y\b)/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /(\d+(?:\.\d+)?)\s*\+\s*(?:years?|yrs?)/.exec(t);
  if (m) return { min: Number(m[1]), max: null };
  m = /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/.exec(t);
  if (m) return { min: Number(m[1]), max: null };
  m = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  // Bare ranges from structured sources, e.g. Instahyre "0-2".
  m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  return null;
}

/**
 * Keep a job for a candidate with `maxYears` of experience? Unknown experience
 * is kept unless the caller asked for known-only, since many listings omit it.
 */
export function experienceFits(text: string | null | undefined, maxYears: number, requireKnown = false): boolean {
  const range = parseExperienceRange(text);
  if (!range) return !requireKnown;
  return range.min <= maxYears;
}

export interface JdExperience extends ExperienceRange {
  /** The sentence the requirement was read from, for the agent to check. */
  quote: string;
}

const YEARS = /\d+(?:\.\d+)?\s*(?:\+\s*)?(?:(?:-|–|to)\s*\d+(?:\.\d+)?\s*\+?\s*)?(?:years?|yrs?)\b/i;
const EXPERIENCE_WORD = /\bexp(?:erience|\.)?\b|\bindustry\b|\bprofessional\b|\bhands[- ]on\b/i;
const NOT_REQUIRED = /\b(preferred|nice[- ]to[- ]have|bonus|a plus|is a plus|ideally|desired|desirable|advantage|optional)\b/i;
const NOT_EXPERIENCE = /\b(years? old|years? of age|founded|in business|for over|since \d{4}|track record of \d+|warranty|anniversary)\b/i;

/**
 * The experience a description actually requires: listing fields ("0-1 yrs")
 * are often a board's band, not the employer's bar. Reads sentences that
 * state years of experience, skips preferred/bonus ones, and returns the
 * LOWEST stated requirement (several lines usually mean per-skill minimums).
 */
export function jdExperienceRequirement(jdText: string | null | undefined): JdExperience | null {
  if (!jdText) return null;
  let best: JdExperience | null = null;
  const sentences = jdText.split(/(?<=[.;!?])\s+|\n+/);
  for (const raw of sentences) {
    const s = raw.trim();
    if (s.length > 400 || !YEARS.test(s) || !EXPERIENCE_WORD.test(s)) continue;
    if (NOT_REQUIRED.test(s) || NOT_EXPERIENCE.test(s)) continue;
    const range = parseExperienceRange(s);
    if (!range || range.min > 20) continue;
    if (!best || range.min < best.min) best = { ...range, quote: s.replace(/\s+/g, " ").slice(0, 200) };
  }
  return best;
}

/**
 * Experience fit using the listing field AND the description: the stricter
 * (higher) stated minimum wins, since a "0-1 years" listing band does not
 * lower an employer's "3+ years" requirement.
 */
export function jobExperienceFits(
  listing: string | null | undefined,
  jdText: string | null | undefined,
  maxYears: number,
  requireKnown = false
): boolean {
  const mins = [parseExperienceRange(listing)?.min, jdExperienceRequirement(jdText)?.min].filter(
    (v): v is number => typeof v === "number"
  );
  if (!mins.length) return !requireKnown;
  return Math.max(...mins) <= maxYears;
}

export interface SalaryInfo {
  /** The listing's own salary text, verbatim. Null when the listing has none. */
  listedText: string | null;
  disclosed: boolean;
  /** Always false: listing salary text is never independently verified. */
  verified: false;
  note: string;
}

export function describeSalary(salary: string | null | undefined): SalaryInfo {
  const text = salary?.replace(/\s+/g, " ").trim() || null;
  const meaningful = !!text && !/^(not disclosed|undisclosed|n\/?a|none|-|competitive)$/i.test(text);
  return {
    listedText: text,
    disclosed: meaningful,
    verified: false,
    note: meaningful
      ? "Salary text as published by the listing source; not verified. Re-check the live posting."
      : "Salary not disclosed by the listing. Do not assume it meets the candidate's minimum.",
  };
}

export type JdQuality = "missing" | "thin" | "present";

/**
 * Cached descriptions sometimes keep only section headings. "thin" means the
 * agent should read the live posting before judging fit.
 */
export function jdQuality(jdText: string | null | undefined): JdQuality {
  const text = jdText?.trim() ?? "";
  if (text.length < 50) return "missing";
  if (text.length < 600) return "thin";
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const longLines = lines.filter((l) => l.length > 80).length;
  if (lines.length >= 4 && longLines === 0) return "thin";
  return "present";
}

/**
 * Quality from the full length plus a possibly truncated head of the text:
 * length decides missing/thin, the head decides "headings only".
 */
export function jdQualityOf(length: number | null | undefined, head: string | null | undefined): JdQuality {
  if (!length || length < 50) return "missing";
  if (length < 600) return "thin";
  const lines = (head ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.length >= 4 && !lines.some((l) => l.length > 80) ? "thin" : "present";
}

export interface ApplicationRef {
  id: string;
  company: string;
  role: string;
  status: string;
  appliedAt: Date | null;
  createdAt: Date;
  jdUrl: string | null;
  applyUrl: string | null;
  canonicalUrl: string | null;
}

export type DuplicateReason = "canonical_url" | "posting_id" | "company_role";

export interface DuplicateMatch {
  applicationId: string;
  reason: DuplicateReason;
  status: string;
  appliedAt: string | null;
  company: string;
  role: string;
}

/** In-memory index of one user's applications for duplicate checks. */
export class ApplicationIndex {
  private byUrl = new Map<string, ApplicationRef[]>();
  private byPosting = new Map<string, ApplicationRef[]>();
  private byCompanyRole = new Map<string, ApplicationRef[]>();

  constructor(apps: ApplicationRef[]) {
    for (const app of apps) {
      const urls = new Set<string>();
      const postings = new Set<string>();
      for (const raw of [app.canonicalUrl, app.jdUrl, app.applyUrl]) {
        const c = canonicalizeJobUrl(raw);
        if (c) urls.add(c);
        const p = postingKey(raw);
        if (p) postings.add(p);
      }
      for (const u of urls) push(this.byUrl, u, app);
      for (const p of postings) push(this.byPosting, p, app);
      const cr = companyRoleKey(app.company, app.role);
      if (cr) push(this.byCompanyRole, cr, app);
    }
  }

  canonicalUrls(): string[] {
    return [...this.byUrl.keys()];
  }

  match(input: { urls?: (string | null | undefined)[]; company?: string | null; role?: string | null }): DuplicateMatch[] {
    const found = new Map<string, DuplicateMatch>();
    const add = (apps: ApplicationRef[] | undefined, reason: DuplicateReason) => {
      for (const app of apps ?? []) {
        if (found.has(app.id)) continue;
        found.set(app.id, {
          applicationId: app.id,
          reason,
          status: app.status,
          appliedAt: app.appliedAt?.toISOString() ?? null,
          company: app.company,
          role: app.role,
        });
      }
    };
    for (const raw of input.urls ?? []) {
      const c = canonicalizeJobUrl(raw);
      if (c) add(this.byUrl.get(c), "canonical_url");
      const p = postingKey(raw);
      if (p) add(this.byPosting.get(p), "posting_id");
    }
    const cr = companyRoleKey(input.company, input.role);
    if (cr) add(this.byCompanyRole.get(cr), "company_role");
    return [...found.values()];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
