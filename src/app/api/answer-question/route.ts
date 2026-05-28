import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { answerQuestion } from "@/lib/answerQuestion";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
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
    const app = await prisma.application.findUnique({ where: { id: applicationId } });
    if (app) {
      jd = jd ?? app.jdText ?? undefined;
      co = co ?? app.company;
      ro = ro ?? app.role;
    }
  }

  try {
    const ans = await answerQuestion({
      question,
      jobDescription: jd,
      company: co,
      role: ro,
      maxChars: typeof maxChars === "number" ? maxChars : undefined,
    });
    return NextResponse.json(ans);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
