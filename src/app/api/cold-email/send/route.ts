import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail, MailAttachment } from "@/lib/mailer";
import { requireUser, apiError } from "@/lib/auth";
import { getFile } from "@/lib/files";
import { sha256Hex } from "@/lib/crypto";
import {
  completeApplicationTask,
  failApplicationTask,
  startApplicationTask,
} from "@/lib/application-agent/workflow";
import { scheduleFollowUpForEmail } from "@/lib/application-agent/follow-up";

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

    // One initial outreach per application/recipient is claimed atomically.
    // If the process dies after SMTP accepted the message but before the final
    // DB write, the row remains "sending" and is never retried automatically.
    const recipientHash = sha256Hex(`${String(to).trim().toLowerCase()}|${ownedApplicationId ? "initial" : subject}`).slice(0, 24);
    const idempotencyKey = `outreach-send:${ownedApplicationId ?? user.id}:${recipientHash}`;

    // Persist as draft first so we have a record even if SMTP fails. Reuse the
    // draft endpoint's row (including the user's edits) whenever possible.
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
      provider: "smtp",
    };
    const existingDraft = emailId
      ? await prisma.email.findFirst({ where: { id: emailId, userId: user.id } })
      : null;
    let draft;
    if (existingDraft?.status === "sent" || existingDraft?.status === "sending") {
      return NextResponse.json(
        { error: existingDraft.status === "sent" ? "This outreach was already sent." : "This outreach is already sending." },
        { status: 409 }
      );
    }

    const claimedByKey = await prisma.email.findUnique({ where: { idempotencyKey } });
    if (claimedByKey && claimedByKey.id !== existingDraft?.id) {
      if (claimedByKey.status === "sent" || claimedByKey.status === "sending") {
        return NextResponse.json(
          { error: claimedByKey.status === "sent" ? "This outreach was already sent." : "This outreach is already sending." },
          { status: 409 }
        );
      }
      draft = await prisma.email.update({
        where: { id: claimedByKey.id },
        data: { ...draftData, idempotencyKey, status: "draft", errorMessage: null },
      });
    } else if (existingDraft) {
      draft = await prisma.email.update({
        where: { id: existingDraft.id },
        data: { ...draftData, idempotencyKey, status: "draft", errorMessage: null },
      });
    } else {
      draft = await prisma.email.create({
        data: { ...draftData, idempotencyKey },
      });
    }

    if (ownedApplicationId) {
      const workflow = await startApplicationTask(ownedApplicationId, "SEND_OUTREACH");
      if (workflow.alreadyRunning) {
        return NextResponse.json({ error: "Outreach sending is already running." }, { status: 409 });
      }
    }

    const claim = await prisma.email.updateMany({
      where: { id: draft.id, status: { in: ["draft", "failed"] } },
      data: { status: "sending", errorMessage: null },
    });
    if (claim.count === 0) {
      return NextResponse.json({ error: "This outreach is already sending or was already sent." }, { status: 409 });
    }

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
        await completeApplicationTask(ownedApplicationId, "SEND_OUTREACH", {
          metadata: { emailId: updated.id, messageId: updated.messageId, provider: "smtp" },
        });
        await prisma.event.create({
          data: {
            applicationId: ownedApplicationId,
            type: "email_sent",
            detail: `${subject} → ${to} (attached: ${attachSource})`,
          },
        });
        await scheduleFollowUpForEmail(ownedApplicationId, updated.id).catch(async (scheduleError) => {
          const message = scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
          await prisma.event.create({
            data: {
              applicationId: ownedApplicationId!,
              type: "FOLLOW_UP_SCHEDULE_FAILED",
              detail: message.slice(0, 500),
            },
          }).catch(() => {});
        });
      }
      return NextResponse.json({ ok: true, email: updated, attachSource });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.email.update({
        where: { id: draft.id },
        data: { status: "failed", errorMessage: msg.slice(0, 500) },
      });
      if (ownedApplicationId) {
        await failApplicationTask(ownedApplicationId, "SEND_OUTREACH", e, { code: "smtp_send_failed" }).catch(
          () => {}
        );
      }
      return apiError(e);
    }
  } catch (e) {
    return apiError(e);
  }
}
