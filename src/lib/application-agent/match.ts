import { MatchCategory, MatchRecommendation } from "@prisma/client";
import { prisma } from "../db";
import { chatJson, deAi } from "../llm";
import { getLlmConfig } from "../credentials";
import { getProfile } from "../profile";
import { getProjectBank } from "../projectBank";

interface MatchAnalysisOutput {
  score: number;
  category: string;
  recommendation: string;
  summary: string;
  strengths: string[];
  gaps: string[];
}

function categoryFor(score: number): MatchCategory {
  if (score >= 80) return MatchCategory.STRONG_MATCH;
  if (score >= 60) return MatchCategory.GOOD_MATCH;
  if (score >= 35) return MatchCategory.LOW_MATCH;
  return MatchCategory.NOT_ELIGIBLE;
}

function recommendationFor(category: MatchCategory): MatchRecommendation {
  if (category === MatchCategory.STRONG_MATCH || category === MatchCategory.GOOD_MATCH) {
    return MatchRecommendation.APPLY;
  }
  if (category === MatchCategory.LOW_MATCH) return MatchRecommendation.REVIEW;
  return MatchRecommendation.SKIP;
}

export async function analyzeApplicationMatch(userId: string, applicationId: string) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
  });
  if (!application) throw new Error("Application not found.");
  if (!application.jdText || application.jdText.trim().length < 50) {
    throw new Error("Add a job description before analyzing the match.");
  }

  const [profile, projects, llm] = await Promise.all([
    getProfile(userId),
    getProjectBank(userId),
    getLlmConfig(userId),
  ]);
  const candidate = {
    location: [profile.city, profile.country].filter(Boolean).join(", "),
    yearsOfExperience: profile.yearsOfExperience,
    education: profile.education,
    experience: profile.experience,
    projects: projects.map((project) => ({
      title: project.title,
      summary: project.oneLiner,
      outcome: project.outcome,
      technologies: project.techStack,
    })),
  };

  const output = await chatJson<MatchAnalysisOutput>({
    ...llm,
    temperature: 0.2,
    maxTokens: 4096,
    system: `You evaluate a candidate's fit for a job. Use only facts in the supplied candidate profile and job description. Never infer experience, eligibility, work authorization, or skills that are not present.

Return strict JSON:
{
  "score": 0-100,
  "category": "STRONG_MATCH|GOOD_MATCH|LOW_MATCH|NOT_ELIGIBLE",
  "recommendation": "APPLY|REVIEW|SKIP",
  "summary": "one concise sentence",
  "strengths": ["specific supported strength"],
  "gaps": ["specific missing or uncertain requirement"]
}

Treat missing evidence as a gap, not as experience. NOT_ELIGIBLE requires a clearly stated hard conflict; otherwise use LOW_MATCH and explain the uncertainty.`,
    user: `# CANDIDATE\n${JSON.stringify(candidate, null, 2)}\n\n# JOB\nCompany: ${application.company}\nRole: ${application.role}\nLocation: ${application.location ?? "not stated"}\n\n${application.jdText.slice(0, 12000)}`,
  });

  const score = Math.max(0, Math.min(100, Math.round(Number(output.score) || 0)));
  const validCategory = Object.values(MatchCategory).includes(output.category as MatchCategory)
    ? (output.category as MatchCategory)
    : categoryFor(score);
  const validRecommendation = Object.values(MatchRecommendation).includes(
    output.recommendation as MatchRecommendation
  )
    ? (output.recommendation as MatchRecommendation)
    : recommendationFor(validCategory);
  const cleanList = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 8)
      .map((item) => deAi(item).slice(0, 300));

  return prisma.applicationAnalysis.upsert({
    where: { applicationId },
    create: {
      applicationId,
      score,
      category: validCategory,
      recommendation: validRecommendation,
      summary: deAi(output.summary ?? "").slice(0, 500),
      strengths: cleanList(output.strengths),
      gaps: cleanList(output.gaps),
    },
    update: {
      score,
      category: validCategory,
      recommendation: validRecommendation,
      summary: deAi(output.summary ?? "").slice(0, 500),
      strengths: cleanList(output.strengths),
      gaps: cleanList(output.gaps),
    },
  });
}
