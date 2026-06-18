import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { submitAnswer, AlreadyAdvancing, getPublicSession } from "@/lib/interview/session";

export const maxDuration = 120;

// POST /api/interview/[id]/answer — submit the candidate's spoken/typed answer.
// The backend grades it (hidden) and produces the interviewer's next line.
// A second call while one is in flight returns { status: "already_running" }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if (!answer) {
      return NextResponse.json({ error: "Empty answer." }, { status: 400 });
    }

    try {
      const session = await submitAnswer(user.id, params.id, answer);
      return NextResponse.json({ ok: true, session });
    } catch (e) {
      if (e instanceof AlreadyAdvancing) {
        const session = await getPublicSession(user.id, params.id);
        return NextResponse.json({ ok: true, status: "already_running", session }, { status: 202 });
      }
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}
