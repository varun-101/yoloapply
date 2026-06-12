import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { startUserScan, getUserScanProgress } from "@/lib/discovery/pipeline";
import { SCAN_STALE_MS } from "@/lib/discovery/types";

export const maxDuration = 300;

// Kick off a scan for the signed-in user and return immediately — the run is
// not tied to this response; the frontend polls GET below for progress and
// the result.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { alreadyRunning, progress } = startUserScan(user.id);
    return NextResponse.json({
      status: alreadyRunning ? "already_running" : "started",
      progress,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);

    // In-process run — live progress available.
    const progress = getUserScanProgress(user.id);
    if (progress) return NextResponse.json({ status: "running", progress });

    // A run kicked off by another process (the cron tick or the script) is
    // only visible through its open ScanRun row. Open rows older than the
    // stale cutoff belong to a process that died mid-run — not running.
    const open = await prisma.scanRun.findFirst({
      where: {
        userId: user.id,
        finishedAt: null,
        startedAt: { gt: new Date(Date.now() - SCAN_STALE_MS) },
      },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      return NextResponse.json({
        status: "running",
        progress: {
          scanRunId: open.id,
          startedAt: open.startedAt.toISOString(),
          trigger: open.trigger,
          phase: open.trigger === "manual" ? "running" : "running (scheduled scan)",
          sourcesDone: 0,
          sourcesTotal: 4,
          created: open.created,
        },
      });
    }

    const lastRun = await prisma.scanRun.findFirst({
      where: { userId: user.id, finishedAt: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { id: true, created: true, scored: true, sourceStats: true, error: true, finishedAt: true },
    });
    return NextResponse.json({ status: "idle", lastRun });
  } catch (e) {
    return apiError(e);
  }
}
