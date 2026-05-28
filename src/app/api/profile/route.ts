import { NextResponse } from "next/server";
import { owner } from "@/lib/owner";

// Returns the candidate's profile used by the extension's autofill engine.
// Keys mirror the most common job-form field names so the content script can
// match by key directly.
export async function GET() {
  const [firstName, ...rest] = owner.name.split(" ");
  const lastName = rest.join(" ");
  return NextResponse.json({
    fullName: owner.name,
    firstName,
    lastName,
    email: owner.email,
    phone: owner.phone,
    github: owner.github,
    githubHandle: owner.githubHandle,
    linkedin: owner.linkedin,
    linkedinHandle: owner.linkedinHandle,
    portfolio: owner.portfolio,
    website: owner.portfolio,
    city: owner.city,
    country: owner.country,
    location: `${owner.city}, ${owner.country}`,
    yearsOfExperience: owner.yearsOfExperience,
    education: owner.education,
    currentRole: owner.experience[0]?.title ?? "",
    currentCompany: owner.experience[0]?.company ?? "",
  });
}
