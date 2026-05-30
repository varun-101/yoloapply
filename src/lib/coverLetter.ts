import { chatJson } from "./llm";
import { owner } from "./owner";
import { PROJECT_BANK } from "./projects";

const SYSTEM = `You write tailored, sincere cover letters for a software-engineering candidate. The letter must be specific, confident, and grounded ONLY in the candidate's real experience and projects — never fabricate employers, metrics, technologies, or claims.

Style:
- 3 short paragraphs: (1) why this role/company and a one-line hook, (2) the strongest 1-2 proof points from the candidate's real work mapped to the JD, (3) a concise close with a call to action.
- ~220-320 words total. No purple prose, no "I am writing to apply", no clichés like "team player" or "fast-paced environment".
- Plain, human, direct. First person.

Output STRICT JSON only:
{ "salutation": "Dear Hiring Manager,", "paragraphs": ["...", "...", "..."], "closing": "Sincerely," }`;

export interface CoverLetterDraft {
  salutation: string;
  paragraphs: string[];
  closing: string;
}

interface Input {
  company: string;
  role: string;
  jobDescription?: string;
}

export async function generateCoverLetter(input: Input): Promise<CoverLetterDraft> {
  const candidate = {
    name: owner.name,
    education: owner.education,
    experience: owner.experience,
    extras: owner.extras,
    portfolio: owner.portfolio,
    github: owner.github,
    topProjects: PROJECT_BANK.filter((p) => p.featured).map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      problem: p.problem,
      approach: p.approach,
      outcome: p.outcome,
      tech: p.techStack,
    })),
    otherProjects: PROJECT_BANK.filter((p) => !p.featured).map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      tech: p.techStack,
    })),
  };

  const userPrompt = `# CANDIDATE
${JSON.stringify(candidate, null, 2)}

# TARGET JOB
Company: ${input.company}
Role: ${input.role}
${input.jobDescription ? `Job description:\n"""\n${input.jobDescription.slice(0, 6000)}\n"""` : ""}

# TASK
Write the cover letter per the schema. Pick the proof points that best match THIS job. Salutation should address the company by name where natural (e.g. "Dear ${input.company} Hiring Team,"). Stay truthful to the candidate's data.`;

  const draft = await chatJson<CoverLetterDraft>({
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 6144,
    temperature: 0.6,
  });
  return {
    salutation: draft.salutation || "Dear Hiring Manager,",
    paragraphs: Array.isArray(draft.paragraphs) ? draft.paragraphs.filter(Boolean) : [],
    closing: draft.closing || "Sincerely,",
  };
}

// Render the structured draft to a plain-text cover letter (for copy/paste + email).
export function coverLetterToText(draft: CoverLetterDraft): string {
  const header = `${owner.name}\n${owner.email} | ${owner.phone}\n${owner.portfolio}`;
  return [
    header,
    "",
    draft.salutation,
    "",
    draft.paragraphs.join("\n\n"),
    "",
    draft.closing,
    owner.name,
  ].join("\n");
}
