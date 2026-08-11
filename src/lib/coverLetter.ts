import { chatJson, deAi } from "./llm";
import { getProfile, CandidateProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getLlmConfig } from "./credentials";
import { systemFor } from "./prompts";

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
  const [profile, projectBank, llmCfg, system] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
    systemFor(userId, "coverLetter"),
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
    ...llmCfg,
    system,
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
