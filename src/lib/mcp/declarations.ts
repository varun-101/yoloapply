import { normalizeCompany } from "./jobIdentity";

// Candidate-scoped answers to two recurring application declarations:
//   - "Have you previously worked for <hiring company>?"
//   - "Is a relative of yours a government official / public servant?"
// They live in the candidate's own UserProfile.applicationAnswers under
// `declarationDefaults`, so they never become defaults for any other user.
// Saved employment history always beats the generic "No": a hiring company
// that matches a known past employer or client gets no default at all.

export const DECLARATION_KEYS = ["priorEmploymentAtHiringCompany", "relativeInGovernment"] as const;
export type DeclarationKey = (typeof DECLARATION_KEYS)[number];

export interface SavedDeclarationDefault {
  answer: "No";
  confirmedAt: string;
  confirmedBy: "candidate";
  /** Organizations the candidate worked with that are NOT in profile.experience (e.g. freelance clients). */
  knownPastOrganizations?: string[];
  note?: string;
}

export type DeclarationDefaults = Partial<Record<DeclarationKey, SavedDeclarationDefault>>;

export type ResolvedDeclaration =
  | { key: DeclarationKey; status: "answer"; answer: "No"; source: "candidate_saved_default"; confirmedAt: string }
  | {
      key: DeclarationKey;
      status: "known_relationship";
      answer: null;
      matchedOrganization: string;
      guidance: string;
    }
  | { key: DeclarationKey; status: "needs_company"; answer: "No"; guidance: string; confirmedAt: string }
  | { key: DeclarationKey; status: "unknown"; answer: null; guidance: string };

/** Declarations the saved "No" defaults must never be stretched to cover. */
export const NOT_COVERED_BY_DEFAULTS = [
  "age or date of birth (e.g. 18+)",
  "legal mailing address",
  "criminal history",
  "non-compete or other legal declarations not listed above",
  "family members employed by the hiring company (unless the form asks about government officials)",
];

export function readDeclarationDefaults(applicationAnswers: unknown): DeclarationDefaults {
  if (!applicationAnswers || typeof applicationAnswers !== "object") return {};
  const raw = (applicationAnswers as Record<string, unknown>).declarationDefaults;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: DeclarationDefaults = {};
  for (const key of DECLARATION_KEYS) {
    const entry = (raw as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.answer !== "No" || e.confirmedBy !== "candidate" || typeof e.confirmedAt !== "string") continue;
    out[key] = {
      answer: "No",
      confirmedAt: e.confirmedAt,
      confirmedBy: "candidate",
      knownPastOrganizations: Array.isArray(e.knownPastOrganizations)
        ? e.knownPastOrganizations.filter((v): v is string => typeof v === "string" && !!v.trim())
        : undefined,
      note: typeof e.note === "string" ? e.note : undefined,
    };
  }
  return out;
}

/** True when two organization names plausibly name the same company. */
export function sameOrganization(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "Loan for India" vs "Loan For India Pvt Ltd" already normalize equal;
  // containment catches "DataCurve" vs "DataCurve AI" without matching on
  // fragments shorter than a real name.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && (long === short || long.startsWith(short + " ") || long.endsWith(" " + short));
}

export function resolveDeclarations(input: {
  defaults: DeclarationDefaults;
  experienceCompanies: string[];
  company?: string | null;
}): ResolvedDeclaration[] {
  const { defaults, experienceCompanies, company } = input;
  return DECLARATION_KEYS.map((key): ResolvedDeclaration => {
    const saved = defaults[key];
    if (!saved) {
      return {
        key,
        status: "unknown",
        answer: null,
        guidance: "No saved answer for this candidate. Ask the candidate; do not assume.",
      };
    }
    if (key === "priorEmploymentAtHiringCompany") {
      const known = [...experienceCompanies, ...(saved.knownPastOrganizations ?? [])].filter(Boolean);
      if (!company?.trim()) {
        return {
          key,
          status: "needs_company",
          answer: "No",
          confirmedAt: saved.confirmedAt,
          guidance: `"No" applies only when the hiring company is not one of: ${known.join(", ") || "(none saved)"}. Pass the company to resolve it.`,
        };
      }
      const match = known.find((org) => sameOrganization(org, company));
      if (match) {
        return {
          key,
          status: "known_relationship",
          answer: null,
          matchedOrganization: match,
          guidance: `The candidate has a saved history with ${match}. Answer from that history truthfully; ask the candidate if the form needs details that are not saved.`,
        };
      }
    }
    return { key, status: "answer", answer: "No", source: "candidate_saved_default", confirmedAt: saved.confirmedAt };
  });
}
