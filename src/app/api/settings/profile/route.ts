import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

// The signed-in user's candidate profile (identity + education/experience/
// extras), the data every prompt and LaTeX template draws from.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    return NextResponse.json({ profile });
  } catch (e) {
    return apiError(e);
  }
}

interface ProfileBody {
  name?: string;
  email?: string;
  phone?: string;
  github?: string;
  githubHandle?: string;
  linkedin?: string;
  linkedinHandle?: string;
  portfolio?: string;
  city?: string;
  country?: string;
  yearsOfExperience?: string;
  education?: { degree?: string; school?: string; cgpa?: string; grad?: string } | null;
  experience?: unknown[];
  extras?: unknown[];
  applicationAnswers?: {
    workAuthorization?: string;
    sponsorship?: string;
    noticePeriod?: string;
    willingToRelocate?: string;
    currentLocation?: string;
  };
  followUpDelayDays?: number;
  recruiterLocation?: string;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as ProfileBody;
    const name = body.name?.trim();
    const email = body.email?.trim();
    if (!name || !email) {
      return NextResponse.json({ error: "name and contact email are required" }, { status: 400 });
    }

    const str = (v: string | undefined) => v?.trim() || null;
    const data = {
      name,
      email,
      phone: str(body.phone),
      github: str(body.github),
      githubHandle: str(body.githubHandle),
      linkedin: str(body.linkedin),
      linkedinHandle: str(body.linkedinHandle),
      portfolio: str(body.portfolio),
      city: str(body.city),
      country: str(body.country),
      yearsOfExperience: str(body.yearsOfExperience),
      education:
        body.education && (body.education.degree || body.education.school)
          ? body.education
          : undefined,
      experience: (Array.isArray(body.experience)
        ? body.experience
        : []) as Prisma.InputJsonValue,
      extras: (Array.isArray(body.extras) ? body.extras : []) as Prisma.InputJsonValue,
      applicationAnswers: {
        workAuthorization: body.applicationAnswers?.workAuthorization?.trim() || undefined,
        sponsorship: body.applicationAnswers?.sponsorship?.trim() || undefined,
        noticePeriod: body.applicationAnswers?.noticePeriod?.trim() || undefined,
        willingToRelocate: body.applicationAnswers?.willingToRelocate?.trim() || undefined,
        currentLocation: body.applicationAnswers?.currentLocation?.trim() || undefined,
      } as Prisma.InputJsonValue,
      followUpDelayDays: Math.min(30, Math.max(1, Math.round(Number(body.followUpDelayDays) || 5))),
      recruiterLocation: str(body.recruiterLocation),
    };

    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data, education: data.education ?? undefined },
      update: { ...data, education: data.education ?? Prisma.DbNull },
    });
    return NextResponse.json({ profile });
  } catch (e) {
    return apiError(e);
  }
}
