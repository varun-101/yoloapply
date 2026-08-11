"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Loader2, Mail, MapPin, Plus, RefreshCw, Search, ShieldCheck, Users } from "lucide-react";

interface Contact {
  id?: string;
  name: string | null;
  phone: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  location: string | null;
  providerPersonId: string | null;
  contactStatus: string;
  source: string;
  sources: string | null;
  confidence: number;
  verified: boolean;
  verifyMethod: string | null;
  seniorityRank: number;
  skipResolve: boolean; // works elsewhere: no provider lookup against this company
}

interface Diagnostic { found: number; status?: string; error?: string; creditsRemaining?: string }
// The recruiter the job listing named. Known from the lead alone, so it arrives
// with every response — including "no_domain", where no search can run at all.
interface ListingRecruiter { name: string; title: string | null; company: string | null }
interface Status {
  listingRecruiter: ListingRecruiter | null;
  domain: string | null;
  company: string;
  status: "idle" | "running" | "completed" | "failed" | "no_domain";
  pattern: string | null;
  error: string | null;
  enrichedAt: string | null;
  contacts: Contact[];
  searchLocation: string | null;
  sourceStats: Record<string, Diagnostic>;
}

const SOURCE_LABEL: Record<string, string> = {
  lead: "from listing", listing: "named on listing", apollo: "Apollo", signalhire: "SignalHire", manual: "manual",
  site: "company site", github: "GitHub", hn: "HN post", portfolio: "portfolio",
  role_inbox: "role inbox", pattern: "pattern guess",
};

// A person we know by name but have no profile link for (the recruiter a job
// listing names, typically) — send the user straight to a LinkedIn search for
// them rather than the generic company one. `org` should be where THEY work,
// which for an agency recruiter is not the company being applied to.
function personSearchHref(name: string, org: string): string {
  const keywords = [name, org].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords }).toString()}`;
}

// An external recruiter's employer is appended to their title as "… · Agency".
// Only a title that actually carries that separator names a different org;
// anything else is just a job title and would poison the search keywords.
function orgFromTitle(title: string | null): string | null {
  if (!title?.includes("·")) return null;
  return title.split("·").pop()?.trim() || null;
}

function draftHref(applicationId: string, company: string, role: string, contact: Contact): string {
  const query = new URLSearchParams({ applicationId, company, role });
  if (contact.email) query.set("email", contact.email);
  if (contact.name) query.set("name", contact.name);
  if (contact.title) query.set("title", contact.title);
  if (contact.id && contact.source !== "role_inbox") query.set("recruiterCandidateId", contact.id);
  return `/cold-email?${query.toString()}`;
}

function ProviderStatus({ name, diagnostic }: { name: string; diagnostic?: Diagnostic }) {
  const state = diagnostic?.status ?? "pending";
  const tone = state === "ok" ? "text-emerald-700 dark:text-emerald-400" : state === "not_configured" ? "text-slate-500" : "text-amber-700 dark:text-amber-400";
  const label = state === "ok" ? `${diagnostic?.found ?? 0} people` : state === "not_configured" ? "not configured" : state === "plan_required" ? "paid plan required" : state === "quota_exhausted" ? "quota exhausted" : state === "auth_error" ? "check credentials" : state === "rate_limited" ? "rate limited" : state === "pending" ? "not run" : "failed";
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium truncate">{name}</span>
        <span className={`shrink-0 font-mono text-[11px] ${tone}`}>{label}</span>
      </div>
      {diagnostic?.creditsRemaining && <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{diagnostic.creditsRemaining} credits left</div>}
      {diagnostic?.error && <div className="mt-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{diagnostic.error}</div>}
    </div>
  );
}

export default function FindContacts({ applicationId, company, role }: { applicationId: string; company: string; role: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({ name: "", title: "", location: "", linkedinUrl: "", email: "" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  const load = useCallback(async () => {
    const response = await fetch(`/api/contacts/find?applicationId=${encodeURIComponent(applicationId)}`);
    const data: Status = await response.json();
    setStatus(data);
    return data;
  }, [applicationId]);
  const pollByDomain = useCallback((domain: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/contacts/find?domain=${encodeURIComponent(domain)}&applicationId=${encodeURIComponent(applicationId)}`);
        const data: Status = await response.json();
        setStatus(data);
        if (data.status !== "running") stopPolling();
      } catch { /* transient polling failure */ }
    }, 2500);
  }, [applicationId, stopPolling]);

  useEffect(() => {
    let alive = true;
    load().then((data) => { if (alive && data.status === "running" && data.domain) pollByDomain(data.domain); }).catch(() => {});
    return () => { alive = false; stopPolling(); };
  }, [load, pollByDomain, stopPolling]);

  async function find(force = false) {
    setBusy(true); setErr(null);
    try {
      const response = await fetch("/api/contacts/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId, force }) });
      const data: Status & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Search failed");
      setStatus(data);
      if (data.status === "running" && data.domain) pollByDomain(data.domain);
    } catch (error) { setErr(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function reveal(contact: Contact) {
    if (!contact.id) return;
    setResolvingId(contact.id); setErr(null);
    try {
      const response = await fetch("/api/contacts/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId, candidateId: contact.id }) });
      const data = await response.json();
      // A provider can return a full profile (including LinkedIn) without an
      // email. Reload before surfacing that partial-result message so the new
      // LinkedIn action appears immediately.
      if (data.candidate) await load();
      if (!response.ok) throw new Error(data.error ?? "Could not reveal this contact");
      if (!data.candidate) await load();
    } catch (error) { setErr(error instanceof Error ? error.message : String(error)); }
    finally { setResolvingId(null); }
  }

  async function addManual() {
    setBusy(true); setErr(null);
    try {
      const response = await fetch("/api/contacts/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId, ...manual }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not add recruiter");
      setManual({ name: "", title: "", location: "", linkedinUrl: "", email: "" });
      setShowManual(false);
      await load();
    } catch (error) { setErr(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  const running = status?.status === "running";
  const people = (status?.contacts ?? []).filter((contact) => contact.source !== "role_inbox" && !!contact.name);
  const inboxes = (status?.contacts ?? []).filter((contact) => contact.source === "role_inbox");
  // Once a run has folded the listing recruiter into the ranked results, that
  // entry is richer (it may carry a resolved email), so the standalone card
  // stands down rather than showing the same person twice.
  const normName = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const listingRecruiter = status?.listingRecruiter ?? null;
  const showListingCard =
    !!listingRecruiter && !people.some((person) => normName(person.name) === normName(listingRecruiter.name));
  const listingIsAgency =
    !!listingRecruiter?.company && normName(listingRecruiter.company) !== normName(company);
  const linkedInSearch = `https://www.linkedin.com/search/results/people/?${new URLSearchParams({
    keywords: [company, "recruiter", status?.searchLocation].filter(Boolean).join(" "),
  }).toString()}`;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" /> Find recruiter</CardTitle>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>{company}</span><span aria-hidden>·</span><span>{role}</span>
            {status?.searchLocation && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{status.searchLocation}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline"><a href={linkedInSearch} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Search LinkedIn</a></Button>
          <Button size="sm" variant="outline" onClick={() => setShowManual((value) => !value)}><Plus className="h-3.5 w-3.5" /> Add person</Button>
          {status?.status === "completed" && <Button size="sm" variant="ghost" onClick={() => find(true)} disabled={busy || running}><RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /> Refresh</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {showListingCard && listingRecruiter && (
          <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
              Named on this listing
            </div>
            <div className="mt-1.5 min-w-0">
              <div className="truncate font-medium">{listingRecruiter.name}</div>
              {listingRecruiter.title && (
                <div className="truncate text-xs text-slate-600 dark:text-slate-300">{listingRecruiter.title}</div>
              )}
              {listingIsAgency && (
                <div className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                  Hiring for {company} through {listingRecruiter.company}, so their email won&apos;t be at
                  the {company} domain.
                </div>
              )}
            </div>
            <div className="mt-2.5">
              <Button asChild size="sm" variant="outline">
                <a
                  href={personSearchHref(listingRecruiter.name, listingRecruiter.company || company)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Search className="h-3.5 w-3.5" /> Find on LinkedIn
                </a>
              </Button>
            </div>
          </div>
        )}

        {!status || status.status === "idle" ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">Discover relevant people first. Contact details are revealed only after you choose a person.</p>
            <Button onClick={() => find(false)} disabled={busy} className="w-full bg-signal text-slate-950 hover:bg-signal/90">{busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Search className="h-4 w-4 shrink-0" />}<span className="truncate">Find recruiters at {company}</span></Button>
          </div>
        ) : null}

        {showManual && (
          <div className="space-y-2 rounded-md border border-slate-200 dark:border-slate-800 p-3">
            <div className="font-medium">Add a recruiter you found</div>
            <div className="grid grid-cols-1 gap-2">
              <Input placeholder="Name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <Input placeholder="Title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
              <Input placeholder="Location" value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })} />
              <Input placeholder="LinkedIn profile URL" value={manual.linkedinUrl} onChange={(e) => setManual({ ...manual, linkedinUrl: e.target.value })} />
              <Input placeholder="Email (optional)" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
            </div>
            <div className="flex gap-2"><Button size="sm" onClick={addManual} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add recruiter</Button><Button size="sm" variant="ghost" onClick={() => setShowManual(false)}>Cancel</Button></div>
          </div>
        )}

        {running && <div className="flex items-start gap-2 rounded-md border border-signal/30 bg-signal/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-signal"><Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /><span>Discovering people at {status?.domain ?? company}. You can leave this page.</span></div>}
        {status?.status === "no_domain" && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">{status.error}</div>}
        {status?.status === "failed" && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">Search failed: {status.error}</div>}
        {err && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">{err}</div>}

        {status && Object.keys(status.sourceStats ?? {}).length > 0 && (
          <div className="grid grid-cols-1 gap-2">
            <ProviderStatus name="SignalHire" diagnostic={status.sourceStats.signalhire} />
            <ProviderStatus name="Apollo" diagnostic={status.sourceStats.apollo} />
          </div>
        )}

        {(status?.status === "completed" || (people.length > 0 && running)) && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><div className="font-medium">People</div><Link href="/settings/profile" className="text-xs text-signal hover:underline">Change recruiter location</Link></div>
            {people.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">No recruiter people found. Check provider status, refresh after quota resets, or add a LinkedIn profile manually.</p> : (
              <ul className="space-y-2">
                {people.map((contact, index) => (
                  <li key={contact.id ?? `${contact.name}-${index}`} className="rounded-md border border-slate-100 p-3 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{contact.name}</div>
                      {contact.title && <div className="truncate text-xs text-slate-600 dark:text-slate-300">{contact.title}</div>}
                      {contact.location && <div className="mt-0.5 flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400"><MapPin className="mt-px h-3 w-3 shrink-0" /><span className="min-w-0">{contact.location}</span></div>}
                      {contact.email ? <div className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{contact.email}</div> : <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Email not revealed</div>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge className="border border-slate-200 bg-transparent font-mono text-slate-600 dark:border-slate-700 dark:text-slate-300">relevance {contact.seniorityRank}</Badge>
                      {contact.verified ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><ShieldCheck className="mr-1 h-3 w-3" />verified email</Badge> : contact.email ? <Badge className="border border-slate-200 bg-transparent text-slate-600 dark:border-slate-700 dark:text-slate-300">unverified email · {Math.round(contact.confidence * 100)}%</Badge> : null}
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">{(contact.sources ?? contact.source).split(",").map((source) => SOURCE_LABEL[source] ?? source).join(" · ")}</span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {contact.linkedinUrl
                        ? <Button asChild size="sm" variant="outline"><a href={contact.linkedinUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> LinkedIn</a></Button>
                        : !contact.email && <Button asChild size="sm" variant="outline"><a href={personSearchHref(contact.name ?? "", orgFromTitle(contact.title) ?? company)} target="_blank" rel="noreferrer"><Search className="h-3.5 w-3.5" /> Find on LinkedIn</a></Button>}
                      {contact.email
                        ? <Button asChild size="sm"><Link href={draftHref(applicationId, company, role, contact)}><Mail className="h-3.5 w-3.5" /> Draft</Link></Button>
                        : contact.skipResolve && !contact.linkedinUrl
                          // Nothing to reveal: they don't work at this domain, so
                          // a provider lookup here can only return the wrong person.
                          ? <span className="text-[11px] text-slate-500 dark:text-slate-400">Works at {orgFromTitle(contact.title) ?? "another company"} · reach them on LinkedIn</span>
                          : <Button size="sm" onClick={() => reveal(contact)} disabled={!contact.id || resolvingId === contact.id}>{resolvingId === contact.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} Reveal &amp; select</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {inboxes.length > 0 && (
          <details className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            <summary className="cursor-pointer text-xs font-medium">Generic company inboxes ({inboxes.length})</summary>
            <p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">Fallback addresses only. These are not verified recruiter people and do not complete the recruiter task.</p>
            <ul className="mt-2 space-y-1">{inboxes.map((contact, index) => <li key={contact.email ?? index} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate font-mono">{contact.email}</span>{contact.email && <Button asChild size="sm" variant="ghost" className="shrink-0"><Link href={draftHref(applicationId, company, role, contact)}>Draft fallback</Link></Button>}</li>)}</ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
