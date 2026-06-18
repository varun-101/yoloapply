import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { finishSession } from "@/lib/interview/session";

export const maxDuration = 120;

// POST /api/interview/[id]/finish — end the interview now and build the report.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const session = await finishSession(user.id, params.id);
    return NextResponse.json({ ok: true, session });
  } catch (e) {
    return apiError(e);
  }
}
