"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImageIcon, Link2, Loader2, Sparkles, Wand2 } from "lucide-react";

type ExtractStatus =
  | { kind: "idle" }
  | { kind: "fetching"; source: "image" | "url" }
  | { kind: "ok"; source: "image" | "url" }
  | { kind: "err"; source: "image" | "url"; msg: string };

export default function NewApplication() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("portal");
  const [jdUrl, setJdUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractStatus>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill from query params, e.g. the Funding Radar "Cold email" deep link
  // (?company=…&source=cold_email). Read on mount to avoid a Suspense boundary.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = p.get("company");
    const r = p.get("role");
    const s = p.get("source");
    if (c) setCompany(c);
    if (r) setRole(r);
    if (s === "cold_email" || s === "manual" || s === "linkedin" || s === "portal") setSource(s);
  }, []);

  function applyExtracted(data: {
    company?: string;
    role?: string;
    location?: string;
    jdText?: string;
    applyUrl?: string;
    source?: string;
  }) {
    if (data.company) setCompany(data.company);
    if (data.role) setRole(data.role);
    if (data.location) setLocation(data.location);
    if (data.jdText) setJdText(data.jdText);
    if (data.applyUrl && !jdUrl) setJdUrl(data.applyUrl);
    if (data.source === "linkedin" || data.source === "portal") setSource(data.source);
  }

  async function uploadImage(file: File) {
    setExtract({ kind: "fetching", source: "image" });
    setErr(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 110_000);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract-job/image", {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to extract");
      applyExtracted(data);
      setExtract({ kind: "ok", source: "image" });
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Extraction timed out after 110s. Try a smaller screenshot, or paste the JD text manually."
          : e instanceof Error
          ? e.message
          : String(e);
      setExtract({ kind: "err", source: "image", msg });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchUrl() {
    if (!jdUrl) return;
    setExtract({ kind: "fetching", source: "url" });
    setErr(null);
    try {
      const res = await fetch("/api/extract-job/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jdUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      applyExtracted(data);
      setExtract({ kind: "ok", source: "url" });
    } catch (e: unknown) {
      setExtract({ kind: "err", source: "url", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  async function submit(personalize: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/jobs/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, source, jdUrl, jdText, location }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create application");
      if (personalize) {
        const personalizeResponse = await fetch(`/api/applications/${data.id}/personalize`, { method: "POST" });
        const personalizeBody = await personalizeResponse.json();
        if (!personalizeResponse.ok) throw new Error(personalizeBody.error ?? "Resume personalization failed");
      }
      router.push(`/applications/${data.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const extractingImage = extract.kind === "fetching" && extract.source === "image";
  const extractingUrl = extract.kind === "fetching" && extract.source === "url";

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">New Application</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            Auto-fill from a screenshot or URL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void uploadImage(f);
            }}
            disabled={extractingImage}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500 transition-colors px-4 py-6 text-sm text-slate-600 dark:text-slate-300 flex flex-col items-center gap-2 disabled:opacity-50"
          >
            {extractingImage ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                <span>Reading the screenshot with DeepSeek vision…</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">First call can take 5-15s; later calls are quicker.</span>
              </>
            ) : (
              <>
                <ImageIcon className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                <span>
                  <span className="font-medium">Click to upload</span> or drag a job-posting screenshot
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">PNG / JPG — sent to DeepSeek vision to extract fields</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
              e.target.value = "";
            }}
          />

          <div className="flex items-center gap-2">
            <Input
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
              placeholder="…or paste the JD URL and we'll fetch it"
              className="flex-1"
            />
            <Button onClick={fetchUrl} disabled={!jdUrl || extractingUrl} variant="outline">
              {extractingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Fetch
            </Button>
          </div>

          {extract.kind === "ok" && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              Filled in fields from {extract.source === "image" ? "the screenshot" : "the URL"}. Review and edit
              below before saving.
            </div>
          )}
          {extract.kind === "err" && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {extract.msg}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Company</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Anthropic" />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Role</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Software Engineer, Backend" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Source</label>
              <select
                className="flex h-11 md:h-9 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="portal">Company portal</option>
                <option value="linkedin">LinkedIn</option>
                <option value="cold_email">Cold email</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-slate-400">Location</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote / Bangalore" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 dark:text-slate-400">Job description</label>
            <Textarea
              rows={12}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Auto-filled from the screenshot or URL above, or paste it manually here."
            />
          </div>
          {err && (
            <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>
          )}
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
            <Button
              disabled={busy || !company || !role}
              onClick={() => submit(true)}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Save &amp; personalize resume
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" disabled={busy || !company || !role} onClick={() => submit(false)}>
              Save without personalizing
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
