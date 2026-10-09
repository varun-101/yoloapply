"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";

interface SavedAnswer {
  key: string;
  question: string;
  answer: string;
  company?: string;
  candidateStatement: string;
  confirmedAt: string;
}

// Answers agents saved from what you told them (MCP save_candidate_answer).
// Forms reuse them instead of asking again; removing one here means the next
// application asks you again.
export function SavedAnswersCard() {
  const [answers, setAnswers] = useState<SavedAnswer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/saved-answers")
      .then((r) => r.json())
      .then((d) => setAnswers(d.answers ?? []))
      .catch(() => setAnswers([]));
  }, []);

  async function remove(key: string) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch(`/api/settings/saved-answers?key=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Remove failed");
      setAnswers((as) => (as ?? []).filter((a) => a.key !== key));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (answers === null || answers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Answers saved by your agent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Saved from what you told an agent, in your own words. Application forms reuse them instead of asking again.
        </p>
        {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {answers.map((a) => (
            <li key={a.key} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium">{a.question}</div>
                <div className="text-sm text-slate-700 dark:text-slate-300 break-words">{a.answer}</div>
                <div className="mt-1 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                  {a.key}
                  {a.company ? ` · ${a.company} only` : ""} · {new Date(a.confirmedAt).toLocaleDateString()}
                </div>
                {a.candidateStatement && (
                  <div className="mt-1 text-xs italic text-slate-500 dark:text-slate-400 break-words">
                    You said: &ldquo;{a.candidateStatement}&rdquo;
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="w-full md:w-auto shrink-0"
                onClick={() => remove(a.key)}
                disabled={busy === a.key}
                aria-label={`Remove saved answer: ${a.question}`}
              >
                {busy === a.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
