"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useVoice } from "@/components/interview/useVoice";
import {
  Loader2,
  Mic,
  Send,
  Square,
  Volume2,
  Keyboard,
  AlertTriangle,
  RotateCcw,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicSession } from "@/lib/interview/types";

export default function InterviewRoom() {
  const { id } = useParams<{ id: string }>();
  const voice = useVoice();

  const [session, setSession] = useState<PublicSession | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [textMode, setTextMode] = useState(false);
  // When on, a sustained pause after you speak submits the answer (hands-free).
  // Turn it off if you take long pauses — then you submit by tapping "Done".
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now()); // ticks for the live timer

  const spokenForRef = useRef<string | null>(null);
  const autoTriedRef = useRef<string | null>(null); // turns we've auto-started the mic for
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Load (also restores a mid-interview session on refresh) ──────────────
  useEffect(() => {
    fetch(`/api/interview/${id}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error ?? "Could not load this interview.");
        setSession(d.session);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Default to VOICE; fall back to typing only once detection confirms the
  // browser lacks speech recognition (recognitionSupported is false until the
  // mount check runs, so we must wait for recognitionChecked before deciding).
  useEffect(() => {
    if (voice.recognitionChecked) setTextMode(!voice.recognitionSupported);
  }, [voice.recognitionChecked, voice.recognitionSupported]);

  const openTurn = session?.turns.slice().reverse().find((t) => t.answer === null) ?? null;
  const openTurnId = openTurn?.id ?? null;
  const openTurnQuestion = openTurn?.question ?? null;
  const isRunning = session?.status === "running";
  const isDone = session?.status === "completed";

  // Stable callbacks/primitives from the hook (the hook object itself is a fresh
  // reference every render; depending on it would re-fire effects constantly).
  const {
    speak,
    listen,
    stopListening,
    abortListening,
    cancelSpeech,
    recognitionSupported,
    speaking,
    listening,
  } = voice;

  // ── Submit an answer → grade + next interviewer line ─────────────────────
  const submitAnswer = useCallback(
    async (answer: string) => {
      if (!answer.trim()) return;
      setThinking(true);
      setInterim("");
      setTyped("");
      try {
        const res = await fetch(`/api/interview/${id}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Failed to submit answer.");
        setSession(d.session);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        setThinking(false);
      }
    },
    [id]
  );

  // Start capturing the candidate's spoken answer. Safe to call any number of
  // times — the hook aborts any stale recognizer first — so the "Start
  // answering" button can always (re)start the mic, even after a failed attempt.
  const startCapture = useCallback(() => {
    if (textMode || !recognitionSupported) return;
    setInterim("");
    listen({
      bargeIn: true,
      autoEndpoint: autoSubmit,
      onInterim: setInterim,
      onFinal: (text) => void submitAnswer(text),
    });
  }, [textMode, recognitionSupported, autoSubmit, listen, submitAnswer]);

  // Speak each new interviewer question once, then (voice mode) auto-start the mic.
  useEffect(() => {
    if (!started || !isRunning || !openTurnId || !openTurnQuestion) return;
    if (spokenForRef.current === openTurnId) return;
    spokenForRef.current = openTurnId;
    let cancelled = false;
    (async () => {
      await speak(openTurnQuestion);
      if (cancelled || textMode || !recognitionSupported) return;
      autoTriedRef.current = openTurnId;
      startCapture();
    })();
    return () => {
      cancelled = true;
    };
  }, [started, isRunning, openTurnId, openTurnQuestion, textMode, recognitionSupported, speak, startCapture]);

  // Switching to voice on an already-spoken question: auto-start the mic ONCE
  // (autoTriedRef stops an infinite retry loop if the mic is blocked — the
  // candidate then uses the explicit "Start answering" button to retry).
  useEffect(() => {
    if (textMode) {
      // Switching to typing should DISCARD the in-progress mic turn, not submit
      // a half-spoken answer — so abort rather than stop.
      abortListening();
      return;
    }
    if (!started || !isRunning || !openTurnId) return;
    if (speaking || listening) return;
    if (spokenForRef.current !== openTurnId) return; // speak effect will handle it
    if (autoTriedRef.current === openTurnId) return; // already auto-tried; wait for the button
    autoTriedRef.current = openTurnId;
    startCapture();
  }, [textMode, started, isRunning, openTurnId, speaking, listening, abortListening, startCapture]);

  // When the interview is no longer running (completed or ended), make sure
  // nothing keeps talking or listening. The interviewer's closing line is shown
  // in the transcript but NOT re-spoken — re-speaking the last line at the end
  // sounded like a bug.
  useEffect(() => {
    if (!started || isRunning) return;
    stopListening();
    cancelSpeech();
  }, [started, isRunning, stopListening, cancelSpeech]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [session?.turns.length, interim, thinking]);

  // Tick the timer once a second while the interview is running.
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const limitMs = session?.timeLimitMin ? session.timeLimitMin * 60_000 : null;
  const elapsedMs = session ? nowMs - new Date(session.startedAt).getTime() : 0;

  async function endInterview() {
    voice.stopListening();
    voice.cancelSpeech();
    setThinking(true);
    try {
      const res = await fetch(`/api/interview/${id}/finish`, { method: "POST" });
      const d = await res.json();
      if (res.ok) setSession(d.session);
    } finally {
      setThinking(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadErr && !session) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {loadErr}
        </div>
        <Link href="/interview" className="mt-4 inline-block text-sm text-signal underline">
          Back to interview prep
        </Link>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="p-8 flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading interview…
      </div>
    );
  }

  const phase = thinking
    ? "thinking"
    : voice.speaking
    ? "speaking"
    : voice.listening
    ? "listening"
    : "idle";

  return (
    // The room is a fixed-height column with an internally scrolling
    // transcript. On phones that height must discount the top strip, the
    // bottom tab bar and both safe areas — and use dvh, since 100vh on mobile
    // Safari means the *expanded* viewport and would hide the answer box
    // behind the URL bar.
    <div className="p-4 md:p-8 max-w-3xl mx-auto flex flex-col h-[calc(100dvh_-_8.75rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] md:h-[calc(100vh_-_2rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            {session.mode === "company" ? "Company interview" : "General interview"}
          </p>
          <h1 className="text-xl font-semibold">
            {session.company ? `${session.company} — ${session.role}` : "Resume-based mock"}
          </h1>
          {isRunning && (
            <div className="flex items-center gap-3 mt-0.5">
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                Topic {Math.min(session.currentTopic + 1, session.topicCount)} / {session.topicCount}
              </p>
              {limitMs !== null && <TimerChip elapsedMs={elapsedMs} limitMs={limitMs} />}
            </div>
          )}
        </div>
        {isRunning && started && (
          <Button variant="outline" size="sm" onClick={endInterview} disabled={thinking}>
            <Square className="h-3.5 w-3.5" /> End
          </Button>
        )}
      </div>

      {/* Voice controls bar */}
      {started && isRunning && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
          <StatusPill phase={phase} />
          {voice.synthesisSupported && voice.voices.length > 0 && (
            <select
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-mono text-[11px] max-w-[220px]"
              value={voice.voiceId}
              onChange={(e) => voice.setVoiceId(e.target.value)}
            >
              {voice.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.network ? " · network" : ""}
                </option>
              ))}
            </select>
          )}
          {voice.recognitionSupported && !textMode && (
            <label className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSubmit}
                onChange={(e) => setAutoSubmit(e.target.checked)}
                className="h-3.5 w-3.5 accent-signal"
              />
              Auto-submit on pause
            </label>
          )}
          {voice.recognitionSupported && (
            <button
              onClick={() => setTextMode((m) => !m)}
              className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-signal"
            >
              <Keyboard className="h-3.5 w-3.5" />
              {textMode ? "Use voice" : "Type instead"}
            </button>
          )}
        </div>
      )}

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3"
      >
        {!started ? (
          <StartScreen
            recognitionSupported={voice.recognitionSupported}
            onBegin={() => setStarted(true)}
            resuming={session.turns.some((t) => t.answer !== null)}
          />
        ) : (
          <>
            {session.turns
              .map((t) => (
                <div key={t.id} className="space-y-2">
                  <Bubble who="itw" text={t.question} />
                  {t.answer && <Bubble who="you" text={t.answer} />}
                </div>
              ))}
            {interim && !thinking && <Bubble who="you" text={interim} interim />}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> interviewer is thinking…
              </div>
            )}
          </>
        )}

        {isDone && session.report && <Report report={session.report} />}
        {isDone && !session.report && started && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Interview ended.</p>
        )}
      </div>

      {/* Answer input */}
      {started && isRunning && (
        <div className="mt-3">
          {textMode ? (
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitAnswer(typed);
                  }
                }}
                placeholder="Type your answer… (Enter to send)"
                disabled={thinking || voice.speaking}
                className="flex-1"
              />
              <Button onClick={() => void submitAnswer(typed)} disabled={thinking || !typed.trim()}>
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {voice.lastError && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p>{voice.lastError}</p>
                    <button
                      onClick={() => {
                        voice.clearError();
                        setTextMode(true);
                      }}
                      className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200"
                    >
                      <Keyboard className="h-3.5 w-3.5" /> Switch to typing
                    </button>
                  </div>
                </div>
              )}
              <PushToTalk
                voice={voice}
                disabled={thinking}
                autoSubmit={autoSubmit}
                onStart={startCapture}
                onStop={() => voice.stopListening()}
              />
            </div>
          )}
        </div>
      )}

      {isDone && (
        <div className="mt-3 flex gap-2">
          <Link href="/interview">
            <Button variant="outline">
              <RotateCcw className="h-4 w-4" /> New interview
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StartScreen({
  recognitionSupported,
  resuming,
  onBegin,
}: {
  recognitionSupported: boolean;
  resuming: boolean;
  onBegin: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-10">
      <div className="h-14 w-14 rounded-full bg-signal/15 flex items-center justify-center">
        <Volume2 className="h-6 w-6 text-signal" />
      </div>
      <div>
        <p className="text-base font-medium">{resuming ? "Resume your interview" : "Ready when you are"}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
          The interviewer speaks, then listens. Just answer naturally — pause when you're done and it
          takes its turn. You can interrupt it any time.
        </p>
      </div>
      {!recognitionSupported && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 max-w-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          This browser can't capture speech — you'll type your answers. For voice, use Chrome, Edge, or
          Safari.
        </div>
      )}
      <Button onClick={onBegin} size="lg">
        <Mic className="h-4 w-4" /> {resuming ? "Resume" : "Begin"}
      </Button>
    </div>
  );
}

function PushToTalk({
  voice,
  disabled,
  autoSubmit,
  onStart,
  onStop,
}: {
  voice: ReturnType<typeof useVoice>;
  disabled: boolean;
  autoSubmit: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  // Auto-listen is the primary path. When idle (e.g. just switched to voice, or
  // the mic didn't auto-start), the explicit "Start answering" button kicks it
  // off — so the candidate is never stranded on a "Getting ready…" state.
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {voice.speaking
          ? "Interviewer is speaking…"
          : voice.listening
          ? autoSubmit
            ? "Listening… take your time; a longer pause submits, or tap Done."
            : "Listening… tap Done when you've finished your answer."
          : "Tap Start answering when you're ready."}
      </span>
      {voice.listening ? (
        <Button variant="outline" size="sm" disabled={disabled} onClick={onStop}>
          <Send className="h-3.5 w-3.5" /> Done answering
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={disabled || voice.speaking} onClick={onStart}>
          <Mic className="h-3.5 w-3.5" /> Start answering
        </Button>
      )}
    </div>
  );
}

function TimerChip({ elapsedMs, limitMs }: { elapsedMs: number; limitMs: number }) {
  const remaining = Math.max(0, limitMs - elapsedMs);
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const over = elapsedMs >= limitMs;
  const soon = !over && elapsedMs >= limitMs * 0.75;
  const label = over ? "time's up · finishing" : soon ? "wrapping up" : "left";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs",
        over || soon ? "text-signal" : "text-slate-500 dark:text-slate-400"
      )}
    >
      <Clock className="h-3.5 w-3.5" />
      {over ? "0:00" : `${mm}:${String(ss).padStart(2, "0")}`} {label}
    </span>
  );
}

function StatusPill({ phase }: { phase: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    speaking: { label: "interviewer speaking", cls: "text-signal", dot: "bg-signal animate-pulse" },
    listening: { label: "listening", cls: "text-emerald-500", dot: "bg-emerald-500 animate-pulse" },
    thinking: { label: "thinking", cls: "text-slate-500 dark:text-slate-400", dot: "bg-slate-400" },
    idle: { label: "ready", cls: "text-slate-500 dark:text-slate-400", dot: "bg-slate-400" },
  };
  const s = map[phase] ?? map.idle;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono uppercase tracking-wider", s.cls)}>
      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

function Bubble({ who, text, interim }: { who: "itw" | "you"; text: string; interim?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", who === "you" && "items-end")}>
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em]",
          who === "itw" ? "text-signal" : "text-emerald-500"
        )}
      >
        {who === "itw" ? "Interviewer" : "You"}
      </span>
      <span
        className={cn(
          "rounded-xl border px-3.5 py-2 text-sm leading-relaxed max-w-[88%]",
          who === "itw"
            ? "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            : "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40",
          interim && "italic text-slate-500 dark:text-slate-400"
        )}
      >
        {text}
      </span>
    </div>
  );
}

function Report({ report }: { report: NonNullable<PublicSession["report"]> }) {
  const dims = [
    { k: "relevance", label: "Relevance" },
    { k: "specificity", label: "Specificity" },
    { k: "correctness", label: "Correctness" },
    { k: "communication", label: "Communication" },
  ] as const;
  return (
    <Card className="mt-2">
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Overall
            </span>
            <span className="font-display text-4xl font-semibold text-signal leading-none">
              {report.overall}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            {dims.map((d) => (
              <div key={d.k}>
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {d.label}
                </div>
                <div className="font-mono text-lg">{report.dimensions[d.k]}</div>
              </div>
            ))}
          </div>
        </div>

        <ReportList title="Strengths" items={report.strengths} tone="good" />
        <ReportList title="Gaps" items={report.gaps} tone="bad" />
        <ReportList title="Practice before the real thing" items={report.actions} tone="neutral" />

        {report.perTopic?.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-2">
              By topic
            </div>
            <div className="space-y-2">
              {report.perTopic.map((t, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="font-mono text-signal w-8 shrink-0">{t.score}</span>
                  <span>
                    <span className="font-medium">{t.title}</span> —{" "}
                    <span className="text-slate-600 dark:text-slate-300">{t.summary}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "bad" | "neutral";
}) {
  if (!items?.length) return null;
  const dot =
    tone === "good" ? "bg-emerald-500" : tone === "bad" ? "bg-rose-500" : "bg-signal";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-1.5">
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={cn("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", dot)} />
            <span className="text-slate-700 dark:text-slate-200">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
