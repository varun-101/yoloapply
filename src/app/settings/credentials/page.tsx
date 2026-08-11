"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Copy, Download, KeyRound, Loader2, Mail, Plug, Save, Trash2, Users } from "lucide-react";
import { PROVIDER_CONFIGS, DEFAULT_PROVIDER } from "@/lib/providers";

interface CredStatus {
  deepseekKeySet: boolean;
  deepseekLast4: string | null;
  llmProvider: string;
  llmModel: string | null;
  apolloKeySet: boolean;
  apolloLast4: string | null;
  signalhireKeySet: boolean;
  signalhireLast4: string | null;
  searchKeySet: boolean;
  searchLast4: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFromName: string | null;
  smtpPassSet: boolean;
  extensionTokenPrefix: string | null;
}

const PROVIDER_OPTIONS = Object.entries(PROVIDER_CONFIGS).map(([value, cfg]) => ({
  value,
  label: cfg.label,
  keyHint: cfg.keyHint,
  defaultModel: cfg.defaultModel,
  docsUrl: cfg.docsUrl,
}));

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

export default function CredentialsSettings() {
  const [status, setStatus] = useState<CredStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [llmProvider, setLlmProvider] = useState(DEFAULT_PROVIDER);
  const [llmModel, setLlmModel] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [apolloKey, setApolloKey] = useState("");
  const [signalhireKey, setSignalhireKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("smtp.gmail.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");

  // Shown exactly once after generation — never retrievable again.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/settings/credentials")
      .then((r) => r.json())
      .then((d: CredStatus) => {
        setStatus(d);
        setLlmProvider(d.llmProvider ?? DEFAULT_PROVIDER);
        setLlmModel(d.llmModel ?? "");
        if (d.smtpHost) setSmtpHost(d.smtpHost);
        if (d.smtpPort) setSmtpPort(String(d.smtpPort));
        if (d.smtpUser) setSmtpUser(d.smtpUser);
        if (d.smtpFromName) setSmtpFromName(d.smtpFromName);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function put(body: Record<string, unknown>, busyKey: string, okMsg: string) {
    setBusy(busyKey);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMsg(okMsg);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("smtp-test");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/smtp-test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test send failed");
      setMsg(`Test email sent to ${data.to} — check the inbox.`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function generateToken() {
    setBusy("token");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/extension-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Token generation failed");
      setFreshToken(data.token);
      setCopied(false);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revokeToken() {
    if (!confirm("Revoke the extension token? The extension stops working until you generate a new one.")) return;
    setBusy("token");
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/extension-token", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Revoke failed");
      setFreshToken(null);
      setMsg("Extension token revoked.");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (status === null) {
    return (
      <div className="p-12 text-center text-slate-400 dark:text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin inline" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {msg}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> LLM provider &amp; API key
          </CardTitle>
          {status.deepseekKeySet ? (
            <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              {PROVIDER_CONFIGS[status.llmProvider]?.label ?? status.llmProvider} · <span className="font-mono ml-1">…{status.deepseekLast4}</span>
            </Badge>
          ) : (
            <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">not set</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Powers fit-scoring, resume personalization, cold-email drafting, and form answers — billed to your own account.
            Stored encrypted; never shown again after saving.
          </p>

          <Field label="Provider">
            <div className="flex flex-wrap gap-2">
              {PROVIDER_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setLlmProvider(p.value)}
                  className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                    llmProvider === p.value
                      ? "border-signal bg-signal/10 text-amber-900 dark:text-signal font-medium"
                      : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {PROVIDER_CONFIGS[llmProvider] && (
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Get your key at{" "}
                <a href={PROVIDER_CONFIGS[llmProvider].docsUrl} target="_blank" rel="noreferrer" className="underline">
                  {PROVIDER_CONFIGS[llmProvider].docsUrl.replace("https://", "")}
                </a>
              </p>
            )}
          </Field>

          <Field label="API key">
            <div className="flex gap-2">
              <Input
                type="password"
                value={deepseekKey}
                onChange={(e) => setDeepseekKey(e.target.value)}
                placeholder={status.deepseekKeySet ? "enter a new key to replace" : (PROVIDER_CONFIGS[llmProvider]?.keyHint ?? "key…")}
                autoComplete="off"
              />
            </div>
          </Field>

          <Field
            label={`Model (optional — leave blank for ${PROVIDER_CONFIGS[llmProvider]?.defaultModel ?? "provider default"})`}
          >
            <Input
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder={PROVIDER_CONFIGS[llmProvider]?.defaultModel ?? ""}
            />
            {llmProvider === "openrouter" && (
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                Any model slug from{" "}
                <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer" className="underline">
                  openrouter.ai/models
                </a>
                , e.g. <code className="font-mono">google/gemini-2.5-flash</code> or <code className="font-mono">anthropic/claude-sonnet-4-5</code>
              </span>
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                put(
                  { deepseekKey: deepseekKey || undefined, llmProvider, llmModel: llmModel || null },
                  "deepseek",
                  "LLM credentials saved."
                ).then(() => setDeepseekKey(""))
              }
              disabled={busy !== null || (!deepseekKey.trim() && !status.deepseekKeySet)}
            >
              {busy === "deepseek" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
            {status.deepseekKeySet && (
              <Button
                variant="outline"
                onClick={() => put({ deepseekKey: null }, "deepseek", "LLM key removed.")}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" /> Remove key
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Contact finder (cold-email enrichment)
          </CardTitle>
          {status.apolloKeySet || status.signalhireKeySet || status.searchKeySet ? (
            <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              {[status.signalhireKeySet && "SignalHire", status.apolloKeySet && "Apollo", status.searchKeySet && "Search"]
                .filter(Boolean)
                .join(" + ")} active
            </Badge>
          ) : (
            <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">free lanes only</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            All optional. Recruiter discovery searches SignalHire and Apollo for people first; contact details are
            revealed only when you explicitly choose someone. Serper adds personal-site discovery. Paid calls use
            your own account and every key is encrypted at rest.
          </p>
          <Field
            label="SignalHire API key"
            hint={
              status.signalhireKeySet
                ? "Saved â€” enter a new key to replace. Searches company recruiters, then resolves the top contacts."
                : "Search recruiter profiles first, then use the Person API only for someone you select."
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={signalhireKey}
                onChange={(e) => setSignalhireKey(e.target.value)}
                placeholder={status.signalhireKeySet ? "enter a new key to replace" : "SignalHire API keyâ€¦"}
                autoComplete="off"
              />
              {status.signalhireKeySet && (
                <Badge className="shrink-0 gap-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3 w-3" /> saved
                  {status.signalhireLast4 && <span className="font-mono">â€¦{status.signalhireLast4}</span>}
                </Badge>
              )}
            </div>
          </Field>
          <Field
            label="Apollo API key"
            hint={
              status.apolloKeySet
                ? "Saved — Apollo People Search requires a paid Apollo plan. Discovery is free in credits, but unavailable to Free-plan API keys."
                : "Optional paid-plan integration. People Search discovers recruiters; People Enrichment reveals only your selection."
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={apolloKey}
                onChange={(e) => setApolloKey(e.target.value)}
                placeholder={status.apolloKeySet ? "enter a new key to replace" : "Apollo API key…"}
                autoComplete="off"
              />
              {status.apolloKeySet && (
                <Badge className="shrink-0 gap-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3 w-3" /> saved{status.apolloLast4 && <span className="font-mono">…{status.apolloLast4}</span>}
                </Badge>
              )}
            </div>
          </Field>
          <Field
            label="Serper.dev search API key"
            hint={
              status.searchKeySet
                ? "Saved — enter a new key to replace. Portfolio/personal-site email lane."
                : "Portfolio lane: Google-searches each person for their personal site/GitHub and extracts a public email. serper.dev."
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={searchKey}
                onChange={(e) => setSearchKey(e.target.value)}
                placeholder={status.searchKeySet ? "enter a new key to replace" : "Serper API key…"}
                autoComplete="off"
              />
              {status.searchKeySet && (
                <Badge className="shrink-0 gap-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3 w-3" /> saved{status.searchLast4 && <span className="font-mono">…{status.searchLast4}</span>}
                </Badge>
              )}
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                put(
                  {
                    apolloKey: apolloKey || undefined,
                    signalhireKey: signalhireKey || undefined,
                    searchKey: searchKey || undefined,
                  },
                  "finder",
                  "Contact-finder keys saved."
                ).then(() => {
                  setApolloKey("");
                  setSignalhireKey("");
                  setSearchKey("");
                })
              }
              disabled={busy !== null || (!apolloKey.trim() && !signalhireKey.trim() && !searchKey.trim())}
            >
              {busy === "finder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
            {status.apolloKeySet && (
              <Button
                variant="outline"
                onClick={() => put({ apolloKey: null }, "finder", "Apollo key removed.")}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" /> Remove Apollo
              </Button>
            )}
            {status.signalhireKeySet && (
              <Button
                variant="outline"
                onClick={() => put({ signalhireKey: null }, "finder", "SignalHire key removed.")}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" /> Remove SignalHire
              </Button>
            )}
            {status.searchKeySet && (
              <Button
                variant="outline"
                onClick={() => put({ searchKey: null }, "finder", "Search key removed.")}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" /> Remove Search
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Outbound email (SMTP)
          </CardTitle>
          {status.smtpPassSet && status.smtpUser ? (
            <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">configured</Badge>
          ) : (
            <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">not set</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Cold emails send from YOUR address. For Gmail: enable 2-step verification, then create
            an App Password (Google Account → Security → App passwords) and paste it here.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="SMTP host">
              <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
            </Field>
            <Field label="Port">
              <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
            </Field>
            <Field label="Email address (SMTP user)">
              <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@gmail.com" />
            </Field>
            <Field label="From name">
              <Input value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} placeholder="Your Name" />
            </Field>
            <Field
              label="App password"
              hint={status.smtpPassSet ? "Saved — leave blank to keep the current password." : undefined}
            >
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={status.smtpPassSet ? "unchanged" : "16-char app password"}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                put(
                  {
                    smtpHost,
                    smtpPort: Number(smtpPort) || 587,
                    smtpUser,
                    smtpFromName,
                    ...(smtpPass ? { smtpPass } : {}),
                  },
                  "smtp",
                  "SMTP settings saved."
                ).then(() => setSmtpPass(""))
              }
              disabled={busy !== null || !smtpHost || !smtpUser}
            >
              {busy === "smtp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save SMTP
            </Button>
            <Button variant="outline" onClick={sendTest} disabled={busy !== null || !status.smtpPassSet}>
              {busy === "smtp-test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send test email
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4" /> Chrome extension token
          </CardTitle>
          {status.extensionTokenPrefix ? (
            <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              active · <span className="font-mono ml-1">{status.extensionTokenPrefix}…</span>
            </Badge>
          ) : (
            <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">none</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-2.5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
                Install the extension
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Download the extension, unzip it, then in Chrome open{" "}
                <code className="font-mono">chrome://extensions</code>, turn on{" "}
                <span className="font-medium">Developer mode</span>, click{" "}
                <span className="font-medium">Load unpacked</span>, and pick the unzipped{" "}
                <code className="font-mono">yoloapply-extension</code> folder. Then paste your token
                (below) into the extension&rsquo;s Options page.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="/api/extension/download" download>
                <Download className="h-4 w-4" /> Download extension (.zip)
              </a>
            </Button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Personal API token for the YOLOapply Chrome extension (paste it into the extension's
            Options page). Only a hash is stored — the token is shown once, right after generating.
          </p>
          {freshToken && (
            <div className="rounded-md border border-signal/40 bg-signal/10 p-3">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-800 dark:text-signal">
                Copy it now — it won't be shown again
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white dark:bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800">
                  {freshToken}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(freshToken).then(() => setCopied(true));
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={generateToken} disabled={busy !== null}>
              {busy === "token" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              {status.extensionTokenPrefix ? "Regenerate token" : "Generate token"}
            </Button>
            {status.extensionTokenPrefix && (
              <Button variant="outline" onClick={revokeToken} disabled={busy !== null}>
                <Trash2 className="h-4 w-4" /> Revoke
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
