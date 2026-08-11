"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Building2, User, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Persona, RoundType } from "@/lib/interview/types";

interface AppRow {
  id: string;
  company: string;
  role: string;
  jdText: string | null;
}

const PERSONAS: { id: Persona; label: string; blurb: string }[] = [
  { id: "neutral", label: "Neutral", blurb: "Fair, FAANG-style. Pushes but reasonable." },
  { id: "friendly", label: "Friendly", blurb: "Encouraging. Still digs for detail." },
  { id: "stress", label: "Skeptical", blurb: "Hard to satisfy. Pressure-tests you." },
];

const ROUNDS: { id: RoundType; label: string }[] = [
  { id: "mixed", label: "Mixed" },
  { id: "behavioral", label: "Behavioral" },
  { id: "technical", label: "Technical" },
];

const TIME_LIMITS: { id: number | null; label: string }[] = [
  { id: null, label: "No limit" },
  { id: 5, label: "5 min" },
  { id: 10, label: "10 min" },
  { id: 15, label: "15 min" },
  { id: 20, label: "20 min" },
];

export default function InterviewLauncher() {
  const router = useRouter();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [appId, setAppId] = useState<string>(""); // "" = general
  const [persona, setPersona] = useState<Persona>("neutral");
  const [roundType, setRoundType] = useState<RoundType>("mixed");
  const [timeLimitMin, setTimeLimitMin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/applications")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setApps(Array.isArray(d) ? d : []))
      .catch(() => {});
    // Preselect an application when deep-linked from its detail page.
    const pre = new URLSearchParams(window.location.search).get("app");
    if (pre) setAppId(pre);
  }, []);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: appId || null, persona, roundType, timeLimitMin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the interview.");
      router.push(`/interview/${data.session.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal mb-2">
        Interview prep
      </p>
      <h1 className="text-2xl sm:text-3xl font-semibold mb-1">Practice interview</h1>
      <p className="text-slate-500 dark:text-slate-400 mb-6 text-sm">
        A voice mock interview that cross-questions you on your own resume, then debriefs you. Best in
        Chrome, Edge, or Safari (Mac).
      </p>

      <Card className="mb-4">
        <CardContent className="space-y-5 pt-6">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Interview type
            </label>
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => setAppId("")}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                  appId === ""
                    ? "border-signal bg-signal/5"
                    : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600"
                )}
              >
                <User className="h-4 w-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                <span>
                  <span className="block text-sm font-medium">General</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Based on your profile &amp; projects
                  </span>
                </span>
              </button>
              <div
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 transition-colors",
                  appId !== ""
                    ? "border-signal bg-signal/5"
                    : "border-slate-300 dark:border-slate-700"
                )}
              >
                <Building2 className="h-4 w-4 mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                <span className="flex-1">
                  <span className="block text-sm font-medium">Company-specific</span>
                  <select
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                  >
                    <option value="">Pick an application…</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.company} — {a.role}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            </div>
            {appId === "" && apps.length === 0 && (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                No applications yet — a general interview works great. Add one under Applications to
                practice for a specific JD.
              </p>
            )}
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Interviewer style
            </label>
            <div className="grid sm:grid-cols-3 gap-2 mt-2">
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersona(p.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    persona === p.id
                      ? "border-signal bg-signal/5"
                      : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600"
                  )}
                >
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Round
            </label>
            <div className="flex gap-2 mt-2">
              {ROUNDS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRoundType(r.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    roundType === r.id
                      ? "border-signal bg-signal/5 text-signal"
                      : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              Time limit
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {TIME_LIMITS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setTimeLimitMin(t.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    timeLimitMin === t.id
                      ? "border-signal bg-signal/5 text-signal"
                      : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {timeLimitMin
                ? `The interviewer paces the round and wraps up around ${timeLimitMin} minutes, finishing on a natural question.`
                : "Runs until the topics are covered."}
            </p>
          </div>

          {err && (
            <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
              {err}
            </div>
          )}

          <Button onClick={start} disabled={busy} size="lg" className="w-full sm:w-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Start interview
          </Button>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <MessageSquareText className="h-3.5 w-3.5" />
        Runs on your own LLM key. Your mic audio stays in the browser; no audio is sent to our server.
      </p>
    </div>
  );
}
