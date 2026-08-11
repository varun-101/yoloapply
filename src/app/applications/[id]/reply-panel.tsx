"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareReply, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

interface ReplySummary {
  id: string;
  fromAddress: string;
  subject: string;
  summary: string;
  classification: string;
  confidence: number;
  receivedAt: string;
}

export default function ReplyPanel({ applicationId, replies }: { applicationId: string; replies: ReplySummary[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/${applicationId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "manual", fromAddress, subject, body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record reply.");
      setOpen(false);
      setFromAddress("");
      setSubject("");
      setBody("");
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Replies</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          <MessageSquareReply className="h-4 w-4" /> Record reply
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {open && (
          <form className="space-y-2 rounded border border-slate-200 dark:border-slate-800 p-3" onSubmit={submit}>
            <Input type="email" required value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="Sender email" />
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
            <Textarea required rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Paste the reply body" />
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy || !fromAddress || !body}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Classify and record
              </Button>
              <span className="text-xs text-slate-500">Recording a reply cancels pending follow-ups.</span>
            </div>
            {error && <div className="text-xs text-rose-700 dark:text-rose-300">{error}</div>}
          </form>
        )}

        {replies.length === 0 ? (
          <div className="text-sm text-slate-500">No replies recorded.</div>
        ) : (
          <ul className="space-y-3">
            {replies.map((reply) => (
              <li key={reply.id} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{reply.subject || "Reply"}</div>
                  <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {reply.classification.toLowerCase().replaceAll("_", " ")}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500">From {reply.fromAddress} · {Math.round(reply.confidence * 100)}% confidence</div>
                <div className="mt-2 text-slate-600 dark:text-slate-300">{reply.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
