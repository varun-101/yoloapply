import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser, apiError } from "@/lib/auth";
import { createShareToken, DEFAULT_SHARE_DAYS, MAX_SHARE_DAYS } from "@/lib/shareLink";
import { rateLimit, tooManyResponse } from "@/lib/rateLimit";

// Mint a public share link for this application's resume + cover letter.
// The link is stateless (src/lib/shareLink.ts): nothing is stored, minting
// again just issues another token, and old tokens live until they expire.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const rl = rateLimit("share-create", user.id, 20, 60_000);
    if (!rl.ok) return tooManyResponse(rl);

    const app = await prisma.application.findFirst({
      where: { id: params.id, userId: user.id },
      select: { id: true, coverLetterText: true, files: { select: { kind: true } } },
    });
    if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });

    const kinds = new Set(app.files.map((f) => f.kind));
    if (!kinds.has("resume_pdf") && !kinds.has("cover_letter_pdf") && !app.coverLetterText) {
      return NextResponse.json(
        { error: "nothing to share yet — personalize a resume or generate a cover letter first" },
        { status: 400 }
      );
    }

    let expiresDays = DEFAULT_SHARE_DAYS;
    try {
      const body = await req.json();
      if (typeof body?.expiresDays === "number") expiresDays = body.expiresDays;
    } catch {
      // no/invalid JSON body → default expiry
    }

    const { token, expiresAt } = createShareToken(user.id, app.id, expiresDays);
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const url = `${origin}/share/${token}`;

    await prisma.event.create({
      data: {
        applicationId: app.id,
        type: "note",
        detail: `Public share link created (expires ${expiresAt.toISOString().slice(0, 10)}).`,
      },
    });
    return NextResponse.json({
      url,
      expiresAt: expiresAt.toISOString(),
      maxDays: MAX_SHARE_DAYS,
    });
  } catch (e) {
    return apiError(e);
  }
}
