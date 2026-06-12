import { chatJson, deAi } from "./llm";
import { getProfile, CandidateProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getDeepseekKey } from "./credentials";

const SYSTEM = `You write tailored, sincere cover letters for a software-engineering candidate. The letter must be specific, confident, and grounded ONLY in the candidate's real experience and projects — never fabricate employers, metrics, technologies, or claims.

Style:
- 3 short paragraphs: (1) why this role/company and a one-line hook, (2) the strongest 1-2 proof points from the candidate's real work mapped to the JD, (3) a concise close with a call to action.
- ~220-320 words total. No purple prose, no "I am writing to apply", no clichés like "team player" or "fast-paced environment".
- Plain, human, direct. First person.
- CRITICAL — write like a person, not an AI. Do NOT use em dashes or en dashes (the long "—" / "–" characters). Use commas, periods, or parentheses instead. Avoid AI tells: don't overuse "moreover", "furthermore", "leverage", "passionate", "delve", or triadic lists ("X, Y, and Z" stacked repeatedly). Vary sentence length. Prefer simple punctuation.

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

export async function generateCoverLetter(userId: string, input: Input): Promise<CoverLetterDraft> {
  const [profile, projectBank, apiKey] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getDeepseekKey(userId),
  ]);
  const candidate = {
    name: profile.name,
    education: profile.education,
    experience: profile.experience,
    extras: profile.extras,
    portfolio: profile.portfolio,
    github: profile.github,
    topProjects: projectBank.filter((p) => p.featured).map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      problem: p.problem,
      approach: p.approach,
      outcome: p.outcome,
      tech: p.techStack,
    })),
    otherProjects: projectBank.filter((p) => !p.featured).map((p) => ({
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
    apiKey,
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 6144,
    temperature: 0.6,
  });
  return {
    salutation: deAi(draft.salutation || "Dear Hiring Manager,"),
    paragraphs: (Array.isArray(draft.paragraphs) ? draft.paragraphs.filter(Boolean) : []).map(deAi),
    closing: deAi(draft.closing || "Sincerely,"),
  };
}


// Render the structured draft to a plain-text cover letter (for copy/paste + email).
export function coverLetterToText(profile: CandidateProfile, draft: CoverLetterDraft): string {
  const contactLine = [profile.email, profile.phone].filter(Boolean).join(" | ");
  const header = [profile.name, contactLine, profile.portfolio].filter(Boolean).join("\n");
  return [
    header,
    "",
    draft.salutation,
    "",
    draft.paragraphs.join("\n\n"),
    "",
    draft.closing,
    profile.name,
  ].join("\n");
}
