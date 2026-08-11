export type AutofillConfidence = "high" | "medium" | "low";
export type AutofillKind = "profile" | "generated" | "select" | "skip";

export interface AutofillPolicyField {
  id: string;
  label?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface AutofillProposal {
  id: string;
  value?: string;
  kind?: AutofillKind;
  confidence?: AutofillConfidence;
  profileKey?: string;
}

export type SensitiveFieldCategory =
  | "demographics"
  | "disability"
  | "veteran_status"
  | "criminal_history"
  | "compensation"
  | "legal_consent"
  | "work_authorization"
  | "conflict_of_interest"
  | "secret_or_challenge";

export interface AutofillDecision {
  id: string;
  value: string;
  kind: AutofillKind;
  confidence: AutofillConfidence;
  profileKey?: string;
  requiresHumanReview: boolean;
  reason?: string;
  sensitivity?: SensitiveFieldCategory;
}

const SENSITIVE_PATTERNS: Array<[SensitiveFieldCategory, RegExp]> = [
  ["secret_or_challenge", /\b(password|passcode|one[- ]?time password|otp|captcha|security answer|pin)\b/i],
  ["demographics", /\b(race|racial|ethnic(?:ity)?|religion|gender|sex assigned|sexual orientation|pronouns?)\b/i],
  ["disability", /\b(disab(?:ility|led)|medical condition|health condition|accommodation)\b/i],
  ["veteran_status", /\b(veteran|military service|armed forces)\b/i],
  ["criminal_history", /\b(criminal|conviction|convicted|arrest|felony|misdemeanor)\b/i],
  ["compensation", /\b(salary|compensation|expected (?:ctc|pay)|current (?:ctc|pay)|desired pay|pay expectation)\b/i],
  [
    "legal_consent",
    /\b(i (?:agree|certify|declare|consent|acknowledge)|terms and conditions|privacy policy|background check|electronic signature|legal declaration)\b/i,
  ],
  [
    "work_authorization",
    /\b(work authori[sz]ation|authori[sz]ed to work|visa|sponsorship|sponsor(?:ed)?|right to work|immigration status)\b/i,
  ],
  ["conflict_of_interest", /\b(conflict of interest|non[- ]?compete|related to (?:an? )?(?:employee|director)|government official)\b/i],
];

function fieldText(field: AutofillPolicyField): string {
  return [field.label, field.name, field.placeholder, field.type].filter(Boolean).join(" ");
}

export function sensitiveFieldCategory(field: AutofillPolicyField): SensitiveFieldCategory | undefined {
  if ((field.type ?? "").toLowerCase() === "password") return "secret_or_challenge";
  const text = fieldText(field);
  return SENSITIVE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

function reviewDecision(
  field: AutofillPolicyField,
  proposal: AutofillProposal,
  reason: string,
  sensitivity?: SensitiveFieldCategory
): AutofillDecision {
  return {
    id: field.id,
    value: "",
    kind: "skip",
    confidence: proposal.confidence ?? "low",
    ...(proposal.profileKey ? { profileKey: proposal.profileKey } : {}),
    requiresHumanReview: field.required !== false,
    reason,
    ...(sensitivity ? { sensitivity } : {}),
  };
}

/**
 * Enforces the rules that must never be delegated to an LLM. The proposal is
 * already profile-substituted before it reaches this function.
 */
export function enforceAutofillPolicy(
  field: AutofillPolicyField,
  proposal: AutofillProposal | undefined
): AutofillDecision {
  const candidate: AutofillProposal = proposal ?? { id: field.id, kind: "skip", confidence: "low" };
  const confidence: AutofillConfidence = ["high", "medium", "low"].includes(candidate.confidence ?? "")
    ? (candidate.confidence as AutofillConfidence)
    : "low";
  const kind: AutofillKind = ["profile", "generated", "select", "skip"].includes(candidate.kind ?? "")
    ? (candidate.kind as AutofillKind)
    : "skip";
  const value = typeof candidate.value === "string" ? candidate.value.trim() : "";
  const sensitivity = sensitiveFieldCategory(field);

  if (field.type === "checkbox" || field.type === "radio") {
    return reviewDecision(field, candidate, "Choice controls are left for candidate review.", sensitivity);
  }

  // Stored work-authorization answers are candidate-authored and may be used,
  // but only when the model mapped them to the corresponding canonical keys.
  if (sensitivity === "work_authorization") {
    const supportedKey = candidate.profileKey === "workAuthorization" || candidate.profileKey === "sponsorship";
    if (!(kind === "profile" && supportedKey && value && confidence === "high")) {
      return reviewDecision(field, candidate, "Work authorization or sponsorship needs a saved, confidently mapped answer.", sensitivity);
    }
  } else if (sensitivity) {
    return reviewDecision(field, candidate, "Sensitive question intentionally left for the candidate.", sensitivity);
  }

  if (confidence !== "high") {
    return reviewDecision(field, candidate, "Mapping confidence is below the automatic-fill threshold.");
  }
  if (kind === "skip" || !value) {
    return reviewDecision(field, candidate, "No supported candidate answer is available.");
  }
  if (Array.isArray(field.options) && field.options.length > 0) {
    const options = Array.isArray(field.options) ? field.options : [];
    if (!options.includes(value)) {
      return reviewDecision(field, candidate, "The proposed value is not an exact option on the form.");
    }
  }

  return {
    id: field.id,
    value,
    kind,
    confidence,
    ...(candidate.profileKey ? { profileKey: candidate.profileKey } : {}),
    requiresHumanReview: false,
  };
}

export function enforceAutofillDecisions(
  fields: readonly AutofillPolicyField[],
  proposals: readonly AutofillProposal[]
): AutofillDecision[] {
  const proposalById = new Map(proposals.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  return fields.map((field) => enforceAutofillPolicy(field, proposalById.get(field.id)));
}
