import { FollowUpStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { sendEmail } from "../mailer";
import { getProfile } from "../profile";
import { completeApplicationTask, initializeApplicationWorkflow, recordApplicationEvent } from "./workflow";

const TERMINAL_STATUSES = new Set(["replied", "interview", "offer", "rejected", "closed"]);

export function followUpDate(sentAt: Date, delayDays: number): Date {
  const safeDays = Math.min(30, Math.max(1, Math.round(delayDays || 5)));
  return new Date(sentAt.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

export function buildFollowUpDraft(input: {
  candidateName: string;
  recipientName?: string | null;
  role: string;
  company: string;
  originalSubject: string;
}) {
  const firstName = input.recipientName?.trim().split(/\s+/)[0];
  return {
    subject: /^re:/i.test(input.originalSubject) ? input.originalSubject : `Re: ${input.originalSubject}`,
    body: `${firstName ? `Hi ${firstName},` : "Hello,"}\n\nI wanted to follow up on my note about the ${input.role} opportunity at ${input.company}. I remain very interested and would appreciate any guidance on the next steps when you have a moment.\n\nBest,\n${input.candidateName}`,
  };
}

export async function scheduleFollowUpForEmail(applicationId: string, originalEmailId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      user: { include: { profile: true } },
      emails: { where: { id: originalEmailId }, take: 1 },
    },
  });
  const email = application.emails[0];
  if (!email || email.status !== "sent") throw new Error("A sent outreach email is required to schedule follow-up.");
  if (TERMINAL_STATUSES.has(application.status)) return null;

  const delayDays = application.user.profile?.followUpDelayDays ?? 5;
  const draft = buildFollowUpDraft({
    candidateName: application.user.profile?.name ?? application.user.email,
    recipientName: email.toName,
    role: application.role,
    company: application.company,
    originalSubject: email.subject,
  });
  const scheduledFor = followUpDate(email.sentAt ?? new Date(), delayDays);
  const followUp = await prisma.followUp.upsert({
    where: { originalEmailId },
    create: {
      applicationId,
      originalEmailId,
      scheduledFor,
      subject: draft.subject,
      body: draft.body,
    },
    update: {},
  });

  await initializeApplicationWorkflow(applicationId);
  await prisma.applicationTask.update({
    where: { applicationId_key: { applicationId, key: "FOLLOW_UP" } },
    data: {
      status: "PENDING",
      required: false,
      metadata: { followUpId: followUp.id, scheduledFor: followUp.scheduledFor.toISOString() },
    },
  });
  await recordApplicationEvent(
    applicationId,
    "FOLLOW_UP_SCHEDULED",
    `Follow-up scheduled for ${scheduledFor.toISOString()}.`,
    { followUpId: followUp.id, originalEmailId, scheduledFor: scheduledFor.toISOString(), delayDays }
  );
  return followUp;
}

export async function refreshDueFollowUps(userId: string, now = new Date()) {
  return prisma.followUp.updateMany({
    where: {
      status: FollowUpStatus.SCHEDULED,
      scheduledFor: { lte: now },
      application: { userId },
    },
    data: { status: FollowUpStatus.DUE },
  });
}

export async function cancelPendingFollowUpsForApplication(applicationId: string, reason: string) {
  const result = await prisma.followUp.updateMany({
    where: { applicationId, status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.DUE, FollowUpStatus.FAILED] } },
    data: {
      status: FollowUpStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: reason.slice(0, 300),
    },
  });
  if (result.count) {
    await initializeApplicationWorkflow(applicationId);
    await prisma.applicationTask.update({
      where: { applicationId_key: { applicationId, key: "FOLLOW_UP" } },
      data: {
        status: "SKIPPED",
        required: false,
        errorMessage: null,
        completedAt: new Date(),
        metadata: { reason: reason.slice(0, 300) },
      },
    });
    await recordApplicationEvent(applicationId, "FOLLOW_UP_CANCELLED", reason.slice(0, 500));
  }
  return result;
}

export async function sendScheduledFollowUp(userId: string, followUpId: string) {
  const followUp = await prisma.followUp.findFirst({
    where: { id: followUpId, application: { userId } },
    include: { application: true, originalEmail: true, sentEmail: true },
  });
  if (!followUp) throw new Error("Follow-up not found.");
  if (followUp.status === FollowUpStatus.SENT) return { followUp, alreadySent: true };
  if (followUp.status === FollowUpStatus.CANCELLED) throw new Error("This follow-up was cancelled.");

  const claim = await prisma.followUp.updateMany({
    where: {
      id: followUp.id,
      status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.DUE, FollowUpStatus.FAILED] },
    },
    data: { status: FollowUpStatus.SENDING, attempt: { increment: 1 }, errorMessage: null },
  });
  if (!claim.count) throw new Error("This follow-up is already sending.");

  const idempotencyKey = `follow-up-send:${followUp.id}`;
  try {
    const draftData = {
      userId,
      toAddress: followUp.originalEmail.toAddress,
      toName: followUp.originalEmail.toName,
      fromAddress: followUp.originalEmail.fromAddress,
      subject: followUp.subject,
      body: followUp.body,
      status: "sending",
      applicationId: followUp.applicationId,
      contactId: followUp.originalEmail.contactId,
      provider: "smtp",
      idempotencyKey,
      attachSource: "none",
    };
    const existingEmail = await prisma.email.findUnique({ where: { idempotencyKey } });
    const email = existingEmail
      ? await prisma.email.update({ where: { id: existingEmail.id }, data: { ...draftData, errorMessage: null } })
      : await prisma.email.create({ data: draftData });

    const info = await sendEmail(userId, {
      to: followUp.originalEmail.toAddress,
      toName: followUp.originalEmail.toName ?? undefined,
      subject: followUp.subject,
      body: followUp.body,
      inReplyTo: followUp.originalEmail.messageId ?? undefined,
      references: followUp.originalEmail.messageId ? [followUp.originalEmail.messageId] : undefined,
    });
    const sentAt = new Date();
    const [sentEmail, updated] = await prisma.$transaction([
      prisma.email.update({
        where: { id: email.id },
        data: { status: "sent", sentAt, messageId: info.messageId, fromAddress: info.fromAddress },
      }),
      prisma.followUp.update({
        where: { id: followUp.id },
        data: { status: FollowUpStatus.SENT, sentAt, sentEmailId: email.id, errorMessage: null },
      }),
    ]);
    await completeApplicationTask(followUp.applicationId, "FOLLOW_UP", {
      metadata: { followUpId: followUp.id, emailId: sentEmail.id, messageId: sentEmail.messageId },
    });
    await recordApplicationEvent(followUp.applicationId, "FOLLOW_UP_SENT", `Follow-up sent to ${sentEmail.toAddress}.`, {
      followUpId: followUp.id,
      emailId: sentEmail.id,
    });
    return { followUp: updated, alreadySent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.followUp.update({
      where: { id: followUp.id },
      data: { status: FollowUpStatus.FAILED, errorMessage: message.slice(0, 500) },
    });
    const failedEmail = await prisma.email.findUnique({ where: { idempotencyKey } });
    if (failedEmail) {
      await prisma.email.update({
        where: { id: failedEmail.id },
        data: { status: "failed", errorMessage: message.slice(0, 500) },
      });
    }
    throw error;
  }
}

export function asFollowUpUpdate(input: unknown): Prisma.FollowUpUpdateInput {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const data: Prisma.FollowUpUpdateInput = {};
  if (typeof body.subject === "string" && body.subject.trim()) data.subject = body.subject.trim().slice(0, 300);
  if (typeof body.body === "string" && body.body.trim()) data.body = body.body.trim().slice(0, 5000);
  if (typeof body.scheduledFor === "string") {
    const date = new Date(body.scheduledFor);
    if (!Number.isNaN(date.getTime())) data.scheduledFor = date;
  }
  return data;
}
