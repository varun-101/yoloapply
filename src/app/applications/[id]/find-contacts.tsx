"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";

interface Contact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: string;
  sources: string | null;
  confidence: number;
  verified: boolean;
  verifyMethod: string | null;
  seniorityRank: number;
}

interface Status {
  domain: string | null;
  company: string;
  status: "idle" | "running" | "completed" | "failed" | "no_domain";
  pattern: string | null;
  error: string | null;
  enrichedAt: string | null;
  contacts: Contact[];
}

const SOURCE_LABEL: Record<string, string> = {
  lead: "from listing",
  apollo: "Apollo",
  site: "company site",
  github: "GitHub",
  hn: "HN post",
  portfolio: "portfolio",
  role_inbox: "role inbox",
  pattern: "pattern guess",
};

function draftHref(applicationId: string, company: string, role: string, c: Contact): string {
  const q = new URLSearchParams({ applicationId, company, role });
  if (c.email) q.set("email", c.email);
  if (c.name) q.set("name", c.name);
  if (c.title) q.set("title", c.title);
  return `/cold-email?${q.toString()}`;
}

export default function FindContacts({
  applicationId,
  company,
  role,
}: {
  applicationId: string;
  company: string;
  role: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollByDomain = useCallback(
    (domain: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/contacts/find?domain=${encodeURIComponent(domain)}`);
          const d: Status = await r.json();
          setStatus(d);
          if (d.status !== "running") stopPolling();
        } catch {
          /* keep polling; transient */
        }
      }, 2500);
    },
    [stopPolling]
  );

  // On mount: restore any in-flight/completed run for this application's domain
  // WITHOUT kicking a new one (GET resolves the domain, never starts work).
  useEffect(() => {
    let alive = true;
    fetch(`/api/contacts/find?applicationId=${applicationId}`)
      .then((r) => r.json())
      .then((d: Status) => {
        if (!alive) return;
        setStatus(d);
        if (d.status === "running" && d.domain) pollByDomain(d.domain);
      })
      .catch(() => {});
    return () => {
      alive = false;
      stopPolling();
    };
  }, [applicationId, pollByDomain, stopPolling]);

  async function find(force = false) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/contacts/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, force }),
      });
      const d: Status = await r.json();
      if (!r.ok) throw new Error((d as unknown as { error?: string }).error ?? "Failed");
      setStatus(d);
      if (d.status === "running" && d.domain) pollByDomain(d.domain);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const running = status?.status === "running";
  const contacts = status?.contacts ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" /> Find contacts
        </CardTitle>
        {status?.status === "completed" && (
          <button
            onClick={() => find(true)}
            disabled={busy || running}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 hover:text-signal disabled:opacity-50"
            title="Re-run the search"
          >
            <RefreshCw className={`h-3 w-3 ${running ? "animate-spin" : ""}`} /> refresh
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!status || status.status === "idle" ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Search the company site, GitHub, hiring inboxes{status ? "" : ""} (and Apollo / personal sites if
              you&apos;ve added those keys) for founder &amp; HR emails to cold-email.
            </p>
            <Button onClick={() => find(false)} disabled={busy} className="bg-signal text-slate-950 hover:bg-signal/90">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Find contacts at {company}
            </Button>
          </>
        ) : null}

        {running && (
          <div className="flex items-center gap-2 rounded-md border border-signal/30 bg-signal/10 px-3 py-2 text-xs text-amber-900 dark:text-signal">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Searching {status?.domain ?? company}… this keeps running if you leave the page.
          </div>
        )}

        {status?.status === "no_domain" && (
          <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {status.error}
          </div>
        )}
        {status?.status === "failed" && (
          <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            Search failed: {status.error}
            <Button variant="outline" size="sm" className="mt-2" onClick={() => find(true)} disabled={busy}>
              <RefreshCw className="h-3 w-3" /> Try again
            </Button>
          </div>
        )}
        {err && (
          <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {err}
          </div>
        )}

        {(status?.status === "completed" || (contacts.length > 0 && running)) && (
          <>
            {contacts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No contacts found for {status?.domain}. Try adding an Apollo key in Settings → Credentials for the
                people-DB lane.
              </p>
            ) : (
              <ul className="space-y-2">
                {contacts.map((c, i) => (
                  <li
                    key={`${c.email ?? c.name ?? i}`}
                    className="rounded-md border border-slate-100 dark:border-slate-800 p-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.name ?? c.email ?? "—"}</div>
                        {c.title && <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{c.title}</div>}
                        {c.email ? (
                          <div className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">{c.email}</div>
                        ) : (
                          <div className="font-mono text-[11px] text-slate-400 dark:text-slate-500">no email found</div>
                        )}
                      </div>
                      {c.email && (
                        <Button asChild size="sm" variant="outline" className="shrink-0">
                          <Link href={draftHref(applicationId, company, role, c)}>
                            <Mail className="h-3.5 w-3.5" /> Draft
                          </Link>
                        </Button>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {c.verified ? (
                        <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 gap-1">
                          <ShieldCheck className="h-3 w-3" /> verified
                        </Badge>
                      ) : c.email ? (
                        <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          unverified
                        </Badge>
                      ) : null}
                      {c.email && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                          {Math.round(c.confidence * 100)}% conf
                        </span>
                      )}
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                        {(c.sources ?? c.source)
                          .split(",")
                          .map((s) => SOURCE_LABEL[s] ?? s)
                          .join(" · ")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {status?.pattern && (
              <p className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                inferred email pattern: {status.pattern}@{status.domain}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
