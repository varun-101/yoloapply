import { prisma } from "./db";

// Drives the dashboard "Finish setup" checklist: which pieces a user still
// needs before each feature works (resume generation needs a profile, scans
// need locations, scoring/personalization needs a DeepSeek key, …).

export interface SetupStatus {
  profile: boolean;
  projects: boolean;
  search: boolean; // at least one location keyword saved
  llmKey: boolean;
  smtp: boolean;
  genericResume: boolean;
  complete: boolean;
}

export async function getSetupStatus(userId: string): Promise<SetupStatus> {
  const [profile, projectCount, prefs, cred, genericResume] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: { name: true, email: true } }),
    prisma.project.count({ where: { userId } }),
    prisma.searchPreference.findUnique({
      where: { userId },
      select: { locationKeywords: true },
    }),
    prisma.userCredential.findUnique({
      where: { userId },
      select: { deepseekKeyEnc: true, smtpHost: true, smtpUser: true, smtpPassEnc: true },
    }),
    prisma.storedFile.findFirst({
      where: { userId, applicationId: null, kind: "generic_resume" },
      select: { id: true },
    }),
  ]);

  const status = {
    profile: !!profile?.name && !!profile.email,
    projects: projectCount > 0,
    search: (prefs?.locationKeywords.length ?? 0) > 0,
    llmKey: !!cred?.deepseekKeyEnc,
    smtp: !!cred?.smtpHost && !!cred.smtpUser && !!cred.smtpPassEnc,
    genericResume: !!genericResume,
  };
  return { ...status, complete: Object.values(status).every(Boolean) };
}
