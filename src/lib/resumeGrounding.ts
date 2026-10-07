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

// Standalone figures only: the 2 in "OAuth2" or the 3 in "S3" is part of a
// name, which unknownTerms checks instead.
export function numbersIn(text: string): string[] {
  return (text.match(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)*(?![\p{L}\d])/gu) ?? []).map((n) => n.replace(/,/g, ""));
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Terms the text relies on that need checking: anything capitalised or
// numeric that is not just the first word of a sentence (proper nouns,
// technologies, acronyms, figures).
function significantTerms(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+/)) {
    sentence
      .split(/\s+/)
      .slice(1)
      .forEach((raw) => {
        const t = raw.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}+#]+$/u, "");
        if (t && /[\p{Lu}\p{N}]/u.test(t)) out.push(t);
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
    const parts = t.split(/[/-]/).filter((p) => /[\p{Lu}\p{N}]/u.test(p));
    return parts.length === 0 || t.split(/[/-]/).length < 2 || parts.some((p) => !mentions(corpusLower, p));
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

  const before = numbersIn(original);
  const after = numbersIn(rewrite);
  if (before.some((x) => !after.includes(x)) || after.some((x) => !before.includes(x))) return false;

  const originalLower = original.toLowerCase();
  const rewriteLower = rewrite.toLowerCase();
  if (g.techTerms.some((t) => mentions(originalLower, t) && !mentions(rewriteLower, t))) return false;

  return unknownTerms(rewrite, g.corpus).length === 0;
}
