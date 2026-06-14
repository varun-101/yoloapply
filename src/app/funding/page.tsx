"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Loader2, Mail, RefreshCw, TrendingUp } from "lucide-react";

interface FundedItem {
  company: string;
  amount: string;
  round: string;
  sector: string;
  india: boolean;
  source: string;
  url: string;
  foundAt: string;
  ats: { ats: string; slug: string } | null;
}

const SOURCE_LABEL: Record<string, string> = {
  inc42: "Inc42",
  yourstory: "YourStory",
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || isNaN(ms)) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "today";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

interface RadarResponse {
  items: FundedItem[];
  updatedAt: string | null;
  warming: boolean;
  running: boolean;
}

export default function FundingPage() {
  const [items, setItems] = useState<FundedItem[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // GET the current radar; returns whether a scan is still running so callers
  // can keep polling.
  const pull = useCallback(async (): Promise<boolean> => {
    try {
      const d: RadarResponse = await fetch("/api/discovery/funding").then((r) => r.json());
      setItems(d.items ?? []);
      setUpdatedAt(d.updatedAt ?? null);
      return !!(d.running || d.warming);
    } catch {
      setItems((prev) => prev ?? []);
      return false;
    }
  }, []);

  // Initial load — if a scan is already in flight (or warming on a fresh server),
  // show the scanning state so the poller below takes over.
  useEffect(() => {
    pull().then(setScanning);
  }, [pull]);

  // Poll while a scan runs; stop and report when it finishes.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const running = await pull();
      if (cancelled) return;
      if (!running) {
        setScanning(false);
        setNote("Checked the funding sources.");
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scanning, pull]);

  // Explicit refresh: kick a real source scan, then let the poller track it.
  const refresh = useCallback(async () => {
    if (scanning) return;
    setNote(null);
    setScanning(true);
    try {
      await fetch("/api/discovery/funding", { method: "POST" });
    } catch {
      setScanning(false);
    }
    pull();
  }, [scanning, pull]);

  const onWatch = (items ?? []).filter((f) => f.ats).length;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-1.5">
            Funding radar · india · inc42 + yourstory
          </div>
          <h1 className="text-3xl font-semibold">Funding</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Recently-funded Indian tech startups — fresh raises hire fast. Companies with a live
            careers board fold into Discover automatically; the rest are cold-email targets.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-60"
          title="Re-pull the funding feeds now"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "scanning sources…" : updatedAt ? `updated ${timeAgo(updatedAt)} · refresh` : "refresh"}
        </button>
      </div>

      {scanning && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-amber-800 dark:text-signal">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Pulling the funding feeds and extracting fresh raises — this takes about a minute.
        </div>
      )}
      {note && !scanning && (
        <div className="mb-4 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {note}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-slate-500 dark:text-slate-400">
            {scanning
              ? "Pulling the first batch of raises from the funding feeds…"
              : "No funding rounds picked up yet. Hit refresh to pull the feeds, or wait for the next discovery scan."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-3 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {items.length} recently funded{onWatch > 0 ? ` · ${onWatch} on the watchlist` : ""}
          </div>
          <div className="space-y-2">
            {items.map((f, i) => (
              <Card key={`${f.company}-${i}`}>
                <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <TrendingUp className="h-4 w-4 shrink-0 text-signal" />
                  <span className="font-display text-base font-semibold text-slate-800 dark:text-slate-100">
                    {f.company}
                  </span>
                  {f.amount && (
                    <span className="font-mono text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      {f.amount}
                    </span>
                  )}
                  {f.round && (
                    <Badge className="border border-slate-200 text-[10px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      {f.round}
                    </Badge>
                  )}
                  {f.sector && (
                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{f.sector}</span>
                  )}
                  {f.ats && (
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-signal"
                      title={`Live ${f.ats.ats} board — its roles flow into Discover`}
                    >
                      <CheckCircle2 className="h-3 w-3" /> on watchlist
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {SOURCE_LABEL[f.source] ?? f.source} · {timeAgo(f.foundAt)}
                    </span>
                    <Link
                      href={`/applications/new?company=${encodeURIComponent(f.company)}&source=cold_email`}
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-signal dark:text-slate-400"
                      title="Draft a cold email to this company"
                    >
                      <Mail className="h-3.5 w-3.5" /> Cold email
                    </Link>
                    {f.url && (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-slate-400 hover:text-signal"
                        title="Read the funding news"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
