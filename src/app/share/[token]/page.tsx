import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyShareToken } from "@/lib/shareLink";
import { getProfileOrNull } from "@/lib/profile";
import { rateLimit, clientIpFrom } from "@/lib/rateLimit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText, FileSignature } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared application — YOLOapply",
  robots: { index: false, follow: false },
};

// Standalone notice panel — used for expired links and rate-limit refusals.
// The page is public: signed-out visitors get no app rail, so it centers in
// the full viewport.
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-lg bg-signal font-display text-base font-bold text-slate-950">
          Y
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{body}</p>
      </div>
    </div>
  );
}

export default async function SharedApplicationPage({ params }: { params: { token: string } }) {
  // Public endpoint — rate-limit before touching the DB.
  const ip = clientIpFrom(headers());
  const perIp = rateLimit("share-page-ip", ip, 60, 60_000);
  const global = rateLimit("share-page-global", "all", 600, 60_000);
  if (!perIp.ok || !global.ok) {
    return (
      <Notice title="Slow down" body="Too many requests from your network. Try again in a minute." />
    );
  }

  const share = verifyShareToken(params.token);
  if (!share.ok) {
    if (share.reason === "expired") {
      return (
        <Notice
          title="This link has expired"
          body="Share links are time-limited. Ask the candidate for a fresh one."
        />
      );
    }
    notFound();
  }

  const app = await prisma.application.findFirst({
    where: { id: share.applicationId, userId: share.userId },
    select: { company: true, role: true, coverLetterText: true, files: { select: { kind: true } } },
  });
  if (!app) notFound();

  const profile = await getProfileOrNull(share.userId);
  const kinds = new Set(app.files.map((f) => f.kind));
  const hasResume = kinds.has("resume_pdf");
  const hasCoverLetterPdf = kinds.has("cover_letter_pdf");
  const fileUrl = (kind: "resume" | "cover_letter", download?: boolean) =>
    `/api/share/${params.token}/file?kind=${kind}${download ? "&download=1" : ""}`;
  // Embed the resume when it exists, else fall back to the cover letter PDF.
  const embedded = hasResume ? "resume" : hasCoverLetterPdf ? ("cover_letter" as const) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-signal font-display text-sm font-bold text-slate-950">
          Y
        </div>
        <div>
          <div className="font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">
            YOLOapply
          </div>
          <div className="font-mono text-[10px] text-slate-500">shared application</div>
        </div>
      </div>

      <div className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Candidate submission
      </div>
      <h1 className="mt-1 text-3xl font-semibold">{profile?.name ?? app.role}</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-300">
        Applying for {app.role} at {app.company}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {hasResume && (
          <Button asChild variant="outline">
            <a href={fileUrl("resume", true)}>
              <Download className="h-4 w-4" /> Download resume
            </a>
          </Button>
        )}
        {hasResume && (
          <Button asChild variant="outline">
            <a href={fileUrl("resume")} target="_blank" rel="noreferrer">
              <FileText className="h-4 w-4" /> Open resume
            </a>
          </Button>
        )}
        {hasCoverLetterPdf && (
          <Button asChild variant="outline">
            <a href={fileUrl("cover_letter", true)}>
              <FileSignature className="h-4 w-4" /> Download cover letter
            </a>
          </Button>
        )}
      </div>

      {embedded && (
        <iframe
          src={fileUrl(embedded)}
          title={embedded === "resume" ? "Resume" : "Cover letter"}
          className="mt-6 h-[75vh] w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        />
      )}

      {app.coverLetterText && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cover letter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {app.coverLetterText}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="mt-8 font-mono text-[10px] text-slate-400 dark:text-slate-500">
        link expires {share.expiresAt.toISOString().slice(0, 10)} · shared via YOLOapply
      </p>
    </div>
  );
}
