import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { getPublicSession } from "@/lib/interview/session";

// GET /api/interview/[id] — full session + turns, for poll/reconnect/restore.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const session = await getPublicSession(user.id, params.id);
    return NextResponse.json({ ok: true, session });
  } catch (e) {
    return apiError(e);
  }
}
