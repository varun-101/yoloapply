import { chatJson, deAi } from "./llm";
import { getProfile } from "./profile";
import { getProjectBank } from "./projectBank";
import { getLlmConfig } from "./credentials";
import { systemFor } from "./prompts";

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
  const [profile, projectBank, llmCfg, system] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
    systemFor(userId, "answers"),
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
    system,
    user: userPrompt,
    maxTokens: 6144,
    temperature: 0.5,
  });
  return { ...out, answer: deAi(out.answer ?? "") };
}
