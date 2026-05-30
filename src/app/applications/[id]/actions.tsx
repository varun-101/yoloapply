"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2, Send, CheckCircle2, Globe, FileSignature } from "lucide-react";

const STATUSES = ["draft", "personalized", "applied", "replied", "interview", "offer", "rejected", "closed"];

export default function ApplicationActions(props: {
  id: string;
  company: string;
  role: string;
  status: string;
  hasJd: boolean;
  hasPdf: boolean;
  hasCoverLetter: boolean;
  applyUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function personalize() {
    setBusy("personalize");
    setErr(null);
    try {
      const res = await fetch(`/api/applications/${props.id}/personalize`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(s: string) {
    setBusy("status");
    try {
      await fetch(`/api/applications/${props.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: s }),
      });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  async function coverLetter() {
    setBusy("cover");
    setErr(null);
    try {
      const res = await fetch(`/api/applications/${props.id}/cover-letter`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function autoApply() {
    setBusy("apply");
    setErr(null);
    try {
      const res = await fetch(`/api/applications/${props.id}/auto-apply`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={personalize} disabled={!props.hasJd || busy !== null}>
            {busy === "personalize" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {props.hasPdf ? "Re-personalize resume" : "Personalize resume"}
          </Button>
          <Button onClick={coverLetter} disabled={busy !== null} variant="outline">
            {busy === "cover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
            {props.hasCoverLetter ? "Regenerate cover letter" : "Generate cover letter"}
          </Button>
          <Button onClick={autoApply} disabled={!props.applyUrl || !props.hasPdf || busy !== null} variant="outline">
            {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            Auto-apply (Playwright)
          </Button>
          <Button onClick={() => setStatus("applied")} disabled={busy !== null} variant="outline">
            <Send className="h-4 w-4" /> Mark applied
          </Button>
          <Button onClick={() => setStatus("interview")} disabled={busy !== null} variant="outline">
            <CheckCircle2 className="h-4 w-4" /> Mark interview
          </Button>
        </div>

        {err && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>
        )}

        <div className="flex items-center gap-2 text-sm pt-2">
          <span className="text-slate-500">Status</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
            value={props.status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {!props.hasJd && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Add at least a paragraph of JD text before personalizing.
          </div>
        )}
        {!props.applyUrl && (
          <div className="text-xs text-slate-500">
            Add an <code>applyUrl</code> (the actual portal URL) to enable auto-apply.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
