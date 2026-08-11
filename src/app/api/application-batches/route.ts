import { BatchOperation } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";

const ALLOWED_OPERATIONS = new Set(Object.values(BatchOperation));

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const batches = await prisma.applicationBatch.findMany({
      where: { userId: user.id },
      include: { items: { include: { application: { select: { company: true, role: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json({ batches });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const rawApplicationIds: unknown[] = Array.isArray(body.applicationIds) ? body.applicationIds : [];
    const applicationIds: string[] = Array.from(
      new Set<string>(rawApplicationIds.filter((id): id is string => typeof id === "string"))
    ).slice(0, 5);
    const rawOperations: unknown[] = Array.isArray(body.operations) ? body.operations : [];
    const operations: BatchOperation[] = Array.from(
      new Set<BatchOperation>(
        rawOperations.filter((operation): operation is BatchOperation => ALLOWED_OPERATIONS.has(operation as BatchOperation))
      )
    );
    if (!applicationIds.length || !operations.length) {
      return NextResponse.json({ error: "Select 1-5 applications and at least one preparation operation." }, { status: 400 });
    }
    const owned = await prisma.application.findMany({
      where: { id: { in: applicationIds }, userId: user.id },
      select: { id: true },
    });
    if (owned.length !== applicationIds.length) {
      return NextResponse.json({ error: "One or more applications were not found." }, { status: 404 });
    }
    const active = await prisma.applicationBatch.findFirst({
      where: { userId: user.id, status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true },
    });
    if (active) {
      return NextResponse.json({ error: "Finish or cancel the active batch first.", batchId: active.id }, { status: 409 });
    }

    const batch = await prisma.applicationBatch.create({
      data: {
        userId: user.id,
        operations,
        // Sequential by design: recruiter providers have strict concurrency
        // and credit limits, while LLM preparation can be expensive.
        maxConcurrency: 1,
        items: { create: applicationIds.map((applicationId) => ({ applicationId })) },
      },
      include: { items: { include: { application: { select: { company: true, role: true } } } } },
    });
    return NextResponse.json({ batch });
  } catch (error) {
    return apiError(error);
  }
}
