import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateCoverLetter, coverLetterToText } from "@/lib/coverLetter";
import { buildCoverLetterLatex } from "@/lib/coverLetterLatex";
import { compileLatex, saveCoverLetterPdf } from "@/lib/compile";
import { readFile } from "fs/promises";

export const runtime = "nodejs";
export const maxDuration = 120;

// Generate (or regenerate) a tailored cover letter for this application.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const draft = await generateCoverLetter({
      company: app.company,
      role: app.role,
      jobDescription: app.jdText ?? undefined,
    });
    const text = coverLetterToText(draft);
    const tex = buildCoverLetterLatex(draft, { company: app.company, role: app.role });
    const pdf = await compileLatex(tex);
    const { pdfPath } = await saveCoverLetterPdf(app.id, pdf);

    const updated = await prisma.application.update({
      where: { id: app.id },
      data: { coverLetterText: text, coverLetterPdfPath: pdfPath },
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Serve the cover letter as PDF or plain text.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "pdf";

  if (format === "txt") {
    if (!app.coverLetterText) return NextResponse.json({ error: "no cover letter yet" }, { status: 404 });
    return new NextResponse(app.coverLetterText, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!app.coverLetterPdfPath) return NextResponse.json({ error: "no cover letter pdf yet" }, { status: 404 });
  const buf = await readFile(app.coverLetterPdfPath);
  const inline = url.searchParams.get("download") !== "1";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="Varun_Chandwani_CoverLetter_${app.company}.pdf"`,
    },
  });
}
