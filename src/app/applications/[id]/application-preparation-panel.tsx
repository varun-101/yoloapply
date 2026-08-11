import Link from "next/link";
import { ExternalLink, FileCheck2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApplicationPreparationReport } from "@/lib/application-agent/preparation";

interface SubmissionEvidence {
  pageUrl?: string | null;
  pageTitle?: string | null;
  confirmationText?: string | null;
  confirmationNumber?: string | null;
  recordedAt?: string | null;
}

export default function ApplicationPreparationPanel({
  report,
  taskStatus,
  applyUrl,
  submission,
}: {
  report: ApplicationPreparationReport | null;
  taskStatus?: string;
  applyUrl?: string | null;
  submission?: SubmissionEvidence | null;
}) {
  if (!report && !submission) return null;
  const reviewFields = report?.fields.filter((field) => field.status === "needs_review") ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Application review</CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {submission
              ? "Submission was explicitly confirmed and recorded."
              : reviewFields.length
                ? "The extension prepared the form and stopped for your input."
                : "The extension prepared the form. Review it in the ATS before submitting."}
          </p>
        </div>
        <Badge
          className={
            submission
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : taskStatus === "NEEDS_REVIEW"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
          }
        >
          {submission ? "submitted" : taskStatus === "NEEDS_REVIEW" ? "needs review" : "prepared"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {report && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="rounded border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-lg font-semibold">{report.filledCount}</div>
              <div className="text-xs text-slate-500">filled</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-lg font-semibold text-amber-700 dark:text-amber-400">{report.reviewCount}</div>
              <div className="text-xs text-slate-500">review</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-lg font-semibold">{report.skippedCount}</div>
              <div className="text-xs text-slate-500">skipped</div>
            </div>
            <div className="rounded border border-slate-200 dark:border-slate-800 p-2">
              <div className="text-sm font-semibold capitalize">{report.atsProvider}</div>
              <div className="text-xs text-slate-500">ATS</div>
            </div>
          </div>
        )}

        {reviewFields.length > 0 && (
          <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4" /> Candidate input required
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {reviewFields.map((field) => (
                <li key={field.id}>
                  <div>{field.label}</div>
                  {field.reason && <div className="text-xs text-amber-700 dark:text-amber-400">{field.reason}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {report && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Resume {report.resumeAttached ? "attached ✓" : "not detected"}</span>
            <span>Cover letter {report.coverLetterAttached ? "attached ✓" : "not detected"}</span>
          </div>
        )}

        {submission && (
          <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300">
              <FileCheck2 className="h-4 w-4" /> Submission evidence recorded
            </div>
            {submission.confirmationNumber && <div className="mt-1">Reference: {submission.confirmationNumber}</div>}
            {submission.confirmationText && (
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{submission.confirmationText}</div>
            )}
          </div>
        )}

        {(report?.pageUrl || submission?.pageUrl || applyUrl) && !submission && (
          <Button asChild variant="outline">
            <Link href={report?.pageUrl || applyUrl || "#"} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Open application review
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
