"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SOURCE_LABEL } from "@/lib/discovery/types";
import { CheckCircle2, ExternalLink, FileSearch, Loader2, Mail, RadarIcon, Sparkles, X } from "lucide-react";

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

function scoreColor(score: number): string {
  if (score >= 75) return "bg-emerald-100 text-emerald-800";
  if (score >= 50) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

interface RunResult {
  created: number;
  sources: { source: string; fetched: number; created: number; duplicates: number; alreadyApplied: number; error?: string }[];
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

function isFresh(iso: string | null): boolean {
  return !!iso && Date.now() - new Date(iso).getTime() < 24 * 3_600_000;
}

function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

const SELECT_CLS =
  "h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400";

export default function DiscoverPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [status, setStatus] = useState("new");
  const [source, setSource] = useState("");
  const [jobType, setJobType] = useState("");
  const [days, setDays] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [busyLead, setBusyLead] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status });
    if (source) qs.set("source", source);
    if (jobType) qs.set("jobType", jobType);
    if (days) qs.set("days", days);
    const res = await fetch(`/api/discovery/leads?${qs}`);
    setLeads(await res.json());
  }, [status, source, jobType, days]);

  useEffect(() => {
    load().catch((e) => setErr(String(e)));
  }, [load]);

  async function scan() {
    setScanning(true);
    setErr(null);
    setScanMsg(null);
    try {
      const res = await fetch("/api/discovery/run", { method: "POST" });
      const data: RunResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      const parts = data.sources.map((s) =>
        s.error
          ? `${sourceLabel(s.source)}: failed (${s.error})`
          : `${sourceLabel(s.source)}: ${s.created} new of ${s.fetched}`
      );
      setScanMsg(`${data.created} new lead${data.created === 1 ? "" : "s"} — ${parts.join(" · ")}`);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
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

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Discover</h1>
          <p className="text-sm text-slate-500">
            Fresh postings from your trusted sources — apply early, get reviewed first.
          </p>
        </div>
        <Button onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadarIcon className="h-4 w-4" />}
          {scanning ? "Scanning…" : "Scan now"}
        </Button>
      </div>

      {scanMsg && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {scanMsg}
        </div>
      )}
      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
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
        </select>
        <select className={SELECT_CLS} value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">Any date</option>
          <option value="1">Today</option>
          <option value="3">Last 3 days</option>
          <option value="7">Last 7 days</option>
        </select>
        <select className={SELECT_CLS} value={jobType} onChange={(e) => setJobType(e.target.value)}>
          <option value="">Any type</option>
          <option value="Full Time">Full Time</option>
          <option value="Internship">Internship</option>
        </select>
      </div>

      {leads === null ? (
        <div className="p-12 text-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500">
            No leads match these filters. Hit <span className="font-medium">Scan now</span> to pull
            fresh postings.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => (
            <Card key={lead.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{lead.company}</span>
                      <span className="text-slate-600">· {lead.role}</span>
                      {isFresh(lead.postedAt) && (
                        <Badge className="bg-emerald-100 text-emerald-800">fresh</Badge>
                      )}
                      {lead.score !== null && (
                        <Badge className={scoreColor(lead.score)} title={lead.scoreReason ?? undefined}>
                          fit {lead.score}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                      <Badge className="bg-amber-100 text-amber-800">
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
                          className="inline-flex items-center gap-1 text-slate-600 hover:underline"
                        >
                          posting <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-rose-500">no link in source</span>
                      )}
                    </div>
                    {lead.scoreReason && (
                      <div className="mt-1 text-xs text-slate-500 italic">{lead.scoreReason}</div>
                    )}
                    {lead.skills && (
                      <div className="mt-1 text-xs text-slate-400 truncate">{lead.skills}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lead.contactEmail && lead.status !== "dismissed" && (
                      <Button asChild size="sm" variant="outline" title={`Cold email ${lead.contactEmail}`}>
                        <Link
                          href={`/cold-email?company=${encodeURIComponent(lead.company)}&role=${encodeURIComponent(lead.role)}&email=${encodeURIComponent(lead.contactEmail)}${lead.applicationId ? `&applicationId=${lead.applicationId}` : ""}`}
                        >
                          <Mail className="h-4 w-4" /> Cold email
                        </Link>
                      </Button>
                    )}
                    {lead.status === "promoted" && lead.applicationId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/applications/${lead.applicationId}`}>
                          <CheckCircle2 className="h-4 w-4" /> View application
                        </Link>
                      </Button>
                    ) : lead.status === "dismissed" ? (
                      <Badge className="bg-slate-100 text-slate-500">dismissed</Badge>
                    ) : (
                      <>
                        {lead.jdText ? (
                          <Button
                            size="sm"
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
                          onClick={() => promote(lead, false)}
                          disabled={busyLead === lead.id}
                        >
                          Promote
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
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
