import { emailDomain, normalizeEmail } from "./verify";

// Turning a person's name + a company domain into a likely email. Two inputs:
//   - a pattern INFERRED from a known (name, email) pair on the same domain
//     (e.g. "Jane Doe" + "jane.doe@acme.com" ⇒ "{first}.{last}"), which lets us
//     confidently fill emails for OTHER people at that company (e.g. Apollo names
//     whose addresses were locked), and
//   - a fixed list of common fallback patterns, ranked by real-world frequency.

export interface ParsedName {
  first: string;
  last: string;
  firstInitial: string;
  lastInitial: string;
}

export function parseName(name: string | undefined | null): ParsedName | null {
  if (!name) return null;
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z\s'-]/g, "")
    .replace(/\b(?:mr|mrs|ms|dr|prof)\.?\b/gi, "")
    .trim()
    .replace(/\s+/g, " ");
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0].toLowerCase().replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!first || !last) return null;
  return { first, last, firstInitial: first[0], lastInitial: last[0] };
}

// Render a pattern token like "{first}.{last}" for a parsed name.
function render(pattern: string, n: ParsedName): string | null {
  const local = pattern
    .replace(/\{first\}/g, n.first)
    .replace(/\{last\}/g, n.last)
    .replace(/\{fi\}/g, n.firstInitial)
    .replace(/\{li\}/g, n.lastInitial);
  // A residual brace means we couldn't fill it.
  if (/[{}]/.test(local) || !local) return null;
  return local;
}

// Given a real (name,email), reverse-engineer which pattern produced it, so the
// same shape can be reused for the rest of the company. Returns a pattern token
// or null if the local-part doesn't match any known shape.
const KNOWN_PATTERNS = [
  "{first}.{last}",
  "{first}{last}",
  "{first}",
  "{first}_{last}",
  "{fi}{last}",
  "{fi}.{last}",
  "{first}{li}",
  "{last}{fi}",
  "{last}.{first}",
  "{last}{first}",
];

export function inferPattern(name: string, email: string): string | null {
  const n = parseName(name);
  if (!n) return null;
  const local = normalizeEmail(email).split("@")[0];
  for (const p of KNOWN_PATTERNS) {
    if (render(p, n) === local) return p;
  }
  return null;
}

// Fallback patterns ranked by frequency, each with a base confidence for the
// guess. An inferred company pattern (when present) is tried FIRST at higher
// confidence than any of these.
const FALLBACK_PATTERNS: { pattern: string; confidence: number }[] = [
  { pattern: "{first}.{last}", confidence: 0.45 },
  { pattern: "{first}", confidence: 0.35 },
  { pattern: "{first}{last}", confidence: 0.3 },
  { pattern: "{fi}{last}", confidence: 0.25 },
  { pattern: "{first}_{last}", confidence: 0.2 },
];

export interface GuessedEmail {
  email: string;
  confidence: number;
  fromInferredPattern: boolean;
}

// Produce ranked email guesses for a name on a domain. If `inferred` is set we
// lead with it at high confidence and append a couple of distinct fallbacks.
export function guessEmails(
  name: string | undefined | null,
  domain: string,
  inferred?: string | null,
  max = 2
): GuessedEmail[] {
  const n = parseName(name);
  if (!n) return [];
  const out: GuessedEmail[] = [];
  const seen = new Set<string>();
  const push = (local: string | null, confidence: number, fromInferred: boolean) => {
    if (!local) return;
    const email = `${local}@${domain}`.toLowerCase();
    if (seen.has(email)) return;
    seen.add(email);
    out.push({ email, confidence, fromInferredPattern: fromInferred });
  };

  if (inferred) push(render(inferred, n), 0.7, true);
  for (const f of FALLBACK_PATTERNS) {
    if (out.length >= max + (inferred ? 1 : 0)) break;
    push(render(f.pattern, n), f.confidence, false);
  }
  return out.slice(0, max + (inferred ? 1 : 0));
}

// Pick the best inferable pattern from a set of real (name,email) pairs on the
// company's own domain. Used to set CompanyContactCache.pattern.
export function inferCompanyPattern(
  pairs: { name?: string | null; email?: string | null }[],
  domain: string
): string | null {
  const counts = new Map<string, number>();
  for (const { name, email } of pairs) {
    if (!name || !email) continue;
    if (emailDomain(email) !== domain) continue;
    const p = inferPattern(name, email);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [p, c] of counts) {
    if (c > bestN) {
      best = p;
      bestN = c;
    }
  }
  return best;
}
