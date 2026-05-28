import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/mailer";
import { owner } from "@/lib/owner";
import { genericResumePath, getGenericResumeInfo } from "@/lib/genericResume";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    to,
    toName,
    subject,
    emailBody,
    applicationId,
    contactId,
    attachResume,
    recipientTitle,
    recipientCompany,
    roleTarget,
    hookContext,
    rationale,
  } = body ?? {};
  if (!to || !subject || !emailBody) {
    return NextResponse.json({ error: "to, subject, emailBody required" }, { status: 400 });
  }

  // Pick the attachment:
  //   1. personalized PDF for the linked application (if any)
  //   2. generic resume PDF (if uploaded)
  //   3. no attachment
  let attachPath: string | null = null;
  let attachSource: "personalized" | "generic" | "none" = "none";
  if (attachResume) {
    if (applicationId) {
      const app = await prisma.application.findUnique({ where: { id: applicationId } });
      if (app?.resumePdfPath) {
        attachPath = app.resumePdfPath;
        attachSource = "personalized";
      }
    }
    if (!attachPath && getGenericResumeInfo().exists) {
      attachPath = genericResumePath();
      attachSource = "generic";
    }
  }

  // Upsert a Contact so this cold-email target shows up in /contacts.
  // Dedupe by email address (the lower-cased form).
  let resolvedContactId: string | null = contactId ?? null;
  const companyForContact: string = recipientCompany || (toName ? "" : "");
  if (!resolvedContactId) {
    const normalized = String(to).toLowerCase();
    const existing = await prisma.contact.findFirst({ where: { email: normalized } });
    if (existing) {
      resolvedContactId = existing.id;
      // Backfill name/title/company if they were missing.
      const patch: Record<string, string> = {};
      if (!existing.name && toName) patch.name = toName;
      if (!existing.title && recipientTitle) patch.title = recipientTitle;
      if (!existing.company && companyForContact) patch.company = companyForContact;
      if (Object.keys(patch).length) {
        await prisma.contact.update({ where: { id: existing.id }, data: patch });
      }
    } else {
      const created = await prisma.contact.create({
        data: {
          name: toName || normalized,
          title: recipientTitle ?? null,
          company: companyForContact || "—",
          email: normalized,
          source: "cold_email_target",
          applicationId: applicationId ?? null,
        },
      });
      resolvedContactId = created.id;
    }
  }

  // Persist as draft first so we have a record even if SMTP fails.
  const draft = await prisma.email.create({
    data: {
      toAddress: to,
      toName: toName ?? null,
      fromAddress: process.env.SMTP_USER ?? owner.email,
      subject,
      body: emailBody,
      status: "draft",
      applicationId: applicationId ?? null,
      contactId: resolvedContactId,
      recipientTitle: recipientTitle ?? null,
      recipientCompany: recipientCompany ?? null,
      roleTarget: roleTarget ?? null,
      hookContext: hookContext ?? null,
      rationale: rationale ?? null,
      attachSource,
    },
  });

  try {
    const info = await sendEmail({
      to,
      toName,
      subject,
      body: emailBody,
      attachResumePdfPath: attachPath,
    });
    const updated = await prisma.email.update({
      where: { id: draft.id },
      data: { status: "sent", sentAt: new Date(), messageId: info.messageId },
    });
    if (applicationId) {
      await prisma.event.create({
        data: {
          applicationId,
          type: "email_sent",
          detail: `${subject} → ${to} (attached: ${attachSource})`,
        },
      });
    }
    return NextResponse.json({ ok: true, email: updated, attachSource });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.email.update({
      where: { id: draft.id },
      data: { status: "failed", errorMessage: msg.slice(0, 500) },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
