import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { personalizeOnePage } from "@/lib/onePage";
import { saveResumeArtifacts } from "@/lib/compile";

export async function GET() {
  const apps = await prisma.application.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(apps);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { company, role, source, jdUrl, jdText, applyUrl, location, notes, personalize } = body ?? {};

  if (!company || !role) {
    return NextResponse.json({ error: "company and role are required" }, { status: 400 });
  }

  const app = await prisma.application.create({
    data: {
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
      const result = await personalizeOnePage({ company, role, jobDescription: jdText });
      const { texPath, pdfPath } = await saveResumeArtifacts(app.id, result.tex, result.pdf);
      await prisma.application.update({
        where: { id: app.id },
        data: { status: "personalized", resumeTexPath: texPath, resumePdfPath: pdfPath },
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
}
