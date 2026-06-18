import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { createSession } from "@/lib/interview/session";
import { InterviewMode, Persona, RoundType } from "@/lib/interview/types";

export const maxDuration = 120;

const PERSONAS: Persona[] = ["neutral", "friendly", "stress"];
const ROUNDS: RoundType[] = ["behavioral", "technical", "mixed"];

// POST /api/interview — start a new mock interview.
// body: { applicationId?: string, persona?, roundType? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const applicationId: string | null =
      typeof body.applicationId === "string" && body.applicationId ? body.applicationId : null;
    const mode: InterviewMode = applicationId ? "company" : "general";
    const persona: Persona = PERSONAS.includes(body.persona) ? body.persona : "neutral";
    const roundType: RoundType = ROUNDS.includes(body.roundType) ? body.roundType : "mixed";

    // Optional target length. Clamp to a sane range; anything else = untimed.
    const rawLimit = Number(body.timeLimitMin);
    const timeLimitMin =
      Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(60, Math.round(rawLimit)) : null;

    const session = await createSession(user.id, {
      mode,
      applicationId,
      persona,
      roundType,
      timeLimitMin,
    });
    return NextResponse.json({ ok: true, session });
  } catch (e) {
    return apiError(e);
  }
}
