"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SOURCE_LABEL } from "@/lib/discovery/types";
import { CheckCircle2, ExternalLink, FileSearch, Gauge, History, Loader2, Mail, RadarIcon, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";

interface Lead {
  id: string;
  source: string;
  sources: string | null;
  company: string;
  role: string;
  location: string | null;
  url: string | null;
  jdText: string | null;
  salary: string | null;
  jobType: string | null;
  experience: string | null;
  skills: string | null;
  postedAt: string | null;
  contactEmail: string | null;
  score: number | null;
  scoreReason: string | null;
  status: string;
  applicationId: string | null;
  createdAt: string;
}

// Fit rendered as telemetry: five segments, one per 20 points.
function FitMeter({ score, reason }: { score: number; reason: string | null }) {
  const filled = Math.max(0, Math.min(5, Math.round(score / 20)));
  const tone =
    score >= 75
      ? "bg-emerald-500 dark:bg-emerald-400"
      : score >= 50
      ? "bg-amber-500 dark:bg-amber-400"
      : "bg-slate-400 dark:bg-slate-500";
  const text =
    score >= 75
      ? "text-emerald-700 dark:text-emerald-400"
      : score >= 50
      ? "text-amber-700 dark:text-amber-400"
      : "text-slate-500 dark:text-slate-400";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={reason ?? `Fit score ${score}/100`}
    >
      <span className="flex items-center gap-px">
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-1 rounded-[1px] ${i < filled ? tone : "bg-slate-200 dark:bg-slate-700"}`}
          />
        ))}
      </span>
      <span className={`font-mono text-[11px] font-medium ${text}`}>fit {score}</span>
    </span>
  );
}

interface SourceStat {
  source: string;
  fetched: number;
  created: number;
  duplicates: number;
  alreadyApplied: number;
  error?: string;
}

interface ScanProgress {
  scanRunId: string | null;
  startedAt: string;
  trigger: string;
  phase: string;
  sourcesDone: number;
  sourcesTotal: number;
  created: number;
}

interface ScanStatus {
  status: "running" | "idle";
  progress?: ScanProgress;
  lastRun?: {
    id: string;
    created: number;
    scored: number;
    sourceStats: string | null;
    error: string | null;
  } | null;
}

function elapsed(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

interface LastScan {
  startedAt: string;
  finishedAt: string | null;
  created: number;
}

interface Me {
  isAdmin: boolean;
  canScan: boolean;
}

interface ScoreProgress {
  scanRunId: string | null;
  startedAt: string;
  phase: string;
  scored: number;
}

interface ScoreStatus {
  status: "running" | "idle";
  progress?: ScoreProgress;
  lastRun?: { id: string; scored: number; error: string | null } | null;
}

function isFresh(iso: string | null): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < 24 * 3_600_000;
}

function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

// On phones the filters are a 2-up grid of full-width selects (each one a
// comfortable tap target); from md they shrink back to an inline filter row.
const SELECT_CLS =
  "h-11 md:h-9 w-full md:w-auto min-w-0 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-signal/70";

export default function DiscoverPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [status, setStatus] = useState("new");
  const [source, setSource] = useState("");
  const [jobType, setJobType] = useState("");
  // Default to the last 3 days — the full catalog is thousands of rows; the user
  // can widen the window from the date filter below.
  const [days, setDays] = useState("3");
  // Separate window on when a scan discovered the posting (catalog createdAt).
  const [scannedDays, setScannedDays] = useState("");
  const [sort, setSort] = useState("trust");
  // Free-text search across the loaded catalog (client-side, instant). Matches
  // every common field so a query like "react remote" or a founder's email lands.
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  // Id of the run we're watching, so a completion message is only shown for
  // that run (not a stale older one if the server restarted mid-scan).
  const scanRunIdRef = useRef<string | null>(null);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const canScan = !!(me?.isAdmin || me?.canScan);

  // "Score now" — user-driven fit-scoring of the shared catalog with their key.
  const [scoring, setScoring] = useState(false);
  const [scoreProgress, setScoreProgress] = useState<ScoreProgress | null>(null);
  const [scoreMsg, setScoreMsg] = useState<string | null>(null);
  const [showScoreOpts, setShowScoreOpts] = useState(false);
  const [maxPerScan, setMaxPerScan] = useState(45);
  const [recencyDays, setRecencyDays] = useState(14);

  const loadLastScan = useCallback(async () => {
    try {
      const res = await fetch("/api/discovery/scans?take=1");
      const scans: LastScan[] = await res.json();
      setLastScan(scans[0] ?? null);
    } catch {
      // The indicator is decorative — never block the page on it.
    }
  }, []);

  useEffect(() => {
    loadLastScan();
  }, [loadLastScan]);

  // Who am I (gates the Scan button) + my saved scoring controls.
  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d: Me) => setMe(d))
      .catch(() => {});
    fetch("/api/settings/search")
      .then((r) => r.json())
      .then((d: { prefs?: { scoreMaxPerScan?: number; scoreRecencyDays?: number } }) => {
        if (d.prefs?.scoreMaxPerScan) setMaxPerScan(d.prefs.scoreMaxPerScan);
        if (d.prefs?.scoreRecencyDays) setRecencyDays(d.prefs.scoreRecencyDays);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status });
    if (source) qs.set("source", source);
    if (jobType) qs.set("jobType", jobType);
    if (days) qs.set("days", days);
    if (scannedDays) qs.set("scannedDays", scannedDays);
    if (sort !== "trust") qs.set("sort", sort);
    const res = await fetch(`/api/discovery/leads?${qs}`);
    setLeads(await res.json());
  }, [status, source, jobType, days, scannedDays, sort]);

  useEffect(() => {
    load().catch((e) => setErr(String(e)));
  }, [load]);

  // On page load, restore the progress UI if a scan is already in flight
  // (started before a refresh, or by the scheduled task).
  useEffect(() => {
    fetch("/api/discovery/run")
      .then((r) => r.json())
      .then((d: ScanStatus) => {
        if (d.status === "running" && d.progress) {
          setScanProgress(d.progress);
          if (d.progress.scanRunId) scanRunIdRef.current = d.progress.scanRunId;
          setScanning(true);
        }
      })
      .catch(() => {});
  }, []);

  // Poll for live progress while a scan runs; show the result when it ends.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/discovery/run");
        const data: ScanStatus = await res.json();
        if (cancelled) return;
        if (data.status === "running" && data.progress) {
          setScanProgress(data.progress);
          if (data.progress.scanRunId) scanRunIdRef.current = data.progress.scanRunId;
          return;
        }
        setScanning(false);
        setScanProgress(null);
        const expected = scanRunIdRef.current;
        scanRunIdRef.current = null;
        const last = data.lastRun;
        if (last && (!expected || last.id === expected)) {
          if (last.error && !last.sourceStats) {
            setErr(`Scan failed: ${last.error}`);
          } else {
            const stats: SourceStat[] = last.sourceStats ? JSON.parse(last.sourceStats) : [];
            const parts = stats.map((s) =>
              s.error && s.fetched === 0
                ? `${sourceLabel(s.source)}: failed (${s.error})`
                : `${sourceLabel(s.source)}: ${s.created} new of ${s.fetched}${s.error ? " (some boards failed)" : ""}`
            );
            setScanMsg(`${last.created} new lead${last.created === 1 ? "" : "s"} — ${parts.join(" · ")}`);
          }
        } else if (expected) {
          setErr("The scan did not finish — the server may have restarted mid-run. Check the scan history.");
        }
        await Promise.all([load(), loadLastScan()]);
      } catch {
        // Transient poll failure (e.g. dev server restarting) — keep trying.
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scanning, load, loadLastScan]);

  // Restore an in-flight scoring run after a refresh.
  useEffect(() => {
    fetch("/api/discovery/score")
      .then((r) => r.json())
      .then((d: ScoreStatus) => {
        if (d.status === "running" && d.progress) {
          setScoreProgress(d.progress);
          setScoring(true);
        }
      })
      .catch(() => {});
  }, []);

  // Poll scoring progress; reload leads (with fresh scores) when it ends.
  useEffect(() => {
    if (!scoring) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/discovery/score");
        const data: ScoreStatus = await res.json();
        if (cancelled) return;
        if (data.status === "running" && data.progress) {
          setScoreProgress(data.progress);
          return;
        }
        setScoring(false);
        setScoreProgress(null);
        const last = data.lastRun;
        if (last?.error) {
          // Scoring tolerates partial failure — some postings get retried next run.
          setScoreMsg(
            `Scored ${last.scored} posting${last.scored === 1 ? "" : "s"} — a few couldn't be scored this run and will be retried next time.`
          );
        } else if (last) {
          setScoreMsg(`Scored ${last.scored} posting${last.scored === 1 ? "" : "s"} for you.`);
        }
        await load();
      } catch {
        // Transient poll failure — keep trying.
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scoring, load]);

  async function scoreNow() {
    setErr(null);
    setScoreMsg(null);
    setShowScoreOpts(false);
    try {
      const res = await fetch("/api/discovery/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxPerScan, recencyDays }),
      });
      const data: { status: string; progress?: ScoreProgress; error?: string; code?: string } =
        await res.json();
      if (!res.ok) {
        // Point keyless/profileless users at the right Settings tab.
        if (data.code === "no_llm_key") {
          throw new Error("Add your DeepSeek API key in Settings → Credentials to score postings.");
        }
        if (data.code === "no_profile") {
          throw new Error("Add your profile in Settings → Profile to score postings.");
        }
        throw new Error(data.error ?? "Couldn't start scoring");
      }
      setScoreProgress(data.progress ?? null);
      setScoring(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function scan() {
    setErr(null);
    setScanMsg(null);
    try {
      const res = await fetch("/api/discovery/run", { method: "POST" });
      const data: { status: string; progress?: ScanProgress; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed to start");
      if (data.progress?.scanRunId) scanRunIdRef.current = data.progress.scanRunId;
      setScanProgress(data.progress ?? null);
      setScanning(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function promote(lead: Lead, personalize: boolean) {
    setBusyLead(lead.id);
    setErr(null);
    try {
      const res = await fetch(`/api/discovery/leads/${lead.id}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Promote failed");
      const applicationId: string = data.applicationId;
      if (personalize && lead.jdText) {
        // Fire and forget — the personalize route persists running/failed state,
        // and the application page shows progress.
        fetch(`/api/applications/${applicationId}/personalize`, { method: "POST" }).catch(() => {});
      }
      setLeads((ls) =>
        (ls ?? []).map((l) => (l.id === lead.id ? { ...l, status: "promoted", applicationId } : l))
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLead(null);
    }
  }

  async function fetchJd(lead: Lead) {
    setBusyLead(lead.id);
    setErr(null);
    try {
      const res = await fetch(`/api/discovery/leads/${lead.id}/fetch-jd`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't fetch the job description");
      setLeads((ls) => (ls ?? []).map((l) => (l.id === lead.id ? { ...l, ...data } : l)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLead(null);
    }
  }

  async function dismiss(lead: Lead) {
    setBusyLead(lead.id);
    setErr(null);
    try {
      const res = await fetch(`/api/discovery/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Dismiss failed");
      setLeads((ls) => (ls ?? []).filter((l) => l.id !== lead.id || status === "all"));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLead(null);
    }
  }

  // Each space-separated term must match somewhere in the row (AND), so
  // "react remote" narrows progressively. Sources are matched on both the raw
  // key and the human label. When a query is active we re-rank so the strongest
  // matches (company/role) float above rows that only mention the term deep in
  // their JD text — the existing sort acts as a stable tiebreak.
  const filteredLeads = useMemo(() => {
    if (leads === null) return null;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return leads;

    // Higher weight = more relevant place for a match to land.
    const fields = (lead: Lead): { text: string; weight: number }[] => {
      const sourceKeys = (lead.sources ?? lead.source).split(",");
      return [
        { text: lead.company, weight: 100 },
        { text: lead.role, weight: 60 },
        { text: lead.skills ?? "", weight: 25 },
        { text: lead.location ?? "", weight: 20 },
        { text: lead.contactEmail ?? "", weight: 20 },
        { text: [...sourceKeys, ...sourceKeys.map(sourceLabel)].join(" "), weight: 15 },
        { text: lead.salary ?? "", weight: 10 },
        { text: lead.jobType ?? "", weight: 10 },
        { text: lead.experience ?? "", weight: 10 },
        { text: lead.scoreReason ?? "", weight: 5 },
        { text: lead.jdText ?? "", weight: 1 },
      ].map((f) => ({ text: f.text.toLowerCase(), weight: f.weight }));
    };

    // A lead matches only if EVERY term appears in some field; its relevance is
    // the sum over terms of the best (highest-weight) field that term hit.
    const ranked = leads
      .map((lead, i) => {
        const fs = fields(lead);
        let relevance = 0;
        for (const t of terms) {
          let best = 0;
          for (const f of fs) if (f.text.includes(t)) best = Math.max(best, f.weight);
          if (best === 0) return null; // this term matched nothing → drop the lead
          relevance += best;
        }
        return { lead, relevance, i };
      })
      .filter((r): r is { lead: Lead; relevance: number; i: number } => r !== null);

    // Sort by relevance desc, preserving the incoming order within equal scores.
    ranked.sort((a, b) => b.relevance - a.relevance || a.i - b.i);
    return ranked.map((r) => r.lead);
  }, [leads, query]);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-1.5">
            Lead radar · sheet + jobfound + ats boards + hn
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold">Discover</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            One shared list of fresh postings — everyone sees the same catalog; your fit scores are
            your own.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:gap-3">
          <Link
            href="/discover/history"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            title="Scan history"
          >
            <History className="h-3.5 w-3.5" />
            {lastScan
              ? `last sweep ${timeAgo(lastScan.finishedAt ?? lastScan.startedAt)} · ${lastScan.created} new`
              : "scan history"}
          </Link>

          {/* Score now — every user, with their own controls. */}
          <div className="relative flex-1 md:flex-none">
            <div className="flex">
              <Button
                variant="outline"
                onClick={scoreNow}
                disabled={scoring}
                className="flex-1 rounded-r-none md:flex-none"
                title="Fit-score the catalog with your DeepSeek key"
              >
                {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
                {scoring ? "Scoring…" : "Score now"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowScoreOpts((s) => !s)}
                disabled={scoring}
                className="rounded-l-none border-l-0 px-2"
                title="Scoring options"
                aria-label="Scoring options"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>
            {showScoreOpts && (
              <div className="absolute right-0 z-20 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg space-y-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                  Scoring controls
                </div>
                <label className="block text-xs text-slate-600 dark:text-slate-300">
                  Max postings to score
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={maxPerScan}
                    onChange={(e) => setMaxPerScan(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                    className="mt-1 w-full h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-signal/70"
                  />
                </label>
                <label className="block text-xs text-slate-600 dark:text-slate-300">
                  Only postings newer than
                  <select
                    value={recencyDays}
                    onChange={(e) => setRecencyDays(Number(e.target.value))}
                    className={`mt-1 w-full ${SELECT_CLS}`}
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                  </select>
                </label>
                <Button className="w-full" onClick={scoreNow} disabled={scoring}>
                  <Gauge className="h-4 w-4" /> Score now
                </Button>
              </div>
            )}
          </div>

          {canScan && (
            <Button className="flex-1 md:flex-none" onClick={scan} disabled={scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadarIcon className="h-4 w-4" />}
              {scanning ? "Scanning…" : "Scan now"}
            </Button>
          )}
        </div>
      </div>

      {scanning && (
        <div className="relative mb-4 flex items-center gap-2 overflow-hidden rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-amber-800 dark:text-signal">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span className="absolute inset-x-0 bottom-0 h-0.5">
            <span className="absolute h-full w-1/4 animate-sweep rounded-full bg-signal" />
          </span>
          <span>
            Scan in progress
            {scanProgress && scanProgress.trigger !== "manual" ? " (started by the scheduled task)" : ""} —{" "}
            {scanProgress?.phase ?? "starting"}
            {scanProgress?.phase === "fetching sources" &&
              ` (${scanProgress.sourcesDone}/${scanProgress.sourcesTotal} sources done)`}
            {scanProgress && scanProgress.created > 0 &&
              ` · ${scanProgress.created} new lead${scanProgress.created === 1 ? "" : "s"} so far`}
            {scanProgress && ` · running for ${elapsed(scanProgress.startedAt)}`}
          </span>
        </div>
      )}
      {scanMsg && (
        <div className="mb-4 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {scanMsg}
        </div>
      )}
      {scoring && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-amber-800 dark:text-signal">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>
            Scoring the catalog with your DeepSeek key
            {scoreProgress && scoreProgress.scored > 0
              ? ` · ${scoreProgress.scored} scored so far`
              : ""}
            {scoreProgress && ` · running for ${elapsed(scoreProgress.startedAt)}`}
          </span>
        </div>
      )}
      {scoreMsg && (
        <div className="mb-4 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {scoreMsg}
        </div>
      )}
      {err && (
        <div className="mb-4 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}

      <div className="relative mb-3 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search company, role, location, skills, JD…"
          className="h-11 md:h-9 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-9 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-signal/70"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 md:flex md:flex-wrap">
        <select className={SELECT_CLS} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="new">New</option>
          <option value="promoted">Promoted</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
        <select className={SELECT_CLS} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          <option value="sheet">Freshers Sheet</option>
          <option value="jobfound">JobFound</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="ashby">Ashby</option>
          <option value="hn">HN Who&apos;s Hiring</option>
          <option value="weworkremotely">WeWorkRemotely</option>
          <option value="remoteok">RemoteOK</option>
          <option value="remotive">Remotive</option>
        </select>
        <select className={SELECT_CLS} value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">Any date</option>
          <option value="1">Today</option>
          <option value="3">Last 3 days</option>
          <option value="7">Last 7 days</option>
        </select>
        <select
          className={SELECT_CLS}
          value={scannedDays}
          onChange={(e) => setScannedDays(e.target.value)}
          title="Filter by when a scan discovered the posting"
        >
          <option value="">Recently scanned: any</option>
          <option value="1">Scanned today</option>
          <option value="3">Scanned ≤ 3 days</option>
          <option value="7">Scanned ≤ 7 days</option>
        </select>
        <select className={SELECT_CLS} value={jobType} onChange={(e) => setJobType(e.target.value)}>
          <option value="">Any type</option>
          <option value="Full Time">Full Time</option>
          <option value="Internship">Internship</option>
        </select>
        <select className={SELECT_CLS} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="trust">Trusted sources first</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="score">Best fit first</option>
          <option value="company">Company A–Z</option>
        </select>
      </div>

      {filteredLeads === null ? (
        <div className="p-12 text-center text-slate-400 dark:text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      ) : filteredLeads.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {query ? (
              <>
                No leads match <span className="font-medium">“{query}”</span>. Try a different search
                or clear it.
              </>
            ) : (
              <>
                No leads match these filters. Hit <span className="font-medium">Scan now</span> to
                pull fresh postings.
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredLeads.map((lead) => (
            <Card key={lead.id}>
              <CardContent className="p-4">
                {/* Phones stack: details first, then a full-width action row.
                    Side-by-side (the md layout) starved the text column on a
                    390px screen — the title wrapped one word per line under
                    the buttons. */}
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{lead.company}</span>
                      <span className="text-slate-600 dark:text-slate-300">· {lead.role}</span>
                      {isFresh(lead.postedAt) && (
                        <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                          fresh
                        </Badge>
                      )}
                      {lead.score !== null && <FitMeter score={lead.score} reason={lead.scoreReason} />}
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2.5 flex-wrap">
                      <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {(lead.sources ?? lead.source).split(",").map(sourceLabel).join(" + ")}
                      </Badge>
                      {lead.jobType && <span>{lead.jobType}</span>}
                      {lead.location && <span>{lead.location}</span>}
                      {lead.salary && <span>{lead.salary}</span>}
                      <span title={lead.postedAt ?? undefined}>{timeAgo(lead.postedAt)}</span>
                      {lead.url ? (
                        <a
                          href={lead.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:underline"
                        >
                          posting <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-rose-500 dark:text-rose-400">no link in source</span>
                      )}
                    </div>
                    {lead.scoreReason && (
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 italic">{lead.scoreReason}</div>
                    )}
                    {lead.skills && (
                      <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 truncate">{lead.skills}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:flex-nowrap">
                    {lead.contactEmail && lead.status !== "dismissed" && (
                      <Button asChild size="sm" variant="outline" className="w-full md:w-auto" title={`Cold email ${lead.contactEmail}`}>
                        <Link
                          href={`/cold-email?company=${encodeURIComponent(lead.company)}&role=${encodeURIComponent(lead.role)}&email=${encodeURIComponent(lead.contactEmail)}${lead.applicationId ? `&applicationId=${lead.applicationId}` : ""}`}
                        >
                          <Mail className="h-4 w-4" /> Cold email
                        </Link>
                      </Button>
                    )}
                    {lead.status === "promoted" && lead.applicationId ? (
                      <Button asChild variant="outline" size="sm" className="w-full md:w-auto">
                        <Link href={`/applications/${lead.applicationId}`}>
                          <CheckCircle2 className="h-4 w-4" /> View application
                        </Link>
                      </Button>
                    ) : lead.status === "dismissed" ? (
                      <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">dismissed</Badge>
                    ) : (
                      <>
                        {lead.jdText ? (
                          <Button
                            size="sm"
                            className="w-full md:w-auto"
                            onClick={() => promote(lead, true)}
                            disabled={busyLead === lead.id}
                          >
                            {busyLead === lead.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            Promote + Personalize
                          </Button>
                        ) : lead.url ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full md:w-auto"
                            onClick={() => fetchJd(lead)}
                            disabled={busyLead === lead.id}
                            title="Fetch the posting and extract the job description"
                          >
                            {busyLead === lead.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileSearch className="h-4 w-4" />
                            )}
                            Fetch JD
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant={lead.jdText || lead.url ? "outline" : "default"}
                          className="flex-1 md:flex-none"
                          onClick={() => promote(lead, false)}
                          disabled={busyLead === lead.id}
                        >
                          Promote
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          onClick={() => dismiss(lead)}
                          disabled={busyLead === lead.id}
                          title="Dismiss"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
