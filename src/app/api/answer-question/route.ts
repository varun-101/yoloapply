import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/answerQuestion";
import { requireUser, apiError } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { question, jobDescription, company, role, applicationId, maxChars } = body ?? {};
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "question required" }, { status: 400 });
    }

    // If applicationId was provided, hydrate JD/company/role from the DB.
    let jd = jobDescription;
    let co = company;
    let ro = role;
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
      });
      if (app) {
        jd = jd ?? app.jdText ?? undefined;
        co = co ?? app.company;
        ro = ro ?? app.role;
      }
    }

    const ans = await answerQuestion(user.id, {
      question,
      jobDescription: jd,
      company: co,
      role: ro,
      maxChars: typeof maxChars === "number" ? maxChars : undefined,
    });
    return NextResponse.json(ans);
  } catch (e) {
    return apiError(e);
  }
}
