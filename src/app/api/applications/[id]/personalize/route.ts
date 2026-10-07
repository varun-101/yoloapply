import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { runResumeGeneration } from "@/lib/application-agent/resumeJob";

export const maxDuration = 300;

// Node runs this handler to completion even if the client navigates away; the
// running state is committed before the long await (see resumeJob.ts), so a
// refreshed page polls and picks up the result.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const result = await runResumeGeneration(user.id, params.id);
    if (result.alreadyRunning) {
      return NextResponse.json({ ok: true, status: "running", alreadyRunning: true });
    }
    return NextResponse.json({ ok: true, application: result.application });
  } catch (e) {
    return apiError(e);
  }
}
