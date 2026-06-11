import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftColdEmail } from "@/lib/coldEmail";
import { owner } from "@/lib/owner";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { company, recipientName, recipientTitle, recipientEmail, role, hookContext, applicationId, emailId } =
    body ?? {};
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

    // Persist the draft immediately so it survives even if it is never sent.
    // Regenerating with the same emailId overwrites the previous draft row.
    const data = {
      toAddress: recipientEmail ?? "",
      toName: recipientName || null,
      fromAddress: process.env.SMTP_USER ?? owner.email,
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      applicationId: applicationId || null,
      recipientTitle: recipientTitle || null,
      recipientCompany: company,
      roleTarget: role || roleFromApp || null,
      hookContext: hookContext || null,
      rationale: draft.rationale ?? null,
    };
    let saved;
    if (emailId) {
      const existing = await prisma.email.findUnique({ where: { id: emailId } });
      saved =
        existing && existing.status === "draft"
          ? await prisma.email.update({ where: { id: emailId }, data })
          : await prisma.email.create({ data });
    } else {
      saved = await prisma.email.create({ data });
    }

    return NextResponse.json({ ...draft, emailId: saved.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
