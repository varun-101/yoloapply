import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({
    where: { id: params.id },
    include: { events: { orderBy: { createdAt: "desc" } }, contacts: true, emails: true },
  });
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(app);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const allowed = ["status", "notes", "applyUrl", "jdUrl", "jdText", "company", "role", "location"];
  const data: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) data[k] = body[k];

  if (data.status === "applied" && !("appliedAt" in body)) data.appliedAt = new Date();

  const app = await prisma.application.update({ where: { id: params.id }, data });
  if ("status" in data) {
    await prisma.event.create({
      data: { applicationId: app.id, type: "status_change", detail: String(data.status) },
    });
  }
  return NextResponse.json(app);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.application.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
