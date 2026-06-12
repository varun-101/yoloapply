import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError, ApiUserError } from "@/lib/auth";
import { getLlmConfig } from "@/lib/credentials";
import { getProfileOrNull } from "@/lib/profile";
import { ensureSearchPrefs } from "@/lib/searchPrefs";
import { startUserScoring, getUserScoringProgress } from "@/lib/discovery/pipeline";
import { SCAN_STALE_MS } from "@/lib/discovery/types";

export const maxDuration = 300;

// Fit-score the shared catalog for the signed-in user with THEIR DeepSeek key.
// Available to every user (not just scanners). Body: { maxPerScan?, recencyDays? }
// — persisted to the user's SearchPreference so scans/cron reuse them.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    // Surface the right Settings hint before kicking off a background task.
    await getLlmConfig(user.id); // throws no_llm_key
    if (!(await getProfileOrNull(user.id))) {
      throw new ApiUserError("Add your profile first (Settings → Profile).", 400, "no_profile");
    }

    const body = await req.json().catch(() => ({}));
    const maxPerScan =
      body?.maxPerScan != null ? Math.max(1, Math.min(200, Math.round(Number(body.maxPerScan)))) : undefined;
    const recencyDays =
      body?.recencyDays != null ? Math.max(1, Math.min(90, Math.round(Number(body.recencyDays)))) : undefined;

    // Persist the controls so future scans/cron reuse them.
    if (maxPerScan !== undefined || recencyDays !== undefined) {
      await ensureSearchPrefs(user.id);
      await prisma.searchPreference.update({
        where: { userId: user.id },
        data: {
          ...(maxPerScan !== undefined ? { scoreMaxPerScan: maxPerScan } : {}),
          ...(recencyDays !== undefined ? { scoreRecencyDays: recencyDays } : {}),
        },
      });
    }

    const { alreadyRunning, progress } = startUserScoring(user.id, { maxPerScan, recencyDays });
    return NextResponse.json({ status: alreadyRunning ? "already_running" : "started", progress });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);

    const progress = getUserScoringProgress(user.id);
    if (progress) return NextResponse.json({ status: "running", progress });

    // A score-only run kicked off elsewhere is visible through its open ScanRun.
    const open = await prisma.scanRun.findFirst({
      where: {
        userId: user.id,
        finishedAt: null,
        startedAt: { gt: new Date(Date.now() - SCAN_STALE_MS) },
        trigger: "score",
      },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      return NextResponse.json({
        status: "running",
        progress: { scanRunId: open.id, startedAt: open.startedAt.toISOString(), phase: "scoring", scored: open.scored },
      });
    }

    const lastRun = await prisma.scanRun.findFirst({
      where: { userId: user.id, finishedAt: { not: null }, trigger: "score" },
      orderBy: { startedAt: "desc" },
      select: { id: true, scored: true, error: true, finishedAt: true },
    });
    return NextResponse.json({ status: "idle", lastRun });
  } catch (e) {
    return apiError(e);
  }
}
