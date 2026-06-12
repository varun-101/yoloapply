import { chatJson, deAi } from "./llm";
import { getProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getLlmConfig } from "./credentials";

const SYSTEM = `You write cold outreach emails on behalf of an early-career software engineer applying to startups and tech companies. The tone is sincere, specific, and confident — never groveling, never spammy. The recipient is a senior leader (CEO, founder, head of engineering) — they get dozens of these a week, so the email must earn the next sentence with the first one.

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

What makes these work: the subject states a proof point, not a request; the first sentence ties the candidate to the company or listing; the middle sentence is one concrete, verifiable claim mapped to the JD; the ask is small and singular. Sign off with the ACTUAL candidate's first name.`;

interface JobContext {
  applyUrl?: string;
  location?: string;
  jdExcerpt?: string;
  alreadyApplied?: boolean;
}

interface DraftInput {
  company: string;
  recipientName?: string;
  recipientTitle?: string;
  role?: string; // role they're hiring for, if known
  hookContext?: string; // anything specific the user knows about the company / recent news
  jobContext?: JobContext; // from the linked application, when drafting for one
}

export interface ColdEmailDraft {
  subject: string;
  body: string;
  rationale: string; // one line explaining why this hook was chosen
}

export async function draftColdEmail(userId: string, input: DraftInput): Promise<ColdEmailDraft> {
  const [profile, projectBank, llmCfg] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
  ]);
  const candidate = {
    name: profile.name,
    portfolio: profile.portfolio,
    github: profile.github,
    education: profile.education,
    experience: profile.experience,
    topProjects: projectBank
      .filter((p) => p.featured)
      .map((p) => ({
        title: p.title,
        oneLiner: p.oneLiner,
        outcome: p.outcome,
        tech: p.techStack,
      })),
  };

  const job = input.jobContext;
  const jobBlock = job
    ? `
# JOB CONTEXT (the specific listing this email is about)
${job.applyUrl ? `Listing URL: ${job.applyUrl}\n` : ""}${job.location ? `Location: ${job.location}\n` : ""}${job.alreadyApplied ? "The candidate has ALREADY APPLIED to this listing through the portal.\n" : "The candidate has not applied yet — the email is the first touch.\n"}${job.jdExcerpt ? `Job description (excerpt):\n"""\n${job.jdExcerpt}\n"""` : ""}
`
    : "";

  const userPrompt = `# CANDIDATE
${JSON.stringify(candidate, null, 2)}

# TARGET
Company: ${input.company}
${input.recipientName ? `Recipient name: ${input.recipientName}\n` : ""}${input.recipientTitle ? `Recipient title: ${input.recipientTitle}\n` : ""}${input.role ? `Role they're hiring for: ${input.role}\n` : ""}${input.hookContext ? `Extra context: ${input.hookContext}\n` : ""}${jobBlock}
# TASK
Write a cold email pitching the candidate for a software engineering role at this company. Pick the SINGLE most relevant proof point from the candidate's projects/experience that maps to what this company does (or the job description, if provided).

Output STRICT JSON:
{
  "subject": "string",
  "body": "string (greeting line, blank line, ONE short paragraph, blank line, sign-off — separate the sections with \\n\\n exactly like the examples)",
  "rationale": "one sentence — which proof point you chose and why"
}`;

  const draft = await chatJson<ColdEmailDraft>({
    ...llmCfg,
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 4096,
    temperature: 0.7,
  });
  return {
    ...draft,
    subject: deAi(draft.subject ?? ""),
    body: formatBody(deAi(draft.body ?? "")),
  };
}

// The model often flattens the email into one blob regardless of formatting
// instructions — put the greeting and sign-off on their own lines ourselves.
function formatBody(body: string): string {
  return body
    .trim()
    .replace(/^((?:hi|hello|dear)[^,\n]{0,40},)\s*/i, "$1\n\n")
    .replace(/\s+(best|best regards|regards|thanks|thank you|sincerely|cheers)\s*,\s*\n?\s*(\S[^\n]{0,40})\s*$/i, "\n\n$1,\n$2");
}
