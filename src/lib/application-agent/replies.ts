import { Prisma, ReplyClassification } from "@prisma/client";
import { prisma } from "../db";
import { chatJson } from "../llm";
import { getLlmConfigOrNull } from "../credentials";
import { ApiUserError } from "../auth";
import { cancelPendingFollowUpsForApplication } from "./follow-up";
import { recordApplicationEvent } from "./workflow";

export interface ProviderReply {
  provider: string;
  providerMessageId?: string;
  emailId?: string;
  fromAddress: string;
  subject: string;
  body: string;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ReplyProvider {
  key: string;
  fetchReplies(input: { since?: Date }): Promise<ProviderReply[]>;
}

export interface ClassifiedReply {
  classification: ReplyClassification;
  confidence: number;
  summary: string;
}

const CLASSIFICATIONS = new Set(Object.values(ReplyClassification));

export function classifyReplyDeterministically(subject: string, body: string): ClassifiedReply | null {
  const text = `${subject}\n${body}`.toLowerCase();
  const result = (classification: ReplyClassification, summary: string): ClassifiedReply => ({
    classification,
    confidence: 0.92,
    summary,
  });
  if (/\b(unfortunately|not (?:moving|proceeding)|decided not|other candidates|position (?:has been )?filled|reject(?:ed|ion))\b/.test(text)) {
    return result(ReplyClassification.REJECTION, "The sender indicates the application is not moving forward.");
  }
  if (/\b(interview|schedule a call|calendar link|availability|speak with|meet with)\b/.test(text)) {
    return result(ReplyClassification.INTERVIEW, "The sender is requesting or discussing an interview conversation.");
  }
  if (/\b(coding (?:test|challenge)|assessment|take[- ]home|hackerrank|codility|online test)\b/.test(text)) {
    return result(ReplyClassification.ASSESSMENT, "The sender is requesting an assessment or take-home exercise.");
  }
  if (/\b(please (?:send|share|provide)|could you (?:send|share|provide)|need (?:more|additional) (?:details|information))\b/.test(text)) {
    return result(ReplyClassification.REQUEST_INFO, "The sender is asking for additional information.");
  }
  return null;
}

export async function classifyReply(userId: string, subject: string, body: string): Promise<ClassifiedReply> {
  const deterministic = classifyReplyDeterministically(subject, body);
  if (deterministic) return deterministic;
  const llm = await getLlmConfigOrNull(userId);
  if (!llm) {
    return { classification: ReplyClassification.OTHER, confidence: 0.4, summary: "Reply received; manual review recommended." };
  }
  try {
    const output = await chatJson<{ classification?: string; confidence?: number; summary?: string }>({
      ...llm,
      system:
        "Classify a recruiter or hiring-team email reply. Use exactly one classification: INTERVIEW, ASSESSMENT, REJECTION, REQUEST_INFO, FOLLOW_UP, OTHER. Base the result only on the supplied message. Return strict JSON with classification, confidence from 0 to 1, and a one-sentence summary.",
      user: `Subject: ${subject.slice(0, 500)}\n\n${body.slice(0, 8000)}`,
      maxTokens: 300,
      temperature: 0,
    });
    const classification = CLASSIFICATIONS.has(output.classification as ReplyClassification)
      ? (output.classification as ReplyClassification)
      : ReplyClassification.OTHER;
    return {
      classification,
      confidence: Math.min(1, Math.max(0, Number(output.confidence) || 0.5)),
      summary: typeof output.summary === "string" && output.summary.trim()
        ? output.summary.replace(/\s+/g, " ").trim().slice(0, 500)
        : "Reply received; manual review recommended.",
    };
  } catch {
    return { classification: ReplyClassification.OTHER, confidence: 0.3, summary: "Reply received; automatic classification failed." };
  }
}

export async function ingestApplicationReply(userId: string, applicationId: string, input: ProviderReply) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true },
  });
  if (!application) throw new ApiUserError("Application not found.", 404);
  if (!input.fromAddress.trim() || !input.body.trim()) {
    throw new ApiUserError("Reply sender and body are required.");
  }
  if (input.emailId) {
    const email = await prisma.email.findFirst({ where: { id: input.emailId, applicationId, userId }, select: { id: true } });
    if (!email) throw new ApiUserError("Linked outreach email not found.", 404);
  }

  if (input.providerMessageId) {
    const existing = await prisma.inboundReply.findUnique({
      where: { provider_providerMessageId: { provider: input.provider, providerMessageId: input.providerMessageId } },
    });
    if (existing) return { reply: existing, duplicate: true };
  }

  const result = await classifyReply(userId, input.subject, input.body);
  const reply = await prisma.inboundReply.create({
    data: {
      applicationId,
      emailId: input.emailId ?? null,
      provider: input.provider.slice(0, 50),
      providerMessageId: input.providerMessageId?.slice(0, 300) ?? null,
      fromAddress: input.fromAddress.trim().toLowerCase().slice(0, 320),
      subject: input.subject.trim().slice(0, 500),
      body: input.body.trim().slice(0, 20000),
      receivedAt: input.receivedAt,
      classification: result.classification,
      confidence: result.confidence,
      summary: result.summary,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });

  const status = result.classification === ReplyClassification.REJECTION
    ? "rejected"
    : result.classification === ReplyClassification.INTERVIEW
      ? "interview"
      : "replied";
  await prisma.application.update({ where: { id: applicationId }, data: { status } });
  await prisma.email.updateMany({
    where: { applicationId, userId, status: "sent" },
    data: { status: "replied" },
  });
  await cancelPendingFollowUpsForApplication(applicationId, `Reply received and classified as ${result.classification}.`);
  await recordApplicationEvent(applicationId, "REPLY_RECEIVED", result.summary, {
    replyId: reply.id,
    classification: result.classification,
    confidence: result.confidence,
    provider: reply.provider,
  });
  return { reply, duplicate: false };
}
