import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const batch = await prisma.applicationBatch.findFirst({
      where: { id: params.id, userId: user.id },
      include: { items: { include: { application: { select: { company: true, role: true } } }, orderBy: { createdAt: "asc" } } },
    });
    if (!batch) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ batch });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const batch = await prisma.applicationBatch.findFirst({ where: { id: params.id, userId: user.id } });
    if (!batch) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    if (body.action !== "cancel") return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    const now = new Date();
    await prisma.$transaction([
      prisma.applicationBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED", completedAt: now } }),
      prisma.applicationBatchItem.updateMany({
        where: { batchId: batch.id, status: "PENDING" },
        data: { status: "SKIPPED", completedAt: now, errorMessage: "Batch cancelled by candidate." },
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
