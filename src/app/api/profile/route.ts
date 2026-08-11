import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile } from "@/lib/profile";

// Returns the signed-in user's profile, used by the extension's autofill
// engine. Keys mirror the most common job-form field names so the content
// script can match by key directly.
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const profile = await getProfile(user.id);
    const [firstName, ...rest] = profile.name.split(" ");
    const lastName = rest.join(" ");
    return NextResponse.json({
      fullName: profile.name,
      firstName,
      lastName,
      email: profile.email,
      phone: profile.phone,
      github: profile.github,
      githubHandle: profile.githubHandle,
      linkedin: profile.linkedin,
      linkedinHandle: profile.linkedinHandle,
      portfolio: profile.portfolio,
      website: profile.portfolio,
      city: profile.city,
      country: profile.country,
      location: [profile.city, profile.country].filter(Boolean).join(", "),
      yearsOfExperience: profile.yearsOfExperience,
      education: profile.education,
      currentRole: profile.experience[0]?.title ?? "",
      currentCompany: profile.experience[0]?.company ?? "",
      applicationAnswers: profile.applicationAnswers,
    });
  } catch (e) {
    return apiError(e);
  }
}
