// Shared parsing helpers for the remote-jobs sources (WeWorkRemotely, RemoteOK,
// Remotive). They describe a role's location as "where the candidate may sit",
// which we translate into the (location, isRemote) shape the matcher expects.

// Parse a Python-style stringified list ("['India','USA']") or a plain
// comma-separated string into trimmed, non-empty tokens.
export function parseList(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (!raw) return [];
  const quoted = [...raw.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  const tokens = quoted.length
    ? quoted
    : raw.replace(/^\[|\]$/g, "").split(",");
  return tokens.map((s) => s.trim()).filter(Boolean);
}

// A token that means "remote, no geographic restriction".
const GLOBAL_RE = /\b(worldwide|anywhere|global|fully[ -]?remote|100%\s*remote|remote)\b/i;
// ...unless it's actually a region-locked "remote", e.g. "Remote (US only)".
const REGION_LOCK_RE = /\bonly\b|\bus\b|u\.s|usa|united states|canada|emea|europe|americas|apac|uk\b/i;

// Translate a list of candidate-location restrictions into matcher inputs.
// - empty / all-global  -> { isRemote: true }  (bypasses the per-user location filter)
// - region-restricted   -> { location: "<joined>", isRemote: false }
//   so a user in India keeps "India"/"Worldwide" roles but drops "US only" ones,
//   matching the discovery rule that US-only remote is useless from India.
export function remoteScope(restrictions: string[]): { location?: string; isRemote: boolean } {
  const cleaned = restrictions.filter(Boolean);
  if (cleaned.length === 0) return { location: "Remote", isRemote: true };
  const allGlobal = cleaned.every((l) => GLOBAL_RE.test(l) && !REGION_LOCK_RE.test(l));
  if (allGlobal) return { location: "Remote", isRemote: true };
  return { location: cleaned.join(", "), isRemote: false };
}

// Map an aggregator's free-form employment type to the catalog's vocabulary.
export function normalizeEmployment(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("intern")) return "Internship";
  if (t.includes("fulltime")) return "Full Time";
  if (t.includes("parttime")) return "Part Time";
  if (t.includes("contract") || t.includes("freelance")) return "Contract";
  return undefined;
}
