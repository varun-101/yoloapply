"use client";
import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Wand2 } from "lucide-react";

function ColdEmailInner() {
  const sp = useSearchParams();
  const [company, setCompany] = useState(sp.get("company") ?? "");
  const [recipientName, setRecipientName] = useState("");
  const [recipientTitle, setRecipientTitle] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(sp.get("email") ?? "");
  const [role, setRole] = useState(sp.get("role") ?? "");
  const [hookContext, setHookContext] = useState("");
  const [applicationId] = useState(sp.get("applicationId") ?? "");

  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [rationale, setRationale] = useState("");
  const [attachResume, setAttachResume] = useState(true);
  const [attachCoverLetter, setAttachCoverLetter] = useState(false);
  const [hasGenericResume, setHasGenericResume] = useState<boolean | null>(null);

  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/resume")
      .then((r) => r.json())
      .then((d) => setHasGenericResume(!!d?.exists))
      .catch(() => setHasGenericResume(false));
  }, []);

  async function generate() {
    setBusy("draft");
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/cold-email/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          recipientName,
          recipientTitle,
          role,
          hookContext,
          applicationId: applicationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setSubject(data.subject);
      setEmailBody(data.body);
      setRationale(data.rationale);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/cold-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipientEmail,
          toName: recipientName,
          subject,
          emailBody,
          applicationId: applicationId || null,
          attachResume,
          attachCoverLetter,
          recipientTitle,
          recipientCompany: company,
          roleTarget: role,
          hookContext,
          rationale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const which =
        data.attachSource === "personalized"
          ? " (personalized resume attached)"
          : data.attachSource === "generic"
          ? " (generic resume attached)"
          : " (no resume attached)";
      setOk(`Sent${which}.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Cold Outreach</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Draft a sharp, specific email to a founder, CEO, or tech lead — then send it from your account.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Company</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Anthropic" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Recipient name</label>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Dario Amodei" />
              </div>
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400">Title</label>
                <Input value={recipientTitle} onChange={(e) => setRecipientTitle(e.target.value)} placeholder="CEO / Head of Eng" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Recipient email</label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="leader@example.com"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Role they&apos;re hiring for (optional)</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Backend Software Engineer" />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Hook / context (recent news, product, etc.)</label>
              <Textarea
                rows={3}
                value={hookContext}
                onChange={(e) => setHookContext(e.target.value)}
                placeholder="Just shipped tool use v2. Hiring for inference team. Etc."
              />
            </div>
            <Button onClick={generate} disabled={busy !== null || !company}>
              {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Draft email
            </Button>
            {rationale && (
              <div className="rounded-md bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 px-3 py-2 text-xs text-indigo-900 dark:text-indigo-200">
                <span className="font-medium">Hook:</span> {rationale}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Body</label>
              <Textarea rows={12} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                className="mt-1"
                checked={attachResume}
                onChange={(e) => setAttachResume(e.target.checked)}
              />
              <span>
                Attach resume.{" "}
                <span className="text-slate-500 dark:text-slate-400">
                  {applicationId
                    ? "Personalized PDF will be used (falls back to the generic resume if no personalized version exists)."
                    : hasGenericResume === false ? (
                        <>
                          No generic resume uploaded yet —{" "}
                          <Link href="/resume" className="underline text-indigo-600 dark:text-indigo-400">
                            upload one
                          </Link>{" "}
                          to attach it to every cold email.
                        </>
                      ) : (
                        "The generic resume will be attached."
                      )}
                </span>
              </span>
            </label>
            {applicationId && (
              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={attachCoverLetter}
                  onChange={(e) => setAttachCoverLetter(e.target.checked)}
                />
                <span>
                  Attach cover letter.{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    Uses the cover letter generated for this application (generate it on the application page first).
                  </span>
                </span>
              </label>
            )}

            {err && <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>}
            {ok && <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{ok}</div>}

            <Button
              onClick={send}
              disabled={busy !== null || !subject || !emailBody || !recipientEmail}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send from {process.env.NEXT_PUBLIC_OWNER_EMAIL ?? "your account"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8">Loading…</div>}>
      <ColdEmailInner />
    </Suspense>
  );
}
