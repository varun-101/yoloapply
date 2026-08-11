import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { analyzeApplicationMatch } from "@/lib/application-agent/match";
import {
  completeApplicationTask,
  failApplicationTask,
  startApplicationTask,
} from "@/lib/application-agent/workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let applicationId: string | null = null;
  try {
    const user = await requireUser(req);
    const application = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true },
    });
    if (!application) return NextResponse.json({ error: "not found" }, { status: 404 });
    applicationId = application.id;

    const started = await startApplicationTask(application.id, "ANALYZE_MATCH");
    if (started.alreadyRunning) {
      return NextResponse.json({ ok: true, status: "running", alreadyRunning: true });
    }

    const analysis = await analyzeApplicationMatch(user.id, application.id);
    await completeApplicationTask(application.id, "ANALYZE_MATCH", {
      metadata: {
        score: analysis.score,
        category: analysis.category,
        recommendation: analysis.recommendation,
      },
    });
    return NextResponse.json({ ok: true, analysis });
  } catch (error) {
    if (applicationId) await failApplicationTask(applicationId, "ANALYZE_MATCH", error).catch(() => {});
    return apiError(error);
  }
}
