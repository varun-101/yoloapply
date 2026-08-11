import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor } from "@/lib/utils";
import { Download, FileText, Mail, FileSignature, MessageSquareText } from "lucide-react";
import ApplicationActions from "./actions";
import QuestionAnswerer from "./question-answerer";
import JobDescriptionEditor from "./jd-editor";
import FindContacts from "./find-contacts";
import ShareButton from "./share-button";
import WorkflowPanel from "./workflow-panel";
import ApplicationPreparationPanel from "./application-preparation-panel";
import ReplyPanel from "./reply-panel";
import {
  APPLICATION_TASK_DEFINITIONS,
  deriveApplicationReadiness,
} from "@/lib/application-agent/workflow-types";
import { parsePreparationReport } from "@/lib/application-agent/preparation";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  const app = await prisma.application.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      emails: { orderBy: { createdAt: "desc" } },
      contacts: true,
      files: { select: { kind: true } },
      tasks: true,
      analysis: true,
      inboundReplies: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!app) notFound();

  const kinds = new Set(app.files.map((f) => f.kind));
  const hasPdf = kinds.has("resume_pdf");
  const hasCoverLetter = kinds.has("cover_letter_pdf");
  const taskDefinition = new Map(APPLICATION_TASK_DEFINITIONS.map((task) => [task.key, task]));
  const sortedTasks = app.tasks
    .map((task) => ({
      key: task.key,
      label: taskDefinition.get(task.key)?.label ?? task.key,
      status: task.status,
      required: task.required,
      errorMessage: task.errorMessage,
      sortOrder: taskDefinition.get(task.key)?.sortOrder ?? 999,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const readiness = deriveApplicationReadiness(sortedTasks);
  const preparationTask = app.tasks.find((task) => task.key === "PREPARE_APPLICATION");
  const preparationReport = parsePreparationReport(preparationTask?.metadata);
  const submissionMetadata = app.events.find((event) => event.type === "APPLICATION_SUBMITTED")?.metadata;
  const submissionSource =
    submissionMetadata && typeof submissionMetadata === "object" && !Array.isArray(submissionMetadata)
      ? submissionMetadata
      : null;
  const submission = submissionSource
    ? {
        pageUrl: typeof submissionSource.pageUrl === "string" ? submissionSource.pageUrl : null,
        pageTitle: typeof submissionSource.pageTitle === "string" ? submissionSource.pageTitle : null,
        confirmationText:
          typeof submissionSource.confirmationText === "string" ? submissionSource.confirmationText : null,
        confirmationNumber:
          typeof submissionSource.confirmationNumber === "string" ? submissionSource.confirmationNumber : null,
        recordedAt: typeof submissionSource.recordedAt === "string" ? submissionSource.recordedAt : null,
      }
    : null;
  const strengths = Array.isArray(app.analysis?.strengths) ? app.analysis.strengths.filter((x): x is string => typeof x === "string") : [];
  const gaps = Array.isArray(app.analysis?.gaps) ? app.analysis.gaps.filter((x): x is string => typeof x === "string") : [];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">
        <Link href="/applications" className="hover:underline">
          ← All applications
        </Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{app.company}</h1>
          <div className="text-slate-600 dark:text-slate-300">{app.role}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={statusColor(app.status)}>{app.status}</Badge>
            <span className="text-xs text-slate-500 dark:text-slate-400">Created {formatDate(app.createdAt)}</span>
            {app.appliedAt && (
              <span className="text-xs text-slate-500 dark:text-slate-400">· Applied {formatDate(app.appliedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/interview?app=${app.id}`}>
              <MessageSquareText className="h-4 w-4" /> Practice interview
            </Link>
          </Button>
          {hasPdf && (
            <Button asChild variant="outline">
              <a href={`/api/applications/${app.id}/resume?format=pdf`} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4" /> View resume
              </a>
            </Button>
          )}
          {hasPdf && (
            <Button asChild variant="outline">
              <a href={`/api/applications/${app.id}/resume?format=pdf&download=1`}>
                <Download className="h-4 w-4" /> PDF
              </a>
            </Button>
          )}
          {hasCoverLetter && (
            <Button asChild variant="outline">
              <a href={`/api/applications/${app.id}/cover-letter?format=pdf`} target="_blank" rel="noreferrer">
                <FileSignature className="h-4 w-4" /> Cover letter
              </a>
            </Button>
          )}
          <ShareButton id={app.id} canShare={hasPdf || hasCoverLetter || !!app.coverLetterText} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <WorkflowPanel
            applicationId={app.id}
            readiness={readiness}
            tasks={sortedTasks}
            hasJobDescription={!!app.jdText && app.jdText.length > 50}
          />

          <ApplicationPreparationPanel
            report={preparationReport}
            taskStatus={preparationTask?.status}
            applyUrl={app.applyUrl}
            submission={submission}
          />

          {app.analysis && (
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Match analysis</CardTitle>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{app.analysis.summary}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display text-3xl font-semibold tabular-nums">{app.analysis.score}%</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                    {app.analysis.recommendation}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">
                    Strengths
                  </div>
                  <ul className="space-y-1.5 text-slate-700 dark:text-slate-300">
                    {strengths.map((strength) => <li key={strength}>• {strength}</li>)}
                    {strengths.length === 0 && <li className="text-slate-400">No supported strengths returned.</li>}
                  </ul>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
                    Gaps
                  </div>
                  <ul className="space-y-1.5 text-slate-700 dark:text-slate-300">
                    {gaps.map((gap) => <li key={gap}>• {gap}</li>)}
                    {gaps.length === 0 && <li className="text-slate-400">No material gaps returned.</li>}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          <JobDescriptionEditor id={app.id} jdUrl={app.jdUrl} jdText={app.jdText} />

          <ApplicationActions
            id={app.id}
            company={app.company}
            role={app.role}
            status={app.status}
            hasJd={!!app.jdText && app.jdText.length > 50}
            hasPdf={hasPdf}
            hasCoverLetter={hasCoverLetter}
            personalizeStatus={app.personalizeStatus}
            applyUrl={app.applyUrl}
          />

          {app.coverLetterText && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Cover letter</CardTitle>
                <a
                  href={`/api/applications/${app.id}/cover-letter?format=pdf&download=1`}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                >
                  <Download className="h-3 w-3" /> Download PDF
                </a>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 max-h-96 overflow-auto rounded border border-slate-100 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950">
                  {app.coverLetterText}
                </div>
              </CardContent>
            </Card>
          )}

          <QuestionAnswerer applicationId={app.id} />

          <ReplyPanel
            applicationId={app.id}
            replies={app.inboundReplies.map((reply) => ({
              id: reply.id,
              fromAddress: reply.fromAddress,
              subject: reply.subject,
              summary: reply.summary,
              classification: reply.classification,
              confidence: reply.confidence,
              receivedAt: reply.receivedAt.toISOString(),
            }))}
          />

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {app.events.map((e) => (
                  <li key={e.id} className="px-4 py-3 text-sm flex items-start gap-3">
                    <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{e.type}</Badge>
                    <div className="flex-1">
                      <div className="text-slate-700 dark:text-slate-300">{e.detail ?? ""}</div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(e.createdAt)}</div>
                    </div>
                  </li>
                ))}
                {app.events.length === 0 && (
                  <li className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">No activity yet.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Outreach</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                href={`/cold-email?company=${encodeURIComponent(app.company)}&role=${encodeURIComponent(app.role)}&applicationId=${app.id}`}
              >
                <Mail className="h-4 w-4" /> Draft cold email to a leader at {app.company}
              </Link>
              {app.emails.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  No emails drafted for this application yet.
                </div>
              ) : (
                <ul className="space-y-2">
                  {app.emails.map((e) => (
                    <li key={e.id} className="border-t border-slate-100 dark:border-slate-800 pt-2 min-w-0">
                      {e.status === "draft" ? (
                        <Link
                          href={`/cold-email?emailId=${e.id}`}
                          className="block truncate font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          title={e.subject}
                        >
                          {e.subject}
                        </Link>
                      ) : (
                        <div className="truncate font-medium" title={e.subject}>
                          {e.subject}
                        </div>
                      )}
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <Badge
                          className={
                            e.status === "sent"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : e.status === "failed"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          }
                        >
                          {e.status}
                        </Badge>
                        <span>{formatDate(e.sentAt ?? e.createdAt)}</span>
                        {e.toAddress && <span className="truncate">→ {e.toAddress}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <FindContacts applicationId={app.id} company={app.company} role={app.role} />

          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {app.contacts.length === 0 ? (
                <div className="text-slate-500 dark:text-slate-400">No contacts linked.</div>
              ) : (
                <ul className="space-y-2">
                  {app.contacts.map((c) => (
                    <li key={c.id} className="border-b border-slate-100 dark:border-slate-800 pb-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">{c.title}</div>
                      {c.email && <div className="text-xs text-slate-500 dark:text-slate-400">{c.email}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
