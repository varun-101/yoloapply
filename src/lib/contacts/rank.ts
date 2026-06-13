import type { RawCandidate, RankedContact } from "./types";
import { isRoleInbox, normalizeEmail } from "./verify";

// Seniority/relevance score (0..100) from a title, as a cold-email target for an
// early-career SWE. Founders and eng leaders top the list; recruiters/HR are
// legitimate, slightly-lower targets; unknown ICs sit at the bottom.
export function seniorityRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  if (!t) return 10;
  if (/\b(founder|co-?founder|ceo|owner)\b/.test(t)) return 100;
  if (/\b(cto|chief technology|vp eng|vp of eng|head of eng|director of eng)\b/.test(t)) return 90;
  if (/\b(head of (talent|people|hr)|talent acquisition|recruit)/.test(t)) return 80;
  if (/\b(engineering manager|eng manager|tech lead|team lead|staff engineer|principal)\b/.test(t)) return 70;
  if (/\b(hr|people|talent)\b/.test(t)) return 65;
  if (/\b(cofounder|director|head of|vp)\b/.test(t)) return 75;
  if (/\b(engineer|developer|swe|sde)\b/.test(t)) return 40;
  return 30;
}

// Composite sort score. Verified + addressable contacts always outrank guesses;
// within a confidence band, seniority breaks the tie. A candidate with no email
// is kept (the user may know who to chase) but floored well below any with one.
export function compositeRank(c: {
  email: string | null;
  confidence: number;
  verified: boolean;
  seniorityRank: number;
}): number {
  if (!c.email) return c.seniorityRank * 0.1; // emailless: tiny, seniority-ordered
  const verifiedBoost = c.verified ? 1 : 0;
  // weight: email-confidence dominates, then verified, then seniority.
  return c.confidence * 100 + verifiedBoost * 40 + c.seniorityRank * 0.3;
}

// Merge candidates from every lane into one ranked list. Dedupe by email
// (lowercased); among same-email rows keep the strongest fields and union the
// source labels + verified flag. Emailless people dedupe by normalized name so a
// person found by both Apollo and GitHub doesn't appear twice.
export function mergeAndRank(candidates: RawCandidate[]): RankedContact[] {
  const byEmail = new Map<string, RankedContact & { _sources: Set<string> }>();
  const byName = new Map<string, RankedContact & { _sources: Set<string> }>();

  const sortMerge = (
    target: (RankedContact & { _sources: Set<string> }) | undefined,
    c: RawCandidate,
    email: string | null
  ): RankedContact & { _sources: Set<string> } => {
    if (!target) {
      return {
        name: c.name ?? null,
        title: c.title ?? null,
        email,
        linkedinUrl: c.linkedinUrl ?? null,
        source: c.source,
        sources: null,
        confidence: c.confidence,
        verified: !!c.verified,
        verifyMethod: c.verifyMethod ?? null,
        seniorityRank: seniorityRank(c.title),
        rank: 0,
        _sources: new Set([c.source]),
      };
    }
    // Merge into the existing record, preferring richer/stronger values.
    target.name = target.name ?? c.name ?? null;
    target.title = target.title ?? c.title ?? null;
    target.linkedinUrl = target.linkedinUrl ?? c.linkedinUrl ?? null;
    target._sources.add(c.source);
    if (c.confidence > target.confidence) {
      target.confidence = c.confidence;
      target.source = c.source; // attribute to the most-confident lane
    }
    if (c.verified && !target.verified) {
      target.verified = true;
      target.verifyMethod = c.verifyMethod ?? target.verifyMethod;
    }
    target.seniorityRank = Math.max(target.seniorityRank, seniorityRank(c.title));
    return target;
  };

  for (const c of candidates) {
    const email = c.email ? normalizeEmail(c.email) : null;
    if (email) {
      byEmail.set(email, sortMerge(byEmail.get(email), c, email));
    } else if (c.name) {
      const key = c.name.toLowerCase().replace(/[^a-z]/g, "");
      if (key) byName.set(key, sortMerge(byName.get(key), c, null));
    }
  }

  // Drop emailless names that we DID end up finding an email for elsewhere.
  const emailedNames = new Set(
    [...byEmail.values()].map((v) => (v.name ?? "").toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean)
  );

  const merged = [
    ...byEmail.values(),
    ...[...byName.values()].filter((v) => {
      const key = (v.name ?? "").toLowerCase().replace(/[^a-z]/g, "");
      return key && !emailedNames.has(key);
    }),
  ];

  return merged
    .map((m) => {
      // A role inbox is real but impersonal — cap its seniority contribution.
      if (m.email && isRoleInbox(m.email)) m.seniorityRank = Math.min(m.seniorityRank, 50);
      const rank = compositeRank(m);
      const sources = [...m._sources];
      return {
        name: m.name,
        title: m.title,
        email: m.email,
        linkedinUrl: m.linkedinUrl,
        source: m.source,
        sources: sources.length > 1 ? sources.join(",") : null,
        confidence: Math.min(1, m.confidence),
        verified: m.verified,
        verifyMethod: m.verifyMethod,
        seniorityRank: m.seniorityRank,
        rank,
      } satisfies RankedContact;
    })
    .sort((a, b) => b.rank - a.rank);
}
