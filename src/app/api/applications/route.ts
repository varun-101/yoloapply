import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { personalizeOnePage } from "@/lib/onePage";
import { saveResumeArtifacts } from "@/lib/compile";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile, resumeFilename } from "@/lib/profile";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const apps = await prisma.application.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(apps);
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const { company, role, source, jdUrl, jdText, applyUrl, location, notes, personalize } = body ?? {};

    if (!company || !role) {
      return NextResponse.json({ error: "company and role are required" }, { status: 400 });
    }

    const app = await prisma.application.create({
      data: {
        userId: user.id,
        company,
        role,
        source: source ?? "portal",
        jdUrl: jdUrl || null,
        jdText: jdText || null,
        applyUrl: applyUrl || null,
        location: location || null,
        notes: notes || null,
        status: "draft",
      },
    });

    await prisma.event.create({
      data: { applicationId: app.id, type: "status_change", detail: "draft" },
    });

    if (personalize && jdText && jdText.trim().length > 50) {
      try {
        const result = await personalizeOnePage(user.id, { company, role, jobDescription: jdText });
        const profile = await getProfile(user.id);
        await saveResumeArtifacts(
          user.id,
          app.id,
          result.tex,
          result.pdf,
          resumeFilename(profile, "Resume", company)
        );
        await prisma.application.update({
          where: { id: app.id },
          data: { status: "personalized" },
        });
        const detail = result.clippedFromMultiPage
          ? `Personalized at tightness ${result.tightness} — overflowed to ${result.pages} pages, clipped to first page.`
          : `Personalized at tightness ${result.tightness} (${result.attempts} pass${result.attempts === 1 ? "" : "es"}, fits one page).`;
        await prisma.event.create({
          data: { applicationId: app.id, type: "personalized", detail },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await prisma.event.create({
          data: { applicationId: app.id, type: "note", detail: "Personalization failed: " + msg.slice(0, 500) },
        });
      }
    }

    return NextResponse.json({ id: app.id });
  } catch (e) {
    return apiError(e);
  }
}
