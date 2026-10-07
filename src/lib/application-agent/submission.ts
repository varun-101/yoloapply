import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ApiUserError } from "../auth";
import { detectAtsProvider } from "./preparation";
import { completeApplicationTask, recordApplicationEvent } from "./workflow";

// Submission tracking shared by POST /api/applications/[id]/submission and the
// MCP tracking tools. The rule everything here protects: an application only
// becomes "applied" on positive evidence. A click without confirmation, a
// disconnected browser, or an ambiguous email is an ATTEMPT, never an
// application, and must be reconciled before anyone retries.

export const SUBMITTED_EVENT = "APPLICATION_SUBMITTED";
export const ATTEMPT_EVENT = "APPLICATION_ATTEMPT";
export const UNCONFIRMED_EVENT = "SUBMISSION_UNCONFIRMED";

export type EvidenceKind =
  | "site_confirmation" // the employer's page said it was received
  | "email_receipt" // an employer/ATS receipt email for this application
  | "employer_duplicate_notice" // the employer says it already has an application
  | "candidate_confirmed"; // the candidate says so (e.g. they saw the receipt)

export interface ConfirmedSubmissionInput {
  evidenceKind: EvidenceKind;
  recordedBy: "candidate" | "agent";
  pageUrl?: string;
  pageTitle?: string;
  confirmationText?: string;
  confirmationNumber?: string;
  emailMessageId?: string;
  emailFrom?: string;
  emailSubject?: string;
  /** When the evidence says the application was submitted. Defaults to now for live site confirmations. */
  submittedAt?: Date;
  /** For duplicate notices: where the original date came from. */
  submittedAtSource?: string;
  /** false when the date was not checked against a receipt; it then never corrects an existing appliedAt. */
  dateVerified?: boolean;
  note?: string;
}

const STATUSES_BEFORE_APPLIED = new Set(["draft", "personalized", "applied"]);
const FUTURE_SKEW_MS = 2 * 60 * 1000;
// A site/candidate confirmation dated more than this before "now" must say
// where the date came from: the earliest date wins, so a mistaken one sticks.
const LATE_RECORDING_MS = 15 * 60 * 1000;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Which date becomes appliedAt. Exported for tests: the earliest evidenced date
 * wins, so reconciling a historical duplicate can correct a later stamp, but a
 * confirmation recorded again later can never move the date forward.
 */
export function resolveAppliedAt(existing: Date | null, evidenced: Date): { appliedAt: Date; corrected: boolean } {
  if (!existing) return { appliedAt: evidenced, corrected: false };
  if (evidenced.getTime() < existing.getTime()) return { appliedAt: evidenced, corrected: true };
  return { appliedAt: existing, corrected: false };
}

export function validateEvidence(input: ConfirmedSubmissionInput, now = new Date()): Date {
  const at = input.submittedAt ?? null;
  if (at && Number.isNaN(at.getTime())) throw new ApiUserError("submittedAt is not a valid date.", 400, "invalid_date");
  if (at && at.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new ApiUserError("submittedAt is in the future.", 400, "invalid_date");
  }
  if (
    at &&
    (input.evidenceKind === "site_confirmation" || input.evidenceKind === "candidate_confirmed") &&
    now.getTime() - at.getTime() > LATE_RECORDING_MS &&
    !clean(input.submittedAtSource, 300)
  ) {
    throw new ApiUserError(
      "submittedAt is well before now; also give submittedAtSource (where that time comes from).",
      400,
      "date_source_required"
    );
  }
  switch (input.evidenceKind) {
    case "site_confirmation":
      if (!clean(input.confirmationText, 500) && !clean(input.pageTitle, 200) && !clean(input.confirmationNumber, 120)) {
        throw new ApiUserError(
          "A site confirmation needs the confirmation text, page title or confirmation number you actually saw.",
          400,
          "evidence_required"
        );
      }
      return at ?? now;
    case "email_receipt":
      if (!clean(input.emailMessageId, 500) || !at) {
        throw new ApiUserError(
          "An email receipt needs the message id and its received time. Use search_application_emails to find it.",
          400,
          "evidence_required"
        );
      }
      return at;
    case "employer_duplicate_notice":
      if (!at || !clean(input.submittedAtSource, 300)) {
        throw new ApiUserError(
          "A duplicate notice needs the ORIGINAL submission date and where it came from (an original receipt email, the employer's portal). If the original date is unknown, record an attempt instead of a submission.",
          400,
          "original_date_required"
        );
      }
      return at;
    case "candidate_confirmed":
      if (!clean(input.note, 500) && !clean(input.confirmationText, 500)) {
        throw new ApiUserError("Say what the candidate confirmed (note or confirmationText).", 400, "evidence_required");
      }
      return at ?? now;
  }
}

export async function recordConfirmedSubmission(
  userId: string,
  applicationId: string,
  input: ConfirmedSubmissionInput
) {
  const evidencedAt = validateEvidence(input);
  const recordedAt = new Date();
  const pageUrl = clean(input.pageUrl, 2000);
  const evidence = {
    kind: input.evidenceKind,
    pageUrl,
    pageTitle: clean(input.pageTitle, 200),
    confirmationText: clean(input.confirmationText, 500),
    confirmationNumber: clean(input.confirmationNumber, 120),
    emailMessageId: clean(input.emailMessageId, 500),
    emailFrom: clean(input.emailFrom, 320),
    emailSubject: clean(input.emailSubject, 300),
    submittedAt: evidencedAt.toISOString(),
    submittedAtSource: clean(input.submittedAtSource, 300),
    note: clean(input.note, 500),
    dateVerified: input.dateVerified !== false,
    atsProvider: detectAtsProvider(pageUrl ?? undefined),
    recordedAt: recordedAt.toISOString(),
    recordedBy: input.recordedBy,
  };

  // One transaction holding the application row lock, so two concurrent
  // confirmations (an agent retry, the extension and the agent) produce one
  // APPLICATION_SUBMITTED event, not two.
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Application" WHERE id = ${applicationId} AND "userId" = ${userId} FOR NO KEY UPDATE`;
    if (!locked.length) throw new ApiUserError("Application not found.", 404, "not_found");
    const application = await tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        appliedAt: true,
        tasks: { where: { key: "PREPARE_APPLICATION" }, select: { metadata: true }, take: 1 },
        events: { where: { type: SUBMITTED_EVENT }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } },
      },
    });
    const { appliedAt, corrected } =
      input.dateVerified === false && application.appliedAt
        ? { appliedAt: application.appliedAt, corrected: false }
        : resolveAppliedAt(application.appliedAt, evidencedAt);
    const correction = corrected ? { appliedAtCorrectedFrom: application.appliedAt?.toISOString() ?? null } : {};

    if (application.events[0]) {
      // Already confirmed. Additional evidence is kept (it may carry an
      // earlier date) but never creates a second submission.
      if (corrected) await tx.application.update({ where: { id: application.id }, data: { appliedAt } });
      await tx.event.create({
        data: {
          applicationId: application.id,
          type: "SUBMISSION_EVIDENCE_ADDED",
          detail: "Additional submission evidence recorded.",
          metadata: { ...evidence, ...correction } as Prisma.InputJsonValue,
        },
      });
      return { alreadyRecorded: true, appliedAt, corrected, previousMetadata: null };
    }

    await tx.application.update({
      where: { id: application.id },
      data: {
        appliedAt,
        // Never regress a later lifecycle state (interview, offer, rejected...).
        ...(STATUSES_BEFORE_APPLIED.has(application.status) ? { status: "applied" } : {}),
      },
    });
    await tx.event.create({
      data: {
        applicationId: application.id,
        type: SUBMITTED_EVENT,
        detail: `Submission confirmed (${input.evidenceKind})${evidence.confirmationNumber ? ` (${evidence.confirmationNumber})` : ""}.`,
        metadata: { ...evidence, ...correction } as Prisma.InputJsonValue,
      },
    });
    return { alreadyRecorded: false, appliedAt, corrected, previousMetadata: jsonRecord(application.tasks[0]?.metadata) };
  });

  if (!outcome.alreadyRecorded) {
    await completeApplicationTask(applicationId, "PREPARE_APPLICATION", {
      metadata: { ...outcome.previousMetadata, submission: evidence } as Prisma.InputJsonValue,
    });
  }
  return {
    alreadyRecorded: outcome.alreadyRecorded,
    applicationId,
    appliedAt: outcome.appliedAt,
    appliedAtCorrected: outcome.corrected,
    evidence,
  };
}

export type AttemptStage =
  | "form_opened"
  | "resume_uploaded"
  | "resume_parsed"
  | "fields_reviewed"
  | "submit_clicked";
export type AttemptOutcome = "ok" | "blocked" | "failed" | "unknown";

export interface AttemptInput {
  stage: AttemptStage;
  outcome: AttemptOutcome;
  pageUrl?: string;
  note?: string;
  blockers?: string[];
}

export async function recordApplicationAttempt(userId: string, applicationId: string, input: AttemptInput) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, status: true },
  });
  if (!application) throw new ApiUserError("Application not found.", 404, "not_found");
  const metadata = {
    stage: input.stage,
    outcome: input.outcome,
    pageUrl: clean(input.pageUrl, 2000),
    note: clean(input.note, 1000),
    blockers: (input.blockers ?? []).map((b) => clean(b, 300)).filter(Boolean).slice(0, 20),
    recordedAt: new Date().toISOString(),
  };
  // A submit click whose result nobody saw is the dangerous case: retrying
  // can create a duplicate application at the employer.
  const unconfirmedSubmit = input.stage === "submit_clicked" && input.outcome !== "ok" && input.outcome !== "failed";
  await recordApplicationEvent(
    application.id,
    unconfirmedSubmit ? UNCONFIRMED_EVENT : ATTEMPT_EVENT,
    `${input.stage}: ${input.outcome}${metadata.note ? ` (${metadata.note.slice(0, 200)})` : ""}`,
    metadata as Prisma.InputJsonValue
  );
  return {
    applicationId: application.id,
    status: application.status,
    recorded: metadata,
    guidance: unconfirmedSubmit
      ? "Submission outcome is UNKNOWN and was not counted as applied. Search for a receipt (search_application_emails) and check the employer page before any retry. Record a confirmed submission only on positive evidence."
      : input.stage === "submit_clicked" && input.outcome === "ok"
        ? "A click alone is not evidence. Call record_confirmed_submission with the confirmation text/page you observed."
        : null,
  };
}

export type SubmissionState =
  | "confirmed"
  | "unconfirmed_attempt"
  | "marked_applied_without_evidence"
  | "not_submitted";

/** Derives where an application stands from its status and events. */
export function deriveSubmissionState(
  status: string,
  events: { type: string; createdAt: Date }[]
): SubmissionState {
  if (events.some((e) => e.type === SUBMITTED_EVENT)) return "confirmed";
  if (events.some((e) => e.type === UNCONFIRMED_EVENT)) return "unconfirmed_attempt";
  if (status !== "draft" && status !== "personalized") return "marked_applied_without_evidence";
  return "not_submitted";
}
