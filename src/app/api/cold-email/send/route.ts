import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail, MailAttachment } from "@/lib/mailer";
import { requireUser, apiError } from "@/lib/auth";
import { getFile } from "@/lib/files";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json();
    const {
      to,
      toName,
      subject,
      emailBody,
      applicationId,
      contactId,
      attachResume,
      attachCoverLetter,
      recipientTitle,
      recipientCompany,
      roleTarget,
      hookContext,
      rationale,
      emailId,
    } = body ?? {};
    if (!to || !subject || !emailBody) {
      return NextResponse.json({ error: "to, subject, emailBody required" }, { status: 400 });
    }

    // Pick the attachment:
    //   1. personalized PDF for the linked application (if any)
    //   2. generic resume PDF (if uploaded)
    //   3. no attachment
    const attachments: MailAttachment[] = [];
    let attachSource: "personalized" | "generic" | "none" = "none";
    let ownedApplicationId: string | null = null;
    if (applicationId) {
      const app = await prisma.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { id: true },
      });
      ownedApplicationId = app?.id ?? null;
    }
    if (ownedApplicationId && attachResume) {
      const file = await getFile(user.id, ownedApplicationId, "resume_pdf");
      if (file) {
        attachments.push({ filename: file.meta.filename, content: file.data });
        attachSource = "personalized";
      }
    }
    if (ownedApplicationId && attachCoverLetter) {
      const file = await getFile(user.id, ownedApplicationId, "cover_letter_pdf");
      if (file) attachments.push({ filename: file.meta.filename, content: file.data });
    }
    if (attachResume && attachSource === "none") {
      const generic = await getFile(user.id, null, "generic_resume");
      if (generic) {
        attachments.push({ filename: generic.meta.filename, content: generic.data });
        attachSource = "generic";
      }
    }

    // Upsert a Contact so this cold-email target shows up in /contacts.
    // Dedupe by email address (the lower-cased form).
    let resolvedContactId: string | null = contactId ?? null;
    const companyForContact: string = recipientCompany || "";
    if (!resolvedContactId) {
      const normalized = String(to).toLowerCase();
      const existing = await prisma.contact.findFirst({
        where: { email: normalized, userId: user.id },
      });
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
            userId: user.id,
            name: toName || normalized,
            title: recipientTitle ?? null,
            company: companyForContact || "—",
            email: normalized,
            source: "cold_email_target",
            applicationId: ownedApplicationId,
          },
        });
        resolvedContactId = created.id;
      }
    }

    // The user's verified sender address (also recorded on the Email row).
    const cred = await prisma.userCredential.findUnique({ where: { userId: user.id } });
    const fromAddress = cred?.smtpUser ?? user.email;

    // Persist as draft first so we have a record even if SMTP fails.
    // The draft endpoint already saved a row; reuse it (with any edits the
    // user made before sending) instead of creating a duplicate.
    const draftData = {
      userId: user.id,
      toAddress: to,
      toName: toName ?? null,
      fromAddress,
      subject,
      body: emailBody,
      status: "draft",
      applicationId: ownedApplicationId,
      contactId: resolvedContactId,
      recipientTitle: recipientTitle ?? null,
      recipientCompany: recipientCompany ?? null,
      roleTarget: roleTarget ?? null,
      hookContext: hookContext ?? null,
      rationale: rationale ?? null,
      attachSource,
    };
    const existingDraft = emailId
      ? await prisma.email.findFirst({ where: { id: emailId, userId: user.id } })
      : null;
    const draft =
      existingDraft && existingDraft.status === "draft"
        ? await prisma.email.update({ where: { id: existingDraft.id }, data: draftData })
        : await prisma.email.create({ data: draftData });

    try {
      const info = await sendEmail(user.id, {
        to,
        toName,
        subject,
        body: emailBody,
        attachments,
      });
      const updated = await prisma.email.update({
        where: { id: draft.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          messageId: info.messageId,
          fromAddress: info.fromAddress,
        },
      });
      if (ownedApplicationId) {
        await prisma.event.create({
          data: {
            applicationId: ownedApplicationId,
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
      return apiError(e);
    }
  } catch (e) {
    return apiError(e);
  }
}
