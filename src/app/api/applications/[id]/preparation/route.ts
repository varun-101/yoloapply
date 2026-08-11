import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { normalizePreparationReport } from "@/lib/application-agent/preparation";
import {
  completeApplicationTask,
  markApplicationTaskNeedsReview,
  recordApplicationEvent,
  startApplicationTask,
} from "@/lib/application-agent/workflow";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const application = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: {
        id: true,
        tasks: { where: { key: "PREPARE_APPLICATION" }, select: { metadata: true }, take: 1 },
      },
    });
    if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const report = normalizePreparationReport(body, application.tasks[0]?.metadata);
    await startApplicationTask(application.id, "PREPARE_APPLICATION");

    if (report.reviewCount > 0) {
      await markApplicationTaskNeedsReview(
        application.id,
        "PREPARE_APPLICATION",
        `${report.reviewCount} form field${report.reviewCount === 1 ? "" : "s"} need candidate review.`,
        { metadata: report as unknown as Prisma.InputJsonValue }
      );
    } else {
      await completeApplicationTask(application.id, "PREPARE_APPLICATION", {
        metadata: report as unknown as Prisma.InputJsonValue,
      });
    }

    await recordApplicationEvent(
      application.id,
      "APPLICATION_PREPARATION_RECORDED",
      `${report.filledCount} fields filled, ${report.reviewCount} need review, ${report.skippedCount} skipped.`,
      {
        atsProvider: report.atsProvider,
        pageUrl: report.pageUrl ?? null,
        resumeAttached: report.resumeAttached,
        coverLetterAttached: report.coverLetterAttached,
      }
    );

    return NextResponse.json({
      ok: true,
      status: report.reviewCount > 0 ? "NEEDS_REVIEW" : "SUCCESS",
      report,
    });
  } catch (error) {
    return apiError(error);
  }
}
