import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { projectData, type ProjectBody } from "../shared";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const existing = await prisma.project.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = (await req.json()) as ProjectBody;
    const data = projectData(body);
    if (!data.title || !data.oneLiner) {
      return NextResponse.json({ error: "title and one-liner are required" }, { status: 400 });
    }
    const project = await prisma.project.update({ where: { id: existing.id }, data });
    return NextResponse.json({ project });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const existing = await prisma.project.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    await prisma.project.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
