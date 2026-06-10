"use client";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Copy, Trash2, Check } from "lucide-react";

interface QaItem {
  id: string;
  question: string;
  answer: string;
  confidence?: string;
  note?: string;
  createdAt: number;
}

export default function QuestionAnswerer({ applicationId }: { applicationId: string }) {
  const storageKey = `yolo-qa:${applicationId}`;
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Per-application history persists across refresh via localStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  function persist(next: QaItem[]) {
    setHistory(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next.slice(0, 50)));
    } catch {
      /* ignore */
    }
  }

  async function generate() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/answer-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, applicationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      const item: QaItem = {
        id: `qa_${Date.now()}`,
        question: q,
        answer: data.answer ?? "",
        confidence: data.confidence,
        note: data.note,
        createdAt: Date.now(),
      };
      persist([item, ...history]);
      setQuestion("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(item: QaItem) {
    try {
      await navigator.clipboard.writeText(item.answer);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = item.answer;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1200);
  }

  function remove(id: string) {
    persist(history.filter((h) => h.id !== id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          Answer an open-ended question
        </CardTitle>
        {history.length > 0 && (
          <button
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:underline"
            onClick={() => persist([])}
          >
            clear all
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Answers use this application&apos;s company, role, and job description as context, plus your profile and
          projects — so they&apos;re tailored, not generic.
        </p>
        <Textarea
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Why do you want to work here? Describe a project relevant to this role. What's your biggest strength?"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") generate();
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            onClick={generate}
            disabled={busy || !question.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate answer
          </Button>
          <span className="text-xs text-slate-400 dark:text-slate-500">Ctrl/⌘ + Enter</span>
        </div>

        {err && (
          <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>
        )}

        {history.length > 0 && (
          <ul className="space-y-3 pt-1">
            {history.map((item) => (
              <li key={item.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
                <div className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-1">{item.question}</div>
                <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 rounded border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 max-h-60 overflow-auto">
                  {item.answer}
                </div>
                {item.note && (
                  <div className="mt-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded px-2 py-1">
                    {item.note}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {item.confidence ? `confidence: ${item.confidence}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                      onClick={() => copy(item)}
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="h-3 w-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy
                        </>
                      )}
                    </button>
                    <button
                      className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                      onClick={() => remove(item.id)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
