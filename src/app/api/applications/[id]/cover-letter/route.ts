import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateCoverLetter, coverLetterToText } from "@/lib/coverLetter";
import { buildCoverLetterLatex } from "@/lib/coverLetterLatex";
import { compileLatex, saveCoverLetterPdf } from "@/lib/compile";
import { requireUser, apiError } from "@/lib/auth";
import { getProfile, resumeFilename } from "@/lib/profile";
import { getFile } from "@/lib/files";

export const runtime = "nodejs";
export const maxDuration = 120;

// Generate (or regenerate) a tailored cover letter for this application.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

    try {
      const profile = await getProfile(user.id);
      const draft = await generateCoverLetter(user.id, {
        company: app.company,
        role: app.role,
        jobDescription: app.jdText ?? undefined,
      });
      const text = coverLetterToText(profile, draft);
      const tex = buildCoverLetterLatex(profile, draft, { company: app.company, role: app.role });
      const pdf = await compileLatex(tex);
      await saveCoverLetterPdf(
        user.id,
        app.id,
        pdf,
        resumeFilename(profile, "CoverLetter", app.company)
      );

      const updated = await prisma.application.update({
        where: { id: app.id },
        data: { coverLetterText: text },
      });
      await prisma.event.create({
        data: { applicationId: app.id, type: "note", detail: "Cover letter generated." },
      });
      return NextResponse.json({ ok: true, text, application: { id: updated.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.event.create({
        data: { applicationId: app.id, type: "note", detail: "Cover letter generation failed: " + msg.slice(0, 400) },
      });
      return apiError(e);
    }
  } catch (e) {
    return apiError(e);
  }
}

// Serve the cover letter as PDF or plain text.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "pdf";

    if (format === "txt") {
      if (!app.coverLetterText) return NextResponse.json({ error: "no cover letter yet" }, { status: 404 });
      return new NextResponse(app.coverLetterText, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const file = await getFile(user.id, app.id, "cover_letter_pdf");
    if (!file) return NextResponse.json({ error: "no cover letter pdf yet" }, { status: 404 });
    const inline = url.searchParams.get("download") !== "1";
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.meta.filename}"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
