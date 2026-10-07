import { NextRequest, NextResponse } from "next/server";
import { requireUser, apiError } from "@/lib/auth";
import { recordConfirmedSubmission } from "@/lib/application-agent/submission";

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (body.confirmation !== "user_confirmed_submission") {
      return NextResponse.json({ error: "Explicit submission confirmation is required." }, { status: 400 });
    }
    const evidence = jsonRecord(body.evidence);
    const pageTitle = str(evidence.pageTitle);
    const confirmationText = str(evidence.confirmationText);
    const confirmationNumber = str(evidence.confirmationNumber);
    const result = await recordConfirmedSubmission(user.id, params.id, {
      // The extension/dashboard path is the candidate confirming what they saw;
      // with no page details it is still the candidate's own confirmation.
      evidenceKind: pageTitle || confirmationText || confirmationNumber ? "site_confirmation" : "candidate_confirmed",
      recordedBy: "candidate",
      pageUrl: str(body.pageUrl),
      pageTitle,
      confirmationText,
      confirmationNumber,
      note: pageTitle || confirmationText || confirmationNumber ? undefined : "Candidate confirmed submission.",
    });
    return NextResponse.json({
      ok: true,
      alreadyRecorded: result.alreadyRecorded,
      submittedAt: result.appliedAt,
      evidence: result.evidence,
    });
  } catch (error) {
    return apiError(error);
  }
}
