import { prisma } from "./db";
import { ApiUserError } from "./auth";

// Per-user candidate profile, loaded from the UserProfile table. The shape
// mirrors the old hardcoded `owner` module so prompt/LaTeX call sites read
// the same.

export interface EducationInfo {
  degree: string;
  school: string;
  cgpa?: string;
  grad?: string;
}

export interface ExperienceEntry {
  title: string;
  company: string;
  period: string;
  location?: string;
  bullets: string[];
}

export interface ExtraEntry {
  title: string;
  org: string;
  period?: string;
  summary?: string;
}

export interface CandidateProfile {
  userId: string;
  name: string;
  email: string;
  phone: string;
  github: string;
  githubHandle: string;
  linkedin: string;
  linkedinHandle: string;
  portfolio: string;
  city: string;
  country: string;
  yearsOfExperience: string;
  education: EducationInfo | null;
  experience: ExperienceEntry[];
  extras: ExtraEntry[];
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function getProfileOrNull(userId: string): Promise<CandidateProfile | null> {
  const row = await prisma.userProfile.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    userId,
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    github: row.github ?? "",
    githubHandle: row.githubHandle ?? "",
    linkedin: row.linkedin ?? "",
    linkedinHandle: row.linkedinHandle ?? "",
    portfolio: row.portfolio ?? "",
    city: row.city ?? "",
    country: row.country ?? "",
    yearsOfExperience: row.yearsOfExperience ?? "",
    education: (row.education as EducationInfo | null) ?? null,
    experience: asArray<ExperienceEntry>(row.experience),
    extras: asArray<ExtraEntry>(row.extras),
  };
}

// For features that can't work without a profile (resume generation, cold
// email, autofill). Maps to HTTP 400 { code: "no_profile" } via apiError().
export async function getProfile(userId: string): Promise<CandidateProfile> {
  const profile = await getProfileOrNull(userId);
  if (!profile) {
    throw new ApiUserError(
      "Set up your profile first (Settings → Profile).",
      400,
      "no_profile"
    );
  }
  return profile;
}

export function profileComplete(profile: CandidateProfile | null): boolean {
  return !!profile && !!profile.name && !!profile.email;
}

// "Varun Chandwani" → "Varun_Chandwani_Resume.pdf" (suffix/company sanitized
// the same way). Replaces the old hardcoded Varun_Chandwani_* filenames.
export function resumeFilename(
  profile: { name: string },
  suffix = "Resume",
  company?: string
): string {
  const clean = (s: string) => s.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_");
  const parts = [clean(profile.name), clean(suffix)];
  if (company) parts.push(clean(company));
  return parts.filter(Boolean).join("_") + ".pdf";
}
