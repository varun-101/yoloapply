import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { detectAtsProvider } from "@/lib/application-agent/preparation";
import { completeApplicationTask, recordApplicationEvent } from "@/lib/application-agent/workflow";

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (body.confirmation !== "user_confirmed_submission") {
      return NextResponse.json({ error: "Explicit submission confirmation is required." }, { status: 400 });
    }

    const application = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        appliedAt: true,
        tasks: { where: { key: "PREPARE_APPLICATION" }, select: { metadata: true }, take: 1 },
        events: { where: { type: "APPLICATION_SUBMITTED" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (application.events[0]) {
      return NextResponse.json({ ok: true, alreadyRecorded: true, submittedAt: application.events[0].createdAt });
    }

    const pageUrl = clean(body.pageUrl, 2000);
    const evidenceInput = jsonRecord(body.evidence);
    const submittedAt = new Date();
    const evidence = {
      pageUrl: pageUrl ?? null,
      pageTitle: clean(evidenceInput.pageTitle, 200) ?? null,
      confirmationText: clean(evidenceInput.confirmationText, 500) ?? null,
      confirmationNumber: clean(evidenceInput.confirmationNumber, 120) ?? null,
      atsProvider: detectAtsProvider(pageUrl),
      recordedAt: submittedAt.toISOString(),
      recordedBy: "candidate",
    };

    const previousMetadata = jsonRecord(application.tasks[0]?.metadata);
    await completeApplicationTask(application.id, "PREPARE_APPLICATION", {
      metadata: { ...previousMetadata, submission: evidence } as Prisma.InputJsonValue,
    });
    await prisma.application.update({
      where: { id: application.id },
      data: { status: "applied", appliedAt: application.appliedAt ?? submittedAt },
    });
    await recordApplicationEvent(
      application.id,
      "APPLICATION_SUBMITTED",
      `Candidate confirmed submission${evidence.confirmationNumber ? ` (${evidence.confirmationNumber})` : ""}.`,
      evidence as Prisma.InputJsonValue
    );

    return NextResponse.json({ ok: true, submittedAt, evidence });
  } catch (error) {
    return apiError(error);
  }
}
