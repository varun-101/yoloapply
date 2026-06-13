"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2, Pencil, X } from "lucide-react";

// The scraped job description is right most of the time but occasionally wrong
// (truncated, wrong posting, garbled). Since personalization/cold-email draw
// ONLY on this text, the user needs to be able to correct it. Saves via the
// existing PATCH /api/applications/[id] (jdText/jdUrl are whitelisted there).
export default function JobDescriptionEditor({
  id,
  jdUrl,
  jdText,
}: {
  id: string;
  jdUrl: string | null;
  jdText: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(jdUrl ?? "");
  const [text, setText] = useState(jdText ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText: text, jdUrl: url.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setEditing(false);
      // Refresh so the personalize button's hasJd gate and the view reflect the edit.
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setUrl(jdUrl ?? "");
    setText(jdText ?? "");
    setErr(null);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Job description</CardTitle>
        {!editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <label className="block font-mono text-[11px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Posting URL
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-signal/70"
              />
            </label>
            <label className="block font-mono text-[11px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Job description text
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={18}
                placeholder="Paste the full job description here…"
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-sans text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-signal/70"
              />
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Personalization and cold emails draw only on this text — fix anything the scraper got
              wrong before generating a resume.
            </p>
            {err && (
              <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
                {err}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
              </Button>
              <Button variant="ghost" onClick={cancel} disabled={saving}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {jdUrl && (
              <a
                href={jdUrl}
                target="_blank"
                rel="noreferrer"
                title={jdUrl}
                className="flex max-w-full items-center gap-1 text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-2"
              >
                <span className="min-w-0 truncate">{jdUrl}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
            <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 max-h-96 overflow-auto rounded border border-slate-100 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950">
              {jdText ?? <span className="text-slate-400 dark:text-slate-500">No JD text saved.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
