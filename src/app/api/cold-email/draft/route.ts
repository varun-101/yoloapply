import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftColdEmail } from "@/lib/coldEmail";
import { requireUser, apiError } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const { company, recipientName, recipientTitle, recipientEmail, role, hookContext, applicationId, emailId } =
      body ?? {};
    if (!company) return NextResponse.json({ error: "company required" }, { status: 400 });

    // When drafting for a tracked application, feed the listing into the prompt
    // so the email references the exact role, mirrors the JD, and links the posting.
    let jobContext;
    let roleFromApp: string | undefined;
    let ownedApplicationId: string | null = null;
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
      });
      if (app) {
        ownedApplicationId = app.id;
        roleFromApp = app.role;
        jobContext = {
          applyUrl: app.applyUrl ?? app.jdUrl ?? undefined,
          location: app.location ?? undefined,
          jdExcerpt: app.jdText?.slice(0, 1500),
          alreadyApplied: !!app.appliedAt || app.status === "applied",
        };
      }
    }

    const draft = await draftColdEmail(user.id, {
      company,
      recipientName,
      recipientTitle,
      role: role || roleFromApp,
      hookContext,
      jobContext,
    });

    const cred = await prisma.userCredential.findUnique({ where: { userId: user.id } });

    // Persist the draft immediately so it survives even if it is never sent.
    // Regenerating with the same emailId overwrites the previous draft row.
    const data = {
      userId: user.id,
      toAddress: recipientEmail ?? "",
      toName: recipientName || null,
      fromAddress: cred?.smtpUser ?? user.email,
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      applicationId: ownedApplicationId,
      recipientTitle: recipientTitle || null,
      recipientCompany: company,
      roleTarget: role || roleFromApp || null,
      hookContext: hookContext || null,
      rationale: draft.rationale ?? null,
    };
    let saved;
    if (emailId) {
      const existing = await prisma.email.findFirst({ where: { id: emailId, userId: user.id } });
      saved =
        existing && existing.status === "draft"
          ? await prisma.email.update({ where: { id: existing.id }, data })
          : await prisma.email.create({ data });
    } else {
      saved = await prisma.email.create({ data });
    }

    return NextResponse.json({ ...draft, emailId: saved.id });
  } catch (e) {
    return apiError(e);
  }
}
