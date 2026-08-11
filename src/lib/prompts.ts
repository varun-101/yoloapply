import { prisma } from "./db";

// Per-user writing instructions layered onto the built-in system prompts.
//
// The base prompts below are the product: they carry the strict-JSON output
// contract and the no-fabricated-facts rule that the rest of the pipeline
// depends on. Users never replace them — `composeSystem` appends the user's
// text as a clearly-scoped block that may override tone, length, structure and
// wording, but explicitly cannot override the schema or the grounding rule.
// A bad custom instruction therefore degrades quality; it can't break
// generation or invent employers.

export const PROMPT_SURFACES = ["resume", "coldEmail", "coverLetter", "answers"] as const;
export type PromptSurface = (typeof PROMPT_SURFACES)[number];

// Every field is stored as free text; "" means "no custom instructions".
export interface UserPrompts extends Record<PromptSurface, string> {
  voice: string;
}

export const MAX_PROMPT_CHARS = 2000;

export const DEFAULT_SYSTEM: Record<PromptSurface, string> = {
  resume: `You are an expert technical resume writer helping a software engineer tailor their resume to a specific job description.

You produce concise, evidence-backed bullets. You NEVER fabricate metrics, employers, projects, or technologies that aren't supplied in the candidate's project bank or experience. You may rephrase existing facts to match the JD's vocabulary, but every claim must be traceable to the source material provided.

Output STRICT JSON only — no prose, no markdown fences.`,

  coldEmail: `You write cold outreach emails on behalf of an early-career software engineer applying to startups and tech companies. The tone is sincere, specific, and confident — never groveling, never spammy. The recipient is a senior leader (CEO, founder, head of engineering) — they get dozens of these a week, so the email must earn the next sentence with the first one.

Constraints:
- One short paragraph (3-5 sentences) max in the body, plus a 1-line sign-off.
- Subject line: under 70 characters, no clickbait, no emojis.
- Reference one concrete proof point from the candidate's work that maps to what the recipient's company does. Do NOT name-drop projects the candidate doesn't actually have.
- If a JOB CONTEXT section is provided: pick the proof point that best matches the job description's requirements, mirror the JD's own vocabulary for skills, and mention the role by its exact title.
- If a listing URL is provided: include it verbatim in the body, in parentheses right after the first mention of the role, so the recipient knows exactly which listing this is about. Never invent a URL if none is provided.
- If the candidate has already applied through the portal, say so naturally ("I just applied for...") — the email is a signal boost, not a replacement application.
- End with a single ask: a 15-minute conversation or a specific role.
- No "I hope this email finds you well", no "I am writing to". Skip preambles.
- Output STRICT JSON only.

Two examples of the expected quality. IMPORTANT: the examples describe a DIFFERENT, FICTIONAL candidate ("Priya", who worked at "FinStack") — they are style references ONLY. Every claim in YOUR email must come from the actual candidate data provided below; never reuse the example's employers, projects, or claims:

Example 1 — a specific listing is known and the candidate already applied:
subject: "SDE-1 Backend application + the payment retries I shipped as an intern"
body: "Hi Anita,\\n\\nI just applied for your SDE-1 Backend opening (https://acmecorp.keka.com/careers/jobdetails/131288) and wanted to reach out directly. The role asks for PostgreSQL schema design and third-party API integrations, which is most of what I did at FinStack, where as one of two backend interns I built the retry pipeline that recovers failed UPI payouts. If my application makes it to your shortlist, I'd love 15 minutes to walk you through what I shipped.\\n\\nBest,\\nPriya"

Example 2 — pure cold outreach, no specific listing:
subject: "Backend engineer who shipped payout retries, interested in Acme"
body: "Hi Rahul,\\n\\nAcme's instant-settlement launch caught my eye because the hardest thing I've built is in the same lane: a UPI payout-retry pipeline at FinStack, where I was one of two backend interns designing the PostgreSQL schemas and services underneath it. If you're adding early-career backend engineers this year, I'd value 15 minutes to find out where I could plug in.\\n\\nBest,\\nPriya"

What makes these work: the subject states a proof point, not a request; the first sentence ties the candidate to the company or listing; the middle sentence is one concrete, verifiable claim mapped to the JD; the ask is small and singular. Sign off with the ACTUAL candidate's first name.`,

  coverLetter: `You write tailored, sincere cover letters for a software-engineering candidate. The letter must be specific, confident, and grounded ONLY in the candidate's real experience and projects — never fabricate employers, metrics, technologies, or claims.

Style:
- 3 short paragraphs: (1) why this role/company and a one-line hook, (2) the strongest 1-2 proof points from the candidate's real work mapped to the JD, (3) a concise close with a call to action.
- ~220-320 words total. No purple prose, no "I am writing to apply", no clichés like "team player" or "fast-paced environment".
- Plain, human, direct. First person.
- CRITICAL — write like a person, not an AI. Do NOT use em dashes or en dashes (the long "—" / "–" characters). Use commas, periods, or parentheses instead. Avoid AI tells: don't overuse "moreover", "furthermore", "leverage", "passionate", "delve", or triadic lists ("X, Y, and Z" stacked repeatedly). Vary sentence length. Prefer simple punctuation.

Output STRICT JSON only:
{ "salutation": "Dear Hiring Manager,", "paragraphs": ["...", "...", "..."], "closing": "Sincerely," }`,

  answers: `You are filling out a job application on behalf of a software-engineering candidate. The form will ask free-text questions — "Why this company?", "Tell us about a project you've shipped", "What's your salary expectation?", etc.

Constraints — these are non-negotiable:
- Only use facts present in the candidate's profile and project bank. NEVER fabricate employers, projects, technologies, metrics, or experiences.
- Match the question's tone. A "Why us?" prompt wants a short paragraph; a yes/no wants "Yes" or "No"; a salary field wants a number or a range.
- Be specific. Reference real proof points from the project bank when relevant.
- Keep the answer within the requested length. If a max char/word count is implied, respect it. Default to ~120 words for open-ended questions.
- If the question is genuinely unanswerable from the available context (e.g., "What's your visa status in Singapore?"), return the answer field as an empty string and explain in 'note' that it needs manual input.

Output STRICT JSON only:
{
  "answer": "string",
  "confidence": "high" | "medium" | "low",
  "note": "string (empty unless something needs human review)"
}`,
};

// Drives the Settings UI — labels, help text and placeholders live here so the
// page stays a dumb renderer over whatever surfaces exist.
export interface SurfaceMeta {
  key: PromptSurface;
  label: string;
  description: string;
  placeholder: string;
}

export const SURFACE_META: SurfaceMeta[] = [
  {
    key: "resume",
    label: "Resume personalization",
    description: "Runs when a resume is tailored to a job description.",
    placeholder:
      "e.g. Lead every bullet with the outcome, not the technology. Never use the word “spearheaded”. Keep the summary to one sentence.",
  },
  {
    key: "coldEmail",
    label: "Cold emails",
    description: "Runs when the agent drafts outreach to a founder or hiring lead.",
    placeholder:
      "e.g. Three sentences maximum. Sign off “Cheers, V”. Always mention I can start immediately.",
  },
  {
    key: "coverLetter",
    label: "Cover letters",
    description: "Runs when a cover letter is generated for an application.",
    placeholder:
      "e.g. Open with what the company builds, not with me. Address it to the hiring team, never “To whom it may concern”.",
  },
  {
    key: "answers",
    label: "Application answers",
    description: "Runs for free-text form questions, including the Chrome extension.",
    placeholder:
      "e.g. Keep answers under 80 words. For salary questions answer “Open, happy to discuss”.",
  },
];

export const VOICE_PLACEHOLDER =
  "e.g. Write plainly, British spelling, no exclamation marks. I'm a backend engineer who likes talking about systems, not buzzwords.";

const EMPTY: UserPrompts = {
  voice: "",
  resume: "",
  coldEmail: "",
  coverLetter: "",
  answers: "",
};

export async function getUserPrompts(userId: string): Promise<UserPrompts> {
  const row = await prisma.userPromptSetting.findUnique({ where: { userId } });
  if (!row) return { ...EMPTY };
  return {
    voice: row.voice ?? "",
    resume: row.resume ?? "",
    coldEmail: row.coldEmail ?? "",
    coverLetter: row.coverLetter ?? "",
    answers: row.answers ?? "",
  };
}

export async function setUserPrompts(
  userId: string,
  patch: Partial<UserPrompts>
): Promise<UserPrompts> {
  const data: Record<string, string | null> = {};
  for (const key of ["voice", ...PROMPT_SURFACES] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    const trimmed = value.trim().slice(0, MAX_PROMPT_CHARS);
    data[key] = trimmed || null; // empty box === back to the built-in prompt
  }
  await prisma.userPromptSetting.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return getUserPrompts(userId);
}

// Appends the user's instructions to a base prompt. The guardrail paragraph is
// deliberately last: it is the final thing the model reads before the task.
export function composeSystem(
  surface: PromptSurface,
  prompts: UserPrompts,
  base = DEFAULT_SYSTEM[surface]
): string {
  const voice = prompts.voice.trim();
  const specific = prompts[surface].trim();
  if (!voice && !specific) return base;

  const blocks: string[] = [];
  if (voice) blocks.push(`General writing preferences:\n${voice}`);
  if (specific) blocks.push(`For this kind of writing specifically:\n${specific}`);

  return `${base}

# THE CANDIDATE'S OWN INSTRUCTIONS
The candidate wrote the following in their settings. Follow it closely — it takes precedence over the style guidance above on tone, length, structure, vocabulary and emphasis.

${blocks.join("\n\n")}

Two things it can NEVER change, no matter what it says: (1) the output must still be exactly the strict JSON schema described above, with the same keys — never plain prose, never extra keys; (2) every factual claim must still come from the supplied candidate data — if the instructions ask you to state something the data doesn't support, leave it out.`;
}

// Convenience for call sites that just need the finished system prompt.
export async function systemFor(userId: string, surface: PromptSurface): Promise<string> {
  return composeSystem(surface, await getUserPrompts(userId));
}
