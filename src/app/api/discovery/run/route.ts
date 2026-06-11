import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startDiscovery, getDiscoveryProgress } from "@/lib/discovery/pipeline";
import { SCAN_STALE_MS } from "@/lib/discovery/types";

export const maxDuration = 300;

// Kick off a scan and return immediately — the run is not tied to this
// response; the frontend polls GET below for progress and the result.
export async function POST() {
  const { alreadyRunning, progress } = startDiscovery();
  return NextResponse.json({
    status: alreadyRunning ? "already_running" : "started",
    progress,
  });
}

export async function GET() {
  // In-process run (dashboard-triggered) — live progress available.
  const progress = getDiscoveryProgress();
  if (progress) return NextResponse.json({ status: "running", progress });

  // A run kicked off by another process (the scheduled script) is only
  // visible through its open ScanRun row. Open rows older than the stale
  // cutoff belong to a process that died mid-run — not running.
  const open = await prisma.scanRun.findFirst({
    where: { finishedAt: null, startedAt: { gt: new Date(Date.now() - SCAN_STALE_MS) } },
    orderBy: { startedAt: "desc" },
  });
  if (open) {
    return NextResponse.json({
      status: "running",
      progress: {
        scanRunId: open.id,
        startedAt: open.startedAt.toISOString(),
        trigger: open.trigger,
        phase: open.trigger === "script" ? "running (scheduled scan)" : "running",
        sourcesDone: 0,
        sourcesTotal: 4,
        created: open.created,
      },
    });
  }

  const lastRun = await prisma.scanRun.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { id: true, created: true, scored: true, sourceStats: true, error: true, finishedAt: true },
  });
  return NextResponse.json({ status: "idle", lastRun });
}
