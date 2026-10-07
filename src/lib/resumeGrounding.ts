// Checks that keep the model's resume rewrites inside the candidate's own
// facts. The prompt asks for this; these make it hold even when the model
// ignores the prompt. A rewrite that fails any check is discarded in favour of
// the original wording, so the cost of a false alarm is only a missed edit.

// The candidate's material, lower-cased once, plus the technology names that
// a rewrite must not silently drop.
export interface Grounding {
  corpus: string;
  techTerms: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-term match, so "Go" is not found in "Google" nor "Java" in
// "JavaScript". Letters, digits and + / # count as part of a term.
export function mentions(haystackLower: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}+#])${escapeRegExp(t)}(?![\\p{L}\\p{N}+#])`, "u").test(haystackLower);
}

// Standalone figures with their units ("$100", "100%", "10x", "5k+"), one
// entry per occurrence. The 2 in "OAuth2" or the 3 in "S3" is part of a
// name, which unknownTerms checks instead.
export function numbersIn(text: string): string[] {
  const re = /(?<![\p{L}\d.,])(?:[$€£]|Rs\.?\s?|INR\s?)?\d+(?:[.,]\d+)*(?:%|[xkKM]\b|\+)?(?![\p{L}\d])/gu;
  return (text.match(re) ?? []).map((n) => n.replace(/,/g, "").replace(/\s/g, "")).sort();
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Ordinary words a resume sentence opens with. A sentence's first word is
// capitalised whatever it is, so it is checked like any other term unless it
// is one of these: "Kubernetes powers ..." must not slip through as an opener.
const OPENERS = new Set(
  (
    "a an the also and plus as at in on for from with using through currently recently " +
    "built builds building developed develops designed designs implemented implements integrated " +
    "shipped ships led leads owned owns automated automates created creates engineered delivered " +
    "launched improved reduced increased optimized migrated deployed maintained managed coordinated " +
    "collaborated drove established streamlined wrote added connected handled modeled published ran " +
    "scaled refactored tested debugged analyzed researched prototyped configured enabled extended " +
    "introduced produced supported used worked contributed partnered mentored focuses brings combines " +
    "applies specializes works enjoys software backend frontend full-stack fullstack engineer developer " +
    "early-career junior graduate computer student experienced hands-on product-minded"
  ).split(" ")
);

// A plain capitalised word that is a listed opener or reads as a verb or
// adverb ("Served", "Building", "Recently"). Names ("Kubernetes", "Google")
// and anything with inner capitals, digits or dots ("TypeScript", "EC2")
// still go through the corpus check.
function isOrdinaryOpener(t: string): boolean {
  const lower = t.toLowerCase();
  if (OPENERS.has(lower)) return true;
  return /^\p{Lu}\p{Ll}+$/u.test(t) && /(?:ed|ing|ly)$/.test(lower);
}

function clean(raw: string): string {
  return raw
    .replace(/^[^\p{L}\p{N}$€£]+/u, "")
    .replace(/[^\p{L}\p{N}+#%]+$/u, "")
    .replace(/['’]s$/u, "");
}

// Terms the text relies on that need checking: anything capitalised or
// numeric (proper nouns, technologies, acronyms, figures), including a
// sentence's first word unless it is an ordinary opener.
function significantTerms(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    sentence.split(/\s+/).forEach((raw, i) => {
      const t = clean(raw);
      if (!t || !/[\p{Lu}\p{N}]/u.test(t)) return;
      if (i === 0 && isOrdinaryOpener(t)) return;
      out.push(t);
    });
  }
  return out;
}

// Terms in `text` that appear nowhere in the candidate's material. Compounds
// such as "Next.js/React" or "AI-generated" pass when every capitalised part
// is known.
export function unknownTerms(text: string, corpusLower: string): string[] {
  return significantTerms(text).filter((t) => {
    if (mentions(corpusLower, t)) return false;
    const pieces = t.split(/[/-]/);
    const parts = pieces.filter((p) => /[\p{Lu}\p{N}]/u.test(p));
    return pieces.length < 2 || parts.length === 0 || parts.some((p) => !mentions(corpusLower, p));
  });
}

const MAX_LENGTH_RATIO = 1.35;
const MIN_LENGTH_RATIO = 0.6;

// A bullet rewrite is kept only if it is about as long as the original, keeps
// every figure and named technology the original had, and introduces no
// figure, name or technology the candidate never mentioned.
export function acceptRewrite(original: string, rewrite: string, g: Grounding): boolean {
  const n = words(original);
  const m = words(rewrite);
  if (m > Math.max(n * MAX_LENGTH_RATIO, n + 4)) return false;
  if (m < Math.max(3, Math.ceil(n * MIN_LENGTH_RATIO))) return false;

  // Same figures, same units, same number of times each.
  if (numbersIn(original).join(" ") !== numbersIn(rewrite).join(" ")) return false;

  const originalLower = original.toLowerCase();
  const rewriteLower = rewrite.toLowerCase();
  if (g.techTerms.some((t) => mentions(originalLower, t) && !mentions(rewriteLower, t))) return false;

  return unknownTerms(rewrite, g.corpus).length === 0;
}
