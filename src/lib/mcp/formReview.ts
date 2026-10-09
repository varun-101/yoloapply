import type { CandidateProfile } from "../profile";
import { sensitiveFieldCategory } from "../application-agent/autofill-policy";
import { resolveDeclarations, type DeclarationDefaults } from "./declarations";
import { findSavedAnswer, readSavedAnswers, type SavedAnswer } from "./savedAnswers";

// Deterministic review of an employer form AFTER the site parsed the uploaded
// resume. The agent reports what each field shows (and, separately, what it
// verified was persisted); this compares against the candidate's saved facts
// and says which fields are fine, which need correcting, and which only the
// candidate can answer. It never invents a value or a dropdown option.

export interface ObservedField {
  label: string;
  fieldType?: string; // text | select | combobox | radio | checkbox | textarea | file
  required?: boolean;
  /** What the UI shows right now. */
  displayedValue?: string | null;
  /** What the agent confirmed the form will submit (read-back after blur, hidden input, selected option). */
  persistedValue?: string | null;
  options?: string[];
}

export type FieldVerdict =
  | "ok" // matches a saved fact and persistence was verified
  | "ok_unverified" // matches, but only the displayed value was observed
  | "correct" // filled with something other than the saved fact
  | "fill" // empty, and a saved fact exists
  | "ask_candidate" // no saved fact; only the candidate can answer
  | "review_sensitive" // sensitive category; use a saved answer only if one is listed
  | "leave_optional" // optional and no saved fact: leave blank
  | "no_matching_option"; // a saved fact exists but none of the options matches it

export interface FieldReview {
  label: string;
  verdict: FieldVerdict;
  expected?: string;
  option?: string;
  factSource?: string;
  reason: string;
}

interface Fact {
  value: string;
  source: string;
  compare?: "digits" | "url" | "text" | "place";
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

function urlish(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

export function valuesMatch(actual: string | null | undefined, fact: Fact): boolean {
  if (!actual?.trim()) return false;
  if (fact.compare === "digits") {
    const a = digits(actual);
    const e = digits(fact.value);
    // Allow a country code on either side.
    return !!a && !!e && (a === e || a.endsWith(e) || e.endsWith(a)) && Math.min(a.length, e.length) >= 7;
  }
  if (fact.compare === "url") return urlish(actual) === urlish(fact.value);
  if (fact.compare === "place") return samePlace(actual, fact.value);
  return norm(actual) === norm(fact.value);
}

/**
 * "Pune" and "Pune, India" (or "Pune, Maharashtra, India") name the same
 * place: equal when one is a leading, comma-separated prefix of the other.
 * "Pune" vs "Mumbai, India" still differs.
 */
export function samePlace(a: string, b: string): boolean {
  const parts = (s: string) => s.split(/[,|/]/).map(norm).filter(Boolean);
  const x = parts(a);
  const y = parts(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((p, i) => p === long[i]);
}

/** Picks a real option for a saved value: exact, then a single unambiguous containment. */
export function chooseOption(options: string[], value: string): string | null {
  const target = norm(value);
  if (!target) return null;
  const exact = options.filter((o) => norm(o) === target);
  if (exact.length === 1) return exact[0];
  const contains = options.filter((o) => {
    const n = norm(o);
    // Whole-word containment, so "Male" never matches "Female".
    return n && (` ${n} `.includes(` ${target} `) || ` ${target} `.includes(` ${n} `)) && Math.min(n.length, target.length) >= 3;
  });
  return contains.length === 1 ? contains[0] : null;
}

type Saved = Record<string, SavedAnswer>;
const saved = (s: Saved, key: string, compare: Fact["compare"] = "text"): Fact | null =>
  s[key] && !s[key].company ? named(s[key].answer, `savedAnswers.${key}`, compare) : null;

const RULES: { pattern: RegExp; fact: (p: CandidateProfile, s: Saved) => Fact | null }[] = [
  { pattern: /\bfirst name\b|\bgiven name\b/i, fact: (p) => named(p.name.split(/\s+/)[0], "profile.name") },
  { pattern: /\blast name\b|\bsurname\b|\bfamily name\b/i, fact: (p) => named(p.name.split(/\s+/).slice(1).join(" "), "profile.name") },
  { pattern: /^\s*(full )?name\s*\*?\s*$/i, fact: (p) => named(p.name, "profile.name") },
  { pattern: /^\s*(your )?e-?mail( address)?\s*\*?\s*$/i, fact: (p) => named(p.email, "profile.email") },
  { pattern: /^\s*(your )?(phone|mobile|cell)( (number|no\.?))?\s*\*?\s*$|^\s*contact number\s*\*?\s*$/i, fact: (p) => named(p.phone, "profile.phone", "digits") },
  // Link fields come labelled many ways ("LinkedIn Profile URL", "Github link
  // (optional)", "Your LinkedIn"); a question ("Do you have a GitHub?") is not one.
  { pattern: /^(?!.*\?)\s*(your )?linked\s*in\b[^?]*$/i, fact: (p) => named(p.linkedin, "profile.linkedin", "url") },
  { pattern: /^(?!.*\?)\s*(your )?git\s*hub\b[^?]*$/i, fact: (p) => named(p.github, "profile.github", "url") },
  { pattern: /^(?!.*\?)\s*(your )?(portfolio|personal (web)?site|website|blog)\b[^?]*$/i, fact: (p) => named(p.portfolio, "profile.portfolio", "url") },
  {
    pattern: /^\s*(current )?(location|city)( \(city\))?\s*\*?\s*$|\bwhere are you (currently )?(based|located)\b/i,
    fact: (p) =>
      named(
        p.applicationAnswers.currentLocation || [p.city, p.country].filter(Boolean).join(", "),
        p.applicationAnswers.currentLocation ? "applicationAnswers.currentLocation" : "profile.city",
        "place"
      ),
  },
  { pattern: /^\s*country( of residence)?\s*\*?\s*$|\bcountry you (currently )?(live|reside) in\b/i, fact: (p, s) => saved(s, "country", "place") ?? named(p.country, "profile.country", "place") },
  { pattern: /\b(postal|mailing|home|residential|street|current) address\b|^\s*address( line 1)?\s*\*?\s*$/i, fact: (_p, s) => saved(s, "postalAddress") },
  { pattern: /^\s*(postal|zip|pin) ?code\s*\*?\s*$|\bpincode\b/i, fact: (_p, s) => saved(s, "postalCode", "digits") },
  { pattern: /\bcurrent (annual )?(ctc|salary|compensation|pay)\b/i, fact: (_p, s) => saved(s, "currentSalary") },
  { pattern: /\bexpected (annual )?(ctc|salary|compensation|pay)\b|\bsalary expectations?\b|\bdesired (salary|compensation)\b/i, fact: (_p, s) => saved(s, "expectedSalary") },
  { pattern: /\bnotice period\b|\bavailab(le|ility) to start\b/i, fact: (p) => named(p.applicationAnswers.noticePeriod ?? "", "applicationAnswers.noticePeriod") },
  { pattern: /^\s*(total |overall )?years of (professional |work )?experience\s*\*?\s*$|^\s*total experience( \(years\))?\s*\*?\s*$/i, fact: (p) => named(p.yearsOfExperience, "profile.yearsOfExperience") },
  { pattern: /^\s*(school|university|college|institution)( name)?\s*\*?\s*$/i, fact: (p) => named(p.education?.school ?? "", "profile.education.school") },
  { pattern: /^\s*degree\s*\*?\s*$/i, fact: (p) => named(p.education?.degree ?? "", "profile.education.degree") },
  { pattern: /^\s*(expected )?graduation (date|year)\s*\*?\s*$/i, fact: (p) => named(p.education?.grad ?? "", "profile.education.grad") },
  { pattern: /\b(willing|open) to relocate\b|\brelocat(e|ion)\b/i, fact: (p) => named(p.applicationAnswers.willingToRelocate ?? "", "applicationAnswers.willingToRelocate") },
];

function named(value: string | undefined, source: string, compare: Fact["compare"] = "text"): Fact | null {
  const v = value?.trim();
  return v ? { value: v, source, compare } : null;
}

const PRIOR_EMPLOYMENT = /\b(previously|ever|formerly|have you)\b.*\b(work(ed)?|employ(ed|ee)?)\b.*\b(for|at|with|by)\b|\bformer employee\b|\bcurrent or former\b/i;
const GOVERNMENT_RELATIVE = /\b(relative|family member|related to|immediate family)\b.*\b(government|public (official|servant|office)|politically exposed|official)\b/i;
const CURRENT_EMPLOYER = /\b(current (company|employer|organi[sz]ation)|present employer|company name)\b/i;

export function reviewFields(input: {
  fields: ObservedField[];
  profile: CandidateProfile;
  declarationDefaults: DeclarationDefaults;
  company?: string | null;
}): FieldReview[] {
  const { fields, profile, declarationDefaults, company } = input;
  const savedAnswers = readSavedAnswers(profile.applicationAnswers);
  const declarations = resolveDeclarations({
    defaults: declarationDefaults,
    experienceCompanies: profile.experience.map((e) => e.company),
    company,
  });
  const decl = (key: string) => declarations.find((d) => d.key === key)!;

  return fields.map((field): FieldReview => {
    const label = field.label.trim();
    const shown = field.displayedValue ?? null;
    const persisted = field.persistedValue ?? null;
    const optional = field.required === false;

    // Declarations first: they look "sensitive" to the generic policy.
    const declKey = PRIOR_EMPLOYMENT.test(label)
      ? "priorEmploymentAtHiringCompany"
      : GOVERNMENT_RELATIVE.test(label)
        ? "relativeInGovernment"
        : null;
    if (declKey) {
      const d = decl(declKey);
      if (d.status === "answer" || (d.status === "needs_company" && company)) {
        return judge(field, { value: "No", source: `declarationDefaults.${declKey}` }, shown, persisted);
      }
      return {
        label,
        verdict: "ask_candidate",
        reason: "guidance" in d ? d.guidance : "No saved answer.",
      };
    }

    // The same question answered before, in the candidate's own words, wins
    // over the generic rules (and over the sensitive-field fallback).
    const remembered = findSavedAnswer(savedAnswers, label, company);
    if (remembered) {
      return judge(field, { value: remembered.entry.answer, source: `savedAnswers.${remembered.key}`, compare: "text" }, shown, persisted);
    }

    if (CURRENT_EMPLOYER.test(label)) {
      return {
        label,
        verdict: "ask_candidate",
        reason:
          "Current employer is not a structured profile fact. Résumé parsers often insert a past employer here; check the candidate's saved answer preferences text before keeping or changing it.",
      };
    }

    const rule = RULES.find((r) => r.pattern.test(label));
    const fact = rule?.fact(profile, savedAnswers) ?? null;
    if (fact) return judge(field, fact, shown, persisted);

    const sensitivity = sensitiveFieldCategory({ id: label, label, type: field.fieldType });
    if (sensitivity) {
      return {
        label,
        verdict: "review_sensitive",
        reason: `Sensitive (${sensitivity}). Use only an answer the candidate saved (scopedAnswers / answer preferences); otherwise ask.`,
      };
    }
    if (optional) return { label, verdict: "leave_optional", reason: "Optional and no saved fact." };
    return {
      label,
      verdict: "ask_candidate",
      reason: "No saved fact maps to this field. Ask the candidate, then save_candidate_answer with their words so it is not asked again.",
    };
  });
}

function judge(field: ObservedField, fact: Fact, shown: string | null, persisted: string | null): FieldReview {
  const label = field.label.trim();
  const base = { label, expected: fact.value, factSource: fact.source };
  if (field.options?.length) {
    const option = chooseOption(field.options, fact.value);
    if (!option) {
      return {
        ...base,
        verdict: "no_matching_option",
        reason: "None of the offered options matches the saved value. Do not pick a near miss; ask the candidate.",
      };
    }
    const actual = persisted ?? shown;
    if (actual && norm(actual) === norm(option)) {
      return { ...base, option, verdict: persisted ? "ok" : "ok_unverified", reason: persisted ? "Selected option matches." : "Shown option matches; confirm the selection persisted (the control's value, not its search text)." };
    }
    return { ...base, option, verdict: actual ? "correct" : "fill", reason: "Select this exact option from the site's own list." };
  }
  const actual = persisted ?? shown;
  if (!actual?.trim()) return { ...base, verdict: "fill", reason: "Empty; fill with the saved value, then blur and read back." };
  if (valuesMatch(actual, fact)) {
    return persisted
      ? { ...base, verdict: "ok", reason: "Matches the saved value and persistence was verified." }
      : { ...base, verdict: "ok_unverified", reason: "Displayed value matches; verify persistence (blur, read back, or site validation)." };
  }
  return { ...base, verdict: "correct", reason: "Differs from the saved value (often a résumé-parser substitution). Replace it." };
}
