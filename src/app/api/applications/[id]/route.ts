import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { cancelPendingFollowUpsForApplication } from "@/lib/application-agent/follow-up";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        events: { orderBy: { createdAt: "desc" } },
        contacts: true,
        emails: true,
        tasks: true,
        analysis: true,
        files: { select: { id: true, kind: true, filename: true, size: true, updatedAt: true } },
      },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Legacy-shaped convenience flags for the UI (paths used to live on the row).
    const kinds = new Set(app.files.map((f) => f.kind));
    return NextResponse.json({
      ...app,
      hasResumePdf: kinds.has("resume_pdf"),
      hasResumeTex: kinds.has("resume_tex"),
      hasCoverLetterPdf: kinds.has("cover_letter_pdf"),
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const existing = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json();
    const allowed = ["status", "notes", "applyUrl", "jdUrl", "jdText", "company", "role", "location"];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) data[k] = body[k];

    if (data.status === "applied" && !("appliedAt" in body)) data.appliedAt = new Date();

    const app = await prisma.application.update({ where: { id: existing.id }, data });
    if ("status" in data) {
      await prisma.event.create({
        data: { applicationId: app.id, type: "status_change", detail: String(data.status) },
      });
      if (["replied", "interview", "offer", "rejected", "closed"].includes(String(data.status))) {
        await cancelPendingFollowUpsForApplication(app.id, `Application status changed to ${String(data.status)}.`);
      }
    }
    return NextResponse.json(app);
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const existing = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.application.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
