import { prisma } from "../db";
import { getProfile, CandidateProfile } from "../profile";
import { getProjectBank, ProjectBankItem } from "../projectBank";
import { getLlmConfig } from "../credentials";
import { ApiUserError } from "../auth";
import { type LlmConfig } from "../llm";
import { InterviewMode } from "./types";

// Everything the engine needs to plan and run an interview, loaded once.
// Mirrors loadPersonalizeContext: profile + project bank + the user's own LLM
// key, plus (company mode) the target job's JD — tenant-scoped so another
// user's application id looks nonexistent.
export interface InterviewContext {
  profile: CandidateProfile;
  projectBank: ProjectBankItem[];
  llmCfg: LlmConfig;
  mode: InterviewMode;
  company: string | null;
  role: string | null;
  jobDescription: string | null;
}

export async function loadInterviewContext(
  userId: string,
  applicationId?: string | null
): Promise<InterviewContext> {
  const [profile, projectBank, llmCfg] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
  ]);

  if (!applicationId) {
    return {
      profile,
      projectBank,
      llmCfg,
      mode: "general",
      company: null,
      role: null,
      jobDescription: null,
    };
  }

  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { company: true, role: true, jdText: true },
  });
  if (!app) {
    throw new ApiUserError("Application not found.", 404, "not_found");
  }

  return {
    profile,
    projectBank,
    llmCfg,
    mode: "company",
    company: app.company,
    role: app.role,
    jobDescription: app.jdText ?? null,
  };
}

// Compact candidate snapshot for prompts — only facts the model is allowed to
// draw on (profile + project bank). Keeps the no-fabrication rule enforceable.
export function candidateForPrompt(ctx: InterviewContext) {
  return {
    name: ctx.profile.name,
    education: ctx.profile.education,
    experience: ctx.profile.experience,
    extras: ctx.profile.extras,
    projects: ctx.projectBank.map((p) => ({
      slug: p.slug,
      title: p.title,
      oneLiner: p.oneLiner,
      problem: p.problem,
      approach: p.approach,
      outcome: p.outcome,
      techStack: p.techStack,
    })),
  };
}
