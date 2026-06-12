"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SCAN_STALE_MS, SOURCE_LABEL } from "@/lib/discovery/types";
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";

interface ScanRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  created: number;
  scored: number;
  sourceStats: string | null;
  error: string | null;
  _count: { leads: number };
}

interface SourceStat {
  source: string;
  fetched: number;
  created: number;
  duplicates: number;
  alreadyApplied: number;
  error?: string;
}

interface ScanLead {
  id: string;
  source: string;
  company: string;
  role: string;
  location: string | null;
  url: string | null;
  score: number | null;
  status: string;
  applicationId: string | null;
}

function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// An open run (finishedAt null) is in flight if it started recently; older
// open rows belong to a process that died mid-run.
function isRunning(run: ScanRun): boolean {
  return !run.finishedAt && Date.now() - new Date(run.startedAt).getTime() < SCAN_STALE_MS;
}

function duration(run: ScanRun): string {
  if (!run.finishedAt && !isRunning(run)) return "did not finish";
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const s = Math.round((end - new Date(run.startedAt).getTime()) / 1000);
  const txt = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  return run.finishedAt ? txt : `${txt} so far`;
}

function scoreColor(score: number): string {
  if (score >= 75) return "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300";
  if (score >= 50) return "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300";
  return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";
}

export default function ScanHistoryPage() {
  const [scans, setScans] = useState<ScanRun[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [leadsByScan, setLeadsByScan] = useState<Record<string, ScanLead[] | "loading">>({});

  const loadScans = useCallback(() => {
    return fetch("/api/discovery/scans")
      .then((r) => r.json())
      .then(setScans)
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    loadScans();
  }, [loadScans]);

  // Live-update the list while a scan is in flight.
  useEffect(() => {
    if (!scans?.some(isRunning)) return;
    const id = setInterval(loadScans, 5000);
    return () => clearInterval(id);
  }, [scans, loadScans]);

  async function toggle(run: ScanRun) {
    const next = !open[run.id];
    setOpen((o) => ({ ...o, [run.id]: next }));
    if (next && !leadsByScan[run.id]) {
      setLeadsByScan((m) => ({ ...m, [run.id]: "loading" }));
      try {
        const res = await fetch(`/api/discovery/leads?status=all&scanRunId=${run.id}&sort=score`);
        const leads: ScanLead[] = await res.json();
        setLeadsByScan((m) => ({ ...m, [run.id]: leads }));
      } catch (e) {
        setErr(String(e));
      }
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link
          href="/discover"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Discover
        </Link>
        <h1 className="text-2xl font-semibold">Scan history</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every discovery scan and the job listings it brought in. Leads ingested before history
          tracking aren&apos;t attached to a scan.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}

      {scans === null ? (
        <div className="p-12 text-center text-slate-400 dark:text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      ) : scans.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No scans recorded yet. Run <span className="font-medium">Scan now</span> on the
            Discover page.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {scans.map((run) => {
            const stats: SourceStat[] = run.sourceStats ? JSON.parse(run.sourceStats) : [];
            const leads = leadsByScan[run.id];
            const running = isRunning(run);
            const failed =
              !running && (!run.finishedAt || (run.error && run.created === 0 && !run.sourceStats));
            return (
              <Card key={run.id}>
                <CardContent className="p-4">
                  <button className="w-full text-left" onClick={() => toggle(run)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      {open[run.id] ? (
                        <ChevronDown className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400 dark:text-slate-500 shrink-0" />
                      )}
                      <span className="font-medium">{when(run.startedAt)}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500">{timeAgo(run.startedAt)}</span>
                      {running ? (
                        <Badge className="bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300">
                          <Loader2 className="h-3 w-3 animate-spin mr-1" /> running
                        </Badge>
                      ) : (
                        <Badge
                          className={
                            failed
                              ? "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300"
                              : run.created > 0
                                ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                          }
                        >
                          {failed ? "failed" : `${run.created} new lead${run.created === 1 ? "" : "s"}`}
                        </Badge>
                      )}
                      <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {run.trigger === "manual" ? "manual" : "scheduled"}
                      </Badge>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {duration(run)}
                        {run.scored > 0 && ` · ${run.scored} scored`}
                      </span>
                    </div>
                    {stats.length > 0 && (
                      <div className="mt-1 ml-6 text-xs text-slate-500 dark:text-slate-400">
                        {stats
                          .map((s) =>
                            s.error && s.fetched === 0
                              ? `${sourceLabel(s.source)}: failed`
                              : `${sourceLabel(s.source)}: ${s.created} new of ${s.fetched}${s.error ? " ⚠" : ""}`
                          )
                          .join(" · ")}
                      </div>
                    )}
                    {run.error && (
                      <div className="mt-1 ml-6 text-xs text-rose-600 dark:text-rose-400">{run.error}</div>
                    )}
                  </button>

                  {open[run.id] && (
                    <div className="mt-3 ml-6 border-t border-slate-100 dark:border-slate-800 pt-3">
                      {leads === "loading" || !leads ? (
                        <div className="text-sm text-slate-400 dark:text-slate-500 py-2">
                          <Loader2 className="h-4 w-4 animate-spin inline" /> Loading leads…
                        </div>
                      ) : leads.length === 0 ? (
                        <div className="text-sm text-slate-400 dark:text-slate-500 py-1">
                          No leads were added by this scan.
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {leads.map((l) => (
                            <div key={l.id} className="flex items-center gap-2 text-sm flex-wrap">
                              <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                {sourceLabel(l.source)}
                              </Badge>
                              <span className="font-medium">{l.company}</span>
                              <span className="text-slate-600 dark:text-slate-300">· {l.role}</span>
                              {l.location && (
                                <span className="text-xs text-slate-400 dark:text-slate-500">{l.location}</span>
                              )}
                              {l.score !== null && (
                                <Badge className={scoreColor(l.score)}>fit {l.score}</Badge>
                              )}
                              {l.status === "promoted" && l.applicationId ? (
                                <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs">
                                  <Link href={`/applications/${l.applicationId}`}>application</Link>
                                </Button>
                              ) : l.status === "dismissed" ? (
                                <span className="text-xs text-slate-400 dark:text-slate-500">dismissed</span>
                              ) : null}
                              {l.url && (
                                <a
                                  href={l.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:underline"
                                >
                                  posting <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
