import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { personalizeOnePage } from "@/lib/onePage";
import { saveResumeArtifacts } from "@/lib/compile";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!app.jdText || app.jdText.trim().length < 50) {
    return NextResponse.json(
      { error: "Add a job description (at least a paragraph) before personalizing." },
      { status: 400 }
    );
  }

  try {
    const result = await personalizeOnePage({
      company: app.company,
      role: app.role,
      jobDescription: app.jdText,
    });
    const { texPath, pdfPath } = await saveResumeArtifacts(app.id, result.tex, result.pdf);
    const updated = await prisma.application.update({
      where: { id: app.id },
      data: { status: "personalized", resumeTexPath: texPath, resumePdfPath: pdfPath },
    });
    const detail = result.clippedFromMultiPage
      ? `Re-personalized at tightness ${result.tightness} — overflowed to ${result.pages} pages, clipped to first page.`
      : `Re-personalized at tightness ${result.tightness} (${result.attempts} pass${result.attempts === 1 ? "" : "es"}, fits one page).`;
    await prisma.event.create({
      data: { applicationId: app.id, type: "personalized", detail },
    });
    return NextResponse.json({ ok: true, application: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.event.create({
      data: { applicationId: app.id, type: "note", detail: "Personalization failed: " + msg.slice(0, 500) },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
