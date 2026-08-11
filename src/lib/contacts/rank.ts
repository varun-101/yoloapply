import type { RawCandidate, RankedContact } from "./types";
import { isRoleInbox, normalizeEmail } from "./verify";

// Seniority/relevance score (0..100) from a title, as a cold-email target for an
// early-career SWE. Founders and eng leaders top the list; recruiters/HR are
// legitimate, slightly-lower targets; unknown ICs sit at the bottom.
export function seniorityRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  if (!t) return 10;
  if (/technical recruiter|engineering recruiter/.test(t)) return 100;
  if (/talent acquisition.*(engineering|technical)|engineering.*talent/.test(t)) return 95;
  if (/\b(talent acquisition|recruiter|recruiting)\b/.test(t)) return 85;
  if (/\b(head of (talent|people|hr)|people partner|hr manager)\b/.test(t)) return 70;
  if (/\b(founder|co-?founder|ceo|owner|cto|chief technology)\b/.test(t)) return 55;
  if (/\b(engineering manager|eng manager|head of eng|director of eng)\b/.test(t)) return 50;
  if (/\b(hr|people|talent)\b/.test(t)) return 65;
  if (/\b(cofounder|director|head of|vp)\b/.test(t)) return 75;
  if (/\b(engineer|developer|swe|sde)\b/.test(t)) return 40;
  return 30;
}

export function recruiterRelevanceRank(
  title: string | null | undefined,
  candidateLocation?: string | null,
  preferredLocation?: string | null
): number {
  const base = seniorityRank(title);
  const candidate = (candidateLocation ?? "").toLowerCase();
  const preferred = (preferredLocation ?? "").toLowerCase().trim();
  if (!candidate || !preferred) return base;
  if (candidate.includes(preferred) || preferred.includes(candidate)) return base + 20;
  const meaningfulTokens = preferred.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  if (meaningfulTokens.some((token) => candidate.includes(token))) return base + 10;
  if (/remote|global|worldwide/.test(candidate)) return base + 3;
  return base;
}

// Composite sort score. Verified + addressable contacts always outrank guesses;
// within a confidence band, seniority breaks the tie. A candidate with no email
// is kept (the user may know who to chase) but floored well below any with one.
export function compositeRank(c: {
  email: string | null;
  confidence: number;
  verified: boolean;
  seniorityRank: number;
  roleInbox?: boolean;
}): number {
  if (c.roleInbox) return 5 + c.confidence * 10;
  // Person relevance is primary. Contact quality is displayed independently
  // and only breaks close ties, so a real recruiter without an unlocked email
  // ranks above careers@ or jobs@.
  return c.seniorityRank + (c.email ? c.confidence * 15 : 0) + (c.verified ? 10 : 0);
}

// Merge candidates from every lane into one ranked list. Dedupe by email
// (lowercased); among same-email rows keep the strongest fields and union the
// source labels + verified flag. Emailless people dedupe by normalized name so a
// person found by both Apollo and GitHub doesn't appear twice.
export function mergeAndRank(candidates: RawCandidate[], preferredLocation?: string | null): RankedContact[] {
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
        phone: c.phone ?? null,
        title: c.title ?? null,
        email,
        linkedinUrl: c.linkedinUrl ?? null,
        location: c.location ?? null,
        providerPersonId: c.providerPersonId ?? null,
        contactStatus: c.contactStatus ?? (email ? "resolved" : "not_requested"),
        source: c.source,
        sources: null,
        confidence: c.confidence,
        verified: !!c.verified,
        verifyMethod: c.verifyMethod ?? null,
        seniorityRank: recruiterRelevanceRank(c.title, c.location, preferredLocation),
        rank: 0,
        _sources: new Set([c.source]),
      };
    }
    // Merge into the existing record, preferring richer/stronger values.
    target.name = target.name ?? c.name ?? null;
    target.phone = target.phone ?? c.phone ?? null;
    target.title = target.title ?? c.title ?? null;
    target.linkedinUrl = target.linkedinUrl ?? c.linkedinUrl ?? null;
    target.location = target.location ?? c.location ?? null;
    target.providerPersonId = target.providerPersonId ?? c.providerPersonId ?? null;
    if (c.contactStatus === "resolved") target.contactStatus = "resolved";
    target._sources.add(c.source);
    if (c.confidence > target.confidence) {
      target.confidence = c.confidence;
      target.source = c.source; // attribute to the most-confident lane
    }
    if (c.verified && !target.verified) {
      target.verified = true;
      target.verifyMethod = c.verifyMethod ?? target.verifyMethod;
    }
    target.seniorityRank = Math.max(target.seniorityRank, recruiterRelevanceRank(c.title, c.location, preferredLocation));
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
      const rank = compositeRank({ ...m, roleInbox: !!m.email && isRoleInbox(m.email) });
      const sources = [...m._sources];
      return {
        name: m.name,
        phone: m.phone,
        title: m.title,
        email: m.email,
        linkedinUrl: m.linkedinUrl,
        location: m.location,
        providerPersonId: m.providerPersonId,
        contactStatus: m.contactStatus,
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
