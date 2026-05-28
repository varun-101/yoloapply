import { chatJson } from "./llm";
import { owner } from "./owner";
import { PROJECT_BANK } from "./projects";

const SYSTEM = `You write cold outreach emails on behalf of an early-career software engineer applying to startups and tech companies. The tone is sincere, specific, and confident — never groveling, never spammy. The recipient is a senior leader (CEO, founder, head of engineering) — they get dozens of these a week, so the email must earn the next sentence with the first one.

Constraints:
- One short paragraph (3-5 sentences) max in the body, plus a 1-line sign-off.
- Subject line: under 70 characters, no clickbait, no emojis.
- Reference one concrete proof point from the candidate's work that maps to what the recipient's company does. Do NOT name-drop projects the candidate doesn't actually have.
- End with a single ask: a 15-minute conversation or a specific role.
- No "I hope this email finds you well", no "I am writing to". Skip preambles.
- Output STRICT JSON only.`;

interface DraftInput {
  company: string;
  recipientName?: string;
  recipientTitle?: string;
  role?: string; // role they're hiring for, if known
  hookContext?: string; // anything specific the user knows about the company / recent news
}

export interface ColdEmailDraft {
  subject: string;
  body: string;
  rationale: string; // one line explaining why this hook was chosen
}

export async function draftColdEmail(input: DraftInput): Promise<ColdEmailDraft> {
  const candidate = {
    name: owner.name,
    portfolio: owner.portfolio,
    github: owner.github,
    education: owner.education,
    experience: owner.experience,
    topProjects: PROJECT_BANK.filter((p) => p.featured).map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      outcome: p.outcome,
      tech: p.techStack,
    })),
  };

  const userPrompt = `# CANDIDATE
${JSON.stringify(candidate, null, 2)}

# TARGET
Company: ${input.company}
${input.recipientName ? `Recipient name: ${input.recipientName}\n` : ""}${input.recipientTitle ? `Recipient title: ${input.recipientTitle}\n` : ""}${input.role ? `Role they're hiring for: ${input.role}\n` : ""}${input.hookContext ? `Extra context: ${input.hookContext}\n` : ""}

# TASK
Write a cold email pitching the candidate for a software engineering role at this company. Pick the SINGLE most relevant proof point from the candidate's projects/experience that maps to what this company does (or the role they're hiring for if specified).

Output STRICT JSON:
{
  "subject": "string",
  "body": "string (one short paragraph + sign-off, with \\n between paragraph and sign-off)",
  "rationale": "one sentence — which proof point you chose and why"
}`;

  return await chatJson<ColdEmailDraft>({
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 4096,
    temperature: 0.7,
  });
}
