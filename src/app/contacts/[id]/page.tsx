import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Mail, Paperclip, FileText, AlertCircle, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

function emailStatusBadge(status: string) {
  switch (status) {
    case "sent":
      return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
    case "draft":
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
    case "failed":
      return "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300";
    case "replied":
      return "bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300";
    case "bounced":
      return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300";
    default:
      return "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
  }
}

function attachLabel(src: string | null) {
  if (src === "personalized") return "Personalized resume";
  if (src === "generic") return "Generic resume";
  if (src === "none") return "No attachment";
  return null;
}

export default async function ContactDetail({ params }: { params: { id: string } }) {
  const user = await requirePageUser();
  const c = await prisma.contact.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      emails: { orderBy: { createdAt: "desc" } },
      application: true,
    },
  });
  if (!c) notFound();

  const sentCount = c.emails.filter((e) => e.status === "sent").length;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-2 text-sm text-slate-500 dark:text-slate-400">
        <Link href="/contacts" className="hover:underline">
          ← All contacts
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <div className="text-slate-600 dark:text-slate-300">
            {c.title ? `${c.title} · ` : ""}
            {c.company}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {c.email && (
              <a href={`mailto:${c.email}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                {c.email}
              </a>
            )}
            {c.linkedinUrl && (
              <a
                href={c.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                LinkedIn
              </a>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Added {formatDate(c.createdAt)}</span>
            {c.source === "cold_email_target" && (
              <Badge className="bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300">cold email target</Badge>
            )}
            {c.application && (
              <span>
                · Linked to{" "}
                <Link href={`/applications/${c.application.id}`} className="underline">
                  {c.application.company}
                </Link>
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold">{sentCount}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">{sentCount === 1 ? "email sent" : "emails sent"}</div>
        </div>
      </div>

      {c.notes && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm whitespace-pre-wrap">{c.notes}</CardContent>
        </Card>
      )}

      <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <Mail className="h-4 w-4" /> Email history
      </h2>

      {c.emails.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">No emails to this contact yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {c.emails.map((e) => (
            <Card key={e.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{e.subject}</CardTitle>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    From <span className="font-medium text-slate-700 dark:text-slate-300">{e.fromAddress}</span> →{" "}
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {e.toName ? `${e.toName} <${e.toAddress}>` : e.toAddress}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge className={emailStatusBadge(e.status)}>
                    {e.status === "sent" && <CheckCircle2 className="h-3 w-3 mr-1 inline" />}
                    {e.status === "failed" && <AlertCircle className="h-3 w-3 mr-1 inline" />}
                    {e.status}
                  </Badge>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {e.sentAt ? `Sent ${formatDate(e.sentAt)}` : `Saved ${formatDate(e.createdAt)}`}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-xs uppercase text-slate-500 dark:text-slate-400 mb-1">Body</div>
                  <div className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                    {e.body}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {e.recipientTitle && (
                    <Field label="Recipient title" value={e.recipientTitle} />
                  )}
                  {e.recipientCompany && (
                    <Field label="Recipient company" value={e.recipientCompany} />
                  )}
                  {e.roleTarget && <Field label="Role they were hiring for" value={e.roleTarget} />}
                  {e.applicationId && (
                    <Field
                      label="Linked application"
                      value={
                        <Link href={`/applications/${e.applicationId}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                          Open
                        </Link>
                      }
                    />
                  )}
                  {attachLabel(e.attachSource) && (
                    <Field
                      label="Attachment"
                      value={
                        <span className="flex items-center gap-1">
                          {e.attachSource === "none" ? (
                            <span className="text-slate-500 dark:text-slate-400">none</span>
                          ) : (
                            <>
                              <Paperclip className="h-3 w-3" />
                              {attachLabel(e.attachSource)}
                              {e.attachSource === "generic" && (
                                <a href="/api/resume/file" target="_blank" rel="noreferrer" className="ml-1 text-indigo-600 dark:text-indigo-400 hover:underline">
                                  <FileText className="h-3 w-3 inline" />
                                </a>
                              )}
                              {e.attachSource === "personalized" && e.applicationId && (
                                <a
                                  href={`/api/applications/${e.applicationId}/resume?format=pdf`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  <FileText className="h-3 w-3 inline" />
                                </a>
                              )}
                            </>
                          )}
                        </span>
                      }
                    />
                  )}
                  {e.messageId && <Field label="Message ID" value={<code className="text-xs">{e.messageId}</code>} />}
                </div>

                {e.hookContext && (
                  <div>
                    <div className="text-xs uppercase text-slate-500 dark:text-slate-400 mb-1">Hook / context provided</div>
                    <div className="text-sm whitespace-pre-wrap rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                      {e.hookContext}
                    </div>
                  </div>
                )}

                {e.rationale && (
                  <div>
                    <div className="text-xs uppercase text-slate-500 dark:text-slate-400 mb-1">AI rationale (proof point chosen)</div>
                    <div className="text-sm rounded border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950 p-3">
                      {e.rationale}
                    </div>
                  </div>
                )}

                {e.errorMessage && (
                  <div>
                    <div className="text-xs uppercase text-rose-700 dark:text-rose-300 mb-1">Send error</div>
                    <div className="text-sm rounded border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 p-3 whitespace-pre-wrap">
                      {e.errorMessage}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-slate-800 dark:text-slate-200">{value}</div>
    </div>
  );
}
