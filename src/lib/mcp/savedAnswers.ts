import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { normalizeCompany } from "./jobIdentity";

// Answers the candidate gave an agent in conversation ("my notice period is
// immediate", "current CTC 8 LPA"), saved so the next application doesn't ask
// again. They live in the candidate's own UserProfile.applicationAnswers under
// `savedAnswers`, next to the Settings form keys and declaration defaults, and
// every entry records the candidate's own words and when they said it.
//
// The agent may only save what the candidate actually said: the tool requires
// that statement verbatim, and nothing here can derive or guess a value.

export interface SavedAnswer {
  question: string;
  answer: string;
  /** Form labels this answers, normalized when matched. */
  labels: string[];
  /** Only for applications to this company (e.g. "why us?"). */
  company?: string;
  candidateStatement: string;
  confirmedAt: string;
  confirmedBy: "candidate";
}

/** Settings form keys a saved answer can also fill (they drive review_form_fields rules). */
export const STRUCTURED_KEYS = ["noticePeriod", "currentLocation", "willingToRelocate", "workAuthorization", "sponsorship"] as const;

const KEY = /^[A-Za-z][A-Za-z0-9_]{1,59}$/;
export const MAX_SAVED_ANSWERS = 200;

export function normLabel(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").replace(/\b(required|optional)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** camelCase key from free text: "Current CTC (INR)?" -> "currentCtcInr". */
export function answerKey(text: string): string {
  const words = normLabel(text).split(" ").filter(Boolean).slice(0, 8);
  const key = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("");
  return /^[a-z]/.test(key) ? key.slice(0, 60) : `q${key}`.slice(0, 60);
}

export function readSavedAnswers(applicationAnswers: unknown): Record<string, SavedAnswer> {
  if (!applicationAnswers || typeof applicationAnswers !== "object") return {};
  const raw = (applicationAnswers as Record<string, unknown>).savedAnswers;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SavedAnswer> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    if (typeof e.answer !== "string" || !e.answer.trim() || e.confirmedBy !== "candidate") continue;
    out[key] = {
      question: typeof e.question === "string" ? e.question : key,
      answer: e.answer,
      labels: Array.isArray(e.labels) ? e.labels.filter((l): l is string => typeof l === "string") : [],
      company: typeof e.company === "string" && e.company.trim() ? e.company : undefined,
      candidateStatement: typeof e.candidateStatement === "string" ? e.candidateStatement : "",
      confirmedAt: typeof e.confirmedAt === "string" ? e.confirmedAt : "",
      confirmedBy: "candidate",
    };
  }
  return out;
}

/**
 * The saved answer for a form field, if one applies: same label (or question)
 * after normalization, and either unscoped or scoped to this company.
 * Company-scoped answers win over general ones.
 */
export function findSavedAnswer(
  saved: Record<string, SavedAnswer>,
  label: string,
  company?: string | null
): { key: string; entry: SavedAnswer } | null {
  const target = normLabel(label);
  if (!target) return null;
  const company_ = company ? normalizeCompany(company) : null;
  let general: { key: string; entry: SavedAnswer } | null = null;
  for (const [key, entry] of Object.entries(saved)) {
    const names = [entry.question, ...entry.labels].map(normLabel);
    if (!names.includes(target)) continue;
    if (entry.company) {
      if (company_ && normalizeCompany(entry.company) === company_) return { key, entry };
      continue;
    }
    general ??= { key, entry };
  }
  return general;
}

export interface SaveAnswerInput {
  key?: string;
  question: string;
  answer: string;
  fieldLabels?: string[];
  company?: string;
  candidateStatement: string;
}

export async function saveCandidateAnswer(userId: string, input: SaveAnswerInput) {
  const answer = input.answer.trim();
  const statement = input.candidateStatement.trim();
  if (!answer || !statement) throw new ApiUserError("answer and candidateStatement are required.", 400, "invalid_input");
  const key = input.key?.trim() || answerKey(input.question);
  if (!KEY.test(key)) {
    throw new ApiUserError("key must be camelCase letters/digits (2-60 chars), e.g. currentSalary.", 400, "invalid_input");
  }
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { applicationAnswers: true } });
  if (!profile) throw new ApiUserError("Set up the candidate profile first (Settings -> Profile).", 400, "no_profile");
  const existing = readSavedAnswers(profile.applicationAnswers);
  if (!existing[key] && Object.keys(existing).length >= MAX_SAVED_ANSWERS) {
    throw new ApiUserError(`At most ${MAX_SAVED_ANSWERS} saved answers. Ask the candidate to prune them in Settings -> Profile.`, 400, "too_many_answers");
  }
  const labels = [...new Set([input.question, ...(input.fieldLabels ?? [])].map((l) => l.trim()).filter(Boolean))].slice(0, 12);
  const entry: SavedAnswer = {
    question: input.question.trim(),
    answer,
    labels,
    ...(input.company?.trim() ? { company: input.company.trim() } : {}),
    candidateStatement: statement.slice(0, 1000),
    confirmedAt: new Date().toISOString(),
    confirmedBy: "candidate",
  };
  const structured = (STRUCTURED_KEYS as readonly string[]).includes(key) && !entry.company;
  // One statement, so a concurrent save of another key isn't lost to a
  // read-modify-write race.
  await prisma.$executeRaw`
    UPDATE "UserProfile"
    SET "applicationAnswers" =
          jsonb_set(COALESCE("applicationAnswers", '{}'::jsonb), '{savedAnswers}',
                    COALESCE("applicationAnswers"->'savedAnswers', '{}'::jsonb) || jsonb_build_object(${key}::text, ${JSON.stringify(entry)}::jsonb), true)
          || CASE WHEN ${structured} THEN jsonb_build_object(${key}::text, ${answer}::text) ELSE '{}'::jsonb END,
        "updatedAt" = now()
    WHERE "userId" = ${userId}`;
  return { key, saved: entry, alsoSetProfileField: structured ? key : null, replaced: !!existing[key] };
}

/** Removes one saved answer (Settings UI; the MCP never deletes). */
export async function deleteSavedAnswer(userId: string, key: string) {
  if (!KEY.test(key)) throw new ApiUserError("Invalid key.", 400, "invalid_input");
  const n = await prisma.$executeRaw`
    UPDATE "UserProfile"
    SET "applicationAnswers" = jsonb_set("applicationAnswers", '{savedAnswers}', COALESCE("applicationAnswers"->'savedAnswers', '{}'::jsonb) - ${key}::text, true),
        "updatedAt" = now()
    WHERE "userId" = ${userId} AND "applicationAnswers" ? 'savedAnswers'`;
  return { removed: n > 0 };
}
