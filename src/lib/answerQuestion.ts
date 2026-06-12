import { chatJson, deAi } from "./llm";
import { getProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getLlmConfig } from "./credentials";

const SYSTEM = `You are filling out a job application on behalf of a software-engineering candidate. The form will ask free-text questions — "Why this company?", "Tell us about a project you've shipped", "What's your salary expectation?", etc.

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
}`;

interface AnswerInput {
  question: string;
  jobDescription?: string;
  company?: string;
  role?: string;
  maxChars?: number;
}

export interface AnsweredQuestion {
  answer: string;
  confidence: "high" | "medium" | "low";
  note: string;
}

export async function answerQuestion(userId: string, input: AnswerInput): Promise<AnsweredQuestion> {
  const [profile, projectBank, llmCfg] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
  ]);
  const candidate = {
    name: profile.name,
    education: profile.education,
    experience: profile.experience,
    extras: profile.extras,
    portfolio: profile.portfolio,
    github: profile.github,
    linkedin: profile.linkedin,
    topProjects: projectBank.map((p) => ({
      title: p.title,
      oneLiner: p.oneLiner,
      problem: p.problem,
      approach: p.approach,
      outcome: p.outcome,
      tech: p.techStack,
      year: p.year,
    })),
  };

  const userPrompt = `# CANDIDATE
${JSON.stringify(candidate, null, 2)}

# JOB
${input.company ? `Company: ${input.company}\n` : ""}${input.role ? `Role: ${input.role}\n` : ""}${input.jobDescription ? `Job description:\n"""\n${input.jobDescription.slice(0, 6000)}\n"""\n` : ""}

# QUESTION FROM THE APPLICATION FORM
"""
${input.question.slice(0, 2000)}
"""
${input.maxChars ? `\nMax length: ${input.maxChars} characters.` : ""}

# TASK
Produce the JSON-format answer per the schema. If the question is a yes/no or a single-word answer, keep it to that. If it's open-ended, write naturally — short, direct, specific.`;

  const out = await chatJson<AnsweredQuestion>({
    ...llmCfg,
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 6144,
    temperature: 0.5,
  });
  return { ...out, answer: deAi(out.answer ?? "") };
}
