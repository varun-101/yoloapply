import { chatJson, deAi } from "./llm";
import { getProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getLlmConfig } from "./credentials";
import { systemFor } from "./prompts";

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
  const [profile, projectBank, llmCfg, system] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
    systemFor(userId, "coldEmail"),
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
    system,
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
