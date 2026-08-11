import { BatchOperation } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  try {
    const user = await requireUser(req);
    const item = await prisma.applicationBatchItem.findFirst({
      where: { id: params.itemId, batchId: params.id, batch: { userId: user.id } },
    });
    if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const status = ["RUNNING", "SUCCESS", "FAILED", "SKIPPED"].includes(body.status) ? body.status : undefined;
    if (!status) return NextResponse.json({ error: "Valid item status required." }, { status: 400 });
    const currentStep = Object.values(BatchOperation).includes(body.currentStep) ? body.currentStep : null;
    const now = new Date();
    const updated = await prisma.applicationBatchItem.update({
      where: { id: item.id },
      data: {
        status,
        currentStep,
        errorMessage: status === "FAILED" && typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 1000) : null,
        ...(status === "RUNNING" ? { startedAt: item.startedAt ?? now, completedAt: null } : { completedAt: now }),
      },
    });
    const items = await prisma.applicationBatchItem.findMany({ where: { batchId: params.id }, select: { status: true } });
    const terminal = items.every((entry) => ["SUCCESS", "FAILED", "SKIPPED"].includes(entry.status));
    const failed = items.some((entry) => entry.status === "FAILED");
    await prisma.applicationBatch.update({
      where: { id: params.id },
      data: terminal
        ? { status: failed ? "PARTIAL_FAILED" : "COMPLETED", completedAt: now, startedAt: item.startedAt ?? now }
        : { status: "RUNNING", startedAt: item.startedAt ?? now },
    });
    return NextResponse.json({ ok: true, item: updated });
  } catch (error) {
    return apiError(error);
  }
}
