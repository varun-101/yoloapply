import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftColdEmail } from "@/lib/coldEmail";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { company, recipientName, recipientTitle, role, hookContext, applicationId } = body ?? {};
  if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

  // When drafting for a tracked application, feed the listing into the prompt
  // so the email references the exact role, mirrors the JD, and links the posting.
  let jobContext;
  let roleFromApp: string | undefined;
  if (applicationId) {
    const app = await prisma.application.findUnique({ where: { id: applicationId } });
    if (app) {
      roleFromApp = app.role;
      jobContext = {
        applyUrl: app.applyUrl ?? app.jdUrl ?? undefined,
        location: app.location ?? undefined,
        jdExcerpt: app.jdText?.slice(0, 1500),
        alreadyApplied: !!app.appliedAt || app.status === "applied",
      };
    }
  }

  try {
    const draft = await draftColdEmail({
      company,
      recipientName,
      recipientTitle,
      role: role || roleFromApp,
      hookContext,
      jobContext,
    });
    return NextResponse.json(draft);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
