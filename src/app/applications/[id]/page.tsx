import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, statusColor } from "@/lib/utils";
import { Download, ExternalLink, FileText, Mail, FileSignature } from "lucide-react";
import ApplicationActions from "./actions";

export const dynamic = "force-dynamic";

export default async function AppDetail({ params }: { params: { id: string } }) {
  const app = await prisma.application.findUnique({
    where: { id: params.id },
    include: { events: { orderBy: { createdAt: "desc" }, take: 20 }, emails: true, contacts: true },
  });
  if (!app) notFound();

  const hasPdf = !!app.resumePdfPath;
  const hasCoverLetter = !!app.coverLetterPdfPath;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/applications" className="hover:underline">
          ← All applications
        </Link>
      </div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{app.company}</h1>
          <div className="text-slate-600">{app.role}</div>
          <div className="mt-2 flex items-center gap-2">
            <Badge className={statusColor(app.status)}>{app.status}</Badge>
            <span className="text-xs text-slate-500">Created {formatDate(app.createdAt)}</span>
            {app.appliedAt && (
              <span className="text-xs text-slate-500">· Applied {formatDate(app.appliedAt)}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Job description</CardTitle>
            </CardHeader>
            <CardContent>
              {app.jdUrl && (
                <a
                  href={app.jdUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-2"
                >
                  {app.jdUrl} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <div className="whitespace-pre-wrap text-sm text-slate-700 max-h-96 overflow-auto rounded border border-slate-100 p-3 bg-slate-50">
                {app.jdText ?? <span className="text-slate-400">No JD text saved.</span>}
              </div>
            </CardContent>
          </Card>

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
                  className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1"
                >
                  <Download className="h-3 w-3" /> Download PDF
                </a>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm text-slate-700 max-h-96 overflow-auto rounded border border-slate-100 p-3 bg-slate-50">
                  {app.coverLetterText}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100">
                {app.events.map((e) => (
                  <li key={e.id} className="px-4 py-3 text-sm flex items-start gap-3">
                    <Badge className="bg-slate-100 text-slate-700">{e.type}</Badge>
                    <div className="flex-1">
                      <div className="text-slate-700">{e.detail ?? ""}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{formatDate(e.createdAt)}</div>
                    </div>
                  </li>
                ))}
                {app.events.length === 0 && (
                  <li className="p-6 text-center text-sm text-slate-400">No activity yet.</li>
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
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                href={`/cold-email?company=${encodeURIComponent(app.company)}&role=${encodeURIComponent(app.role)}&applicationId=${app.id}`}
              >
                <Mail className="h-4 w-4" /> Draft cold email to a leader at {app.company}
              </Link>
              <div className="text-xs text-slate-500">
                {app.emails.length} email{app.emails.length === 1 ? "" : "s"} drafted for this application.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Contacts</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {app.contacts.length === 0 ? (
                <div className="text-slate-500">No contacts linked.</div>
              ) : (
                <ul className="space-y-2">
                  {app.contacts.map((c) => (
                    <li key={c.id} className="border-b border-slate-100 pb-2">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-600">{c.title}</div>
                      {c.email && <div className="text-xs text-slate-500">{c.email}</div>}
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
