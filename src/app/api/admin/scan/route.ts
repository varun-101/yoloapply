import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, apiError } from "@/lib/auth";
import { runFullTick } from "@/lib/discovery/pipeline";

export const maxDuration = 300;

// Admin "Scan everybody": refresh the shared catalog and fan-out scoring to all
// discovery-enabled users. Fire-and-forget — the global fetch + per-user
// ScanRuns are persisted; the admin page polls the discovery status endpoints.
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    // Include the admin as a participant so the catalog refreshes even when no
    // user has scheduled discovery enabled.
    runFullTick("script", [admin.id]).catch(() => {});
    return NextResponse.json({ status: "started" });
  } catch (e) {
    return apiError(e);
  }
}
