import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { deleteSavedAnswer, readSavedAnswers } from "@/lib/mcp/savedAnswers";

// Answers agents saved from the candidate's own words (save_candidate_answer).
// Listed in Settings -> Profile so the candidate can see what is reused, and
// removable only here: the MCP never deletes.

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { applicationAnswers: true } });
    const saved = readSavedAnswers(profile?.applicationAnswers);
    const answers = Object.entries(saved)
      .map(([key, a]) => ({ key, ...a }))
      .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
    return NextResponse.json({ answers });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const key = req.nextUrl.searchParams.get("key") ?? "";
    return NextResponse.json(await deleteSavedAnswer(user.id, key));
  } catch (e) {
    return apiError(e);
  }
}
