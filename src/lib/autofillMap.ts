import { chatJson, deAi } from "./llm";
import { owner } from "./owner";
import { PROJECT_BANK } from "./projects";

// A field as seen by the content script.
export interface FormFieldSpec {
  id: string; // stable temporary id the content script assigns
  label?: string;
  name?: string;
  type?: string; // text | email | tel | textarea | select | url | number | ...
  placeholder?: string;
  autocomplete?: string;
  maxLength?: number;
  options?: string[]; // for <select> — the visible option texts
}

export interface MappedField {
  id: string;
  value: string;
  kind: "profile" | "generated" | "select" | "skip";
  confidence: "high" | "medium" | "low";
  profileKey?: string; // set by the model for kind=profile; server substitutes the real value
}

// The only keys the model may reference for identity fields. The server fills the
// real value from these — the model never writes an identity value itself, so it
// cannot fabricate an email/phone/etc.
const PROFILE_KEYS = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "github",
  "linkedin",
  "portfolio",
  "city",
  "country",
  "location",
  "yearsOfExperience",
  "currentRole",
  "currentCompany",
  "school",
  "degree",
] as const;

const SYSTEM = `You fill out job-application forms on behalf of a candidate. You are given the candidate's profile, the job context, and a list of form fields (each with a label, name, type, and—for dropdowns—the available options). For EACH field, decide what to put in it.

Rules — non-negotiable:
- NEVER fabricate facts. If a factual field isn't answerable from the profile (e.g. "Aadhaar number", "current/expected CTC", "notice period", "visa status"), set kind="skip".
- IDENTITY / CONTACT / PROFILE fields (name, email, phone, location, links, current company/role, education): set kind="profile" and set "profileKey" to the SINGLE best-matching key from this list — do NOT write the value yourself (the system substitutes the real value):
  ${PROFILE_KEYS.join(", ")}
- <select> fields (options provided): kind="select" and "value" MUST be EXACTLY one of the provided option strings (copy verbatim). If none fit, kind="skip".
- Open-ended free-text ("Why this company?", "Describe a project", cover letter): kind="generated" and write a specific, truthful answer grounded ONLY in the candidate's real work. Respect maxLength. Keep tight (~80-130 words) unless a long cover letter is clearly expected.
- Passwords, OTPs, file uploads, captchas, or anything sensitive/unknowable: kind="skip".
- Yes/No or single-choice text fields: answer concisely and truthfully from the profile; skip if unknowable.

Output STRICT JSON only:
{ "fields": [ { "id": "<id>", "kind": "profile|generated|select|skip", "profileKey": "<one of the allowed keys, only when kind=profile>", "value": "<string, for generated/select only>", "confidence": "high|medium|low" } ] }
Return one entry for every field id you were given.`;

interface MapInput {
  fields: FormFieldSpec[];
  jobDescription?: string;
  company?: string;
  role?: string;
}

export async function mapAutofill(input: MapInput): Promise<MappedField[]> {
  const candidate = {
    name: owner.name,
    firstName: owner.name.split(" ")[0],
    lastName: owner.name.split(" ").slice(1).join(" "),
    email: owner.email,
    phone: owner.phone,
    github: owner.github,
    linkedin: owner.linkedin,
    portfolio: owner.portfolio,
    city: owner.city,
    country: owner.country,
    location: `${owner.city}, ${owner.country}`,
    yearsOfExperience: owner.yearsOfExperience,
    education: owner.education,
    currentRole: owner.experience[0]?.title ?? "",
    currentCompany: owner.experience[0]?.company ?? "",
    experience: owner.experience,
    extras: owner.extras,
    projects: PROJECT_BANK.map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      problem: p.problem,
      approach: p.approach,
      outcome: p.outcome,
      tech: p.techStack,
      year: p.year,
    })),
  };

  const userPrompt = `# CANDIDATE PROFILE
${JSON.stringify(candidate, null, 2)}

# JOB CONTEXT
${input.company ? `Company: ${input.company}\n` : ""}${input.role ? `Role: ${input.role}\n` : ""}${input.jobDescription ? `Job description:\n"""\n${input.jobDescription.slice(0, 5000)}\n"""\n` : ""}

# FORM FIELDS
${JSON.stringify(input.fields, null, 2)}

# TASK
Return the JSON mapping with one entry per field id. Remember: selects must use an exact option string; never invent facts; skip anything sensitive or unknowable.`;

  const out = await chatJson<{ fields: MappedField[] }>({
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 8192,
    temperature: 0.3,
  });
  const raw = Array.isArray(out.fields) ? out.fields : [];

  // Deterministic substitution for identity fields: the real value comes from
  // the profile keyed by profileKey, NOT from whatever the model wrote. This
  // makes it impossible for the model to fabricate an email/phone/name.
  const profileValues: Record<string, string> = {
    fullName: candidate.name,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    github: candidate.github,
    linkedin: candidate.linkedin,
    portfolio: candidate.portfolio,
    city: candidate.city,
    country: candidate.country,
    location: candidate.location,
    yearsOfExperience: String(candidate.yearsOfExperience ?? ""),
    currentRole: candidate.currentRole,
    currentCompany: candidate.currentCompany,
    school: candidate.education?.school ?? "",
    degree: candidate.education?.degree ?? "",
  };

  return raw.map((f) => {
    if (f.kind === "profile") {
      const key = f.profileKey ?? "";
      const real = profileValues[key];
      if (real) return { ...f, value: real };
      // Unknown/missing key — don't trust the model's free-text value.
      return { ...f, kind: "skip", value: "" };
    }
    // Strip em dashes from generated free-text so it doesn't read as AI-written.
    if (f.kind === "generated" && f.value) {
      return { ...f, value: deAi(f.value) };
    }
    return f;
  });
}
