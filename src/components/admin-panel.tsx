"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Key, Loader2, RadarIcon, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { PROVIDER_CONFIGS, DEFAULT_PROVIDER } from "@/lib/providers";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  canScan: boolean;
  discoveryEnabled: boolean;
  hasDeepseekKey: boolean;
  applications: number;
  leads: number;
}

type ToggleField = "canScan" | "isAdmin" | "discoveryEnabled";

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 disabled:opacity-50",
        on ? "bg-signal" : "bg-slate-300 dark:bg-slate-700"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

interface SharedKeyStatus {
  active: boolean;
  expiresAt?: string;
  maskedKey?: string;
}

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const [sharedKey, setSharedKey] = useState<SharedKeyStatus | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [expiryInput, setExpiryInput] = useState("");
  const [keyProvider, setKeyProvider] = useState(DEFAULT_PROVIDER);
  const [keyModel, setKeyModel] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load users");
      setUsers(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadSharedKey = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/shared-key");
      if (res.ok) setSharedKey(await res.json());
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    load();
    loadSharedKey();
  }, [load, loadSharedKey]);

  async function toggle(u: AdminUser, field: ToggleField) {
    const next = !u[field];
    setBusy(`${u.id}:${field}`);
    setErr(null);
    // Optimistic.
    setUsers((us) => (us ?? []).map((x) => (x.id === u.id ? { ...x, [field]: next } : x)));
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
    } catch (e) {
      // Revert on failure.
      setUsers((us) => (us ?? []).map((x) => (x.id === u.id ? { ...x, [field]: !next } : x)));
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runScan() {
    setErr(null);
    setScanMsg(null);
    setScanning(true);
    try {
      const res = await fetch("/api/admin/scan", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't start the scan");
      setScanMsg(
        "Scan started in the background — refreshing the shared catalog and scoring discovery-enabled users. Watch progress on Discover or in scan history."
      );
      // Reflect updated lead counts after a short delay.
      setTimeout(load, 8000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function saveSharedKey() {
    setKeyBusy(true);
    setKeyErr(null);
    setKeyMsg(null);
    try {
      if (!keyInput) throw new Error("Enter a DeepSeek API key.");
      if (!expiryInput) throw new Error("Set an expiry date.");
      // Treat the date as end-of-day UTC so the key stays valid through the chosen date.
      const expiresAt = new Date(expiryInput + "T23:59:59Z").toISOString();
      const res = await fetch("/api/admin/shared-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput, expiresAt, llmProvider: keyProvider, llmModel: keyModel || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      setKeyInput("");
      setKeyMsg("Shared key saved.");
      await loadSharedKey();
    } catch (e) {
      setKeyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setKeyBusy(false);
    }
  }

  async function clearSharedKey() {
    setKeyBusy(true);
    setKeyErr(null);
    setKeyMsg(null);
    try {
      const res = await fetch("/api/admin/shared-key", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to clear");
      setKeyMsg("Shared key cleared.");
      await loadSharedKey();
    } catch (e) {
      setKeyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setKeyBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discovery</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
            Refresh the shared catalog for everyone. Every user sees the same postings; each user
            scores their own fit with their DeepSeek key from the Discover page.
          </p>
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadarIcon className="h-4 w-4" />}
            Scan everybody
          </Button>
        </CardContent>
        {scanMsg && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-amber-800 dark:text-signal">
              {scanMsg}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> Shared DeepSeek Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Users without their own DeepSeek key will use this shared key until it expires. Set an expiry date — the key becomes inactive automatically after that.
          </p>

          {sharedKey && (
            <div className="flex items-center gap-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm">
              {sharedKey.active ? (
                <>
                  <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 shrink-0">active</Badge>
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{sharedKey.maskedKey}</span>
                  <span className="text-slate-500 dark:text-slate-400">· expires {new Date(sharedKey.expiresAt!).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                </>
              ) : sharedKey.expiresAt ? (
                <>
                  <Badge className="bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 shrink-0">expired</Badge>
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{sharedKey.maskedKey}</span>
                  <span className="text-slate-500 dark:text-slate-400">· expired {new Date(sharedKey.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                </>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">No shared key set.</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-1">
            {Object.entries(PROVIDER_CONFIGS).map(([value, cfg]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKeyProvider(value)}
                className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                  keyProvider === value
                    ? "border-signal bg-signal/10 text-amber-900 dark:text-signal font-medium"
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400"
                }`}
              >
                {cfg.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              placeholder={PROVIDER_CONFIGS[keyProvider]?.keyHint ?? "key…"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="flex-1 min-w-48 font-mono text-sm"
            />
            <Input
              placeholder={`model (default: ${PROVIDER_CONFIGS[keyProvider]?.defaultModel ?? ""})`}
              value={keyModel}
              onChange={(e) => setKeyModel(e.target.value)}
              className="flex-1 min-w-48 font-mono text-sm"
            />
            <input
              type="date"
              value={expiryInput}
              onChange={(e) => setExpiryInput(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-signal/70"
            />
            <Button onClick={saveSharedKey} disabled={keyBusy}>
              {keyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
              Save
            </Button>
            {sharedKey?.expiresAt && (
              <Button variant="outline" onClick={clearSharedKey} disabled={keyBusy}>
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>

          {keyErr && (
            <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
              {keyErr}
            </div>
          )}
          {keyMsg && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              {keyMsg}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Users</CardTitle>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <RefreshCw className="h-3.5 w-3.5" /> refresh
          </button>
        </CardHeader>
        <CardContent className="p-0">
          {users === null ? (
            <div className="p-12 text-center text-slate-400 dark:text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin inline" />
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Key</th>
                  <th className="px-4 py-3 font-medium text-right">Apps</th>
                  <th className="px-4 py-3 font-medium text-right">Leads</th>
                  <th className="px-4 py-3 font-medium text-center">Can scan</th>
                  <th className="px-4 py-3 font-medium text-center">Discovery</th>
                  <th className="px-4 py-3 font-medium text-center">Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-slate-100 dark:border-slate-800 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.name ?? u.email}</div>
                      {u.name && (
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {u.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.hasDeepseekKey ? (
                        <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          key set
                        </Badge>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                          none
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {u.applications}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{u.leads}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <Toggle
                          on={u.canScan || u.isAdmin}
                          disabled={u.isAdmin || busy === `${u.id}:canScan`}
                          onClick={() => toggle(u, "canScan")}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <Toggle
                          on={u.discoveryEnabled}
                          disabled={busy === `${u.id}:discoveryEnabled`}
                          onClick={() => toggle(u, "discoveryEnabled")}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        {u.isAdmin ? (
                          <span title="Admin" className="text-signal">
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                        ) : (
                          <Toggle
                            on={false}
                            disabled={busy === `${u.id}:isAdmin`}
                            onClick={() => toggle(u, "isAdmin")}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
        Admins always have scan permission. Granting “can scan” lets a user refresh the shared
        catalog from their own Discover page.
      </p>
    </div>
  );
}
