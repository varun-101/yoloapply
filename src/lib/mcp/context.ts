import { prisma } from "../db";
import { getProfileOrNull } from "../profile";
import { getProjectBank } from "../projectBank";
import { getSearchPrefs } from "../searchPrefs";
import { getGenericResumeInfo } from "../files";
import { NOT_COVERED_BY_DEFAULTS, readDeclarationDefaults, resolveDeclarations } from "./declarations";

// Everything an agent needs to answer an application truthfully, in one call:
// the structured profile, the project bank, the candidate's free-text answer
// preferences (Settings -> Writing -> Application answers) and the scoped
// saved answers (UserProfile.applicationAnswers), plus declarations resolved
// for the hiring company.

export async function getApplicationContext(userId: string, company?: string | null) {
  const [profile, projects, prompts, searchPrefs, genericResume] = await Promise.all([
    getProfileOrNull(userId),
    getProjectBank(userId),
    prisma.userPromptSetting.findUnique({ where: { userId }, select: { answers: true, voice: true, updatedAt: true } }),
    getSearchPrefs(userId),
    getGenericResumeInfo(userId),
  ]);
  const scopedAnswers = (profile?.applicationAnswers ?? {}) as Record<string, unknown>;
  const declarationDefaults = readDeclarationDefaults(scopedAnswers);
  const { declarationDefaults: _omit, ...otherScoped } = scopedAnswers;
  void _omit;
  return {
    profile: profile
      ? {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          github: profile.github,
          linkedin: profile.linkedin,
          portfolio: profile.portfolio,
          city: profile.city,
          country: profile.country,
          yearsOfExperience: profile.yearsOfExperience,
          education: profile.education,
          experience: profile.experience,
          extras: profile.extras,
        }
      : null,
    projects,
    answerPreferences: {
      text: prompts?.answers ?? null,
      voice: prompts?.voice ?? null,
      updatedAt: prompts?.updatedAt ?? null,
      note: "Candidate-written preferences (compensation floors, current employment, locations, consents). They override generic assumptions but never authorize inventing facts.",
    },
    scopedAnswers: otherScoped,
    declarations: {
      forCompany: company ?? null,
      resolved: resolveDeclarations({
        defaults: declarationDefaults,
        experienceCompanies: profile?.experience.map((e) => e.company) ?? [],
        company,
      }),
      notCoveredByDefaults: NOT_COVERED_BY_DEFAULTS,
    },
    searchPreferences: searchPrefs,
    genericResume,
    precedence: [
      "Newest explicit instruction from the candidate in this conversation",
      "scopedAnswers and declarations (candidate-confirmed, structured)",
      "answerPreferences.text",
      "profile and projects (facts only; never extrapolate)",
      "Anything else is UNKNOWN: ask the candidate",
    ],
    missing: profile ? [] : ["profile: set it up in Settings -> Profile"],
  };
}
