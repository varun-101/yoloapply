"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/chip-input";
import { Loader2, Save } from "lucide-react";

export default function SearchSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetch("/api/settings/search")
      .then((r) => r.json())
      .then((d) => {
        setInclude(d.prefs.includeKeywords);
        setExclude(d.prefs.excludeKeywords);
        setLocations(d.prefs.locationKeywords);
        setEnabled(d.prefs.discoveryEnabled);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeKeywords: include,
          excludeKeywords: exclude,
          locationKeywords: locations,
          discoveryEnabled: enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setEnabled(data.prefs.discoveryEnabled);
      setSaved(true);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
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
      {saved && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          Search preferences saved.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Title keywords</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Include — a role title must match at least one
            </div>
            <ChipInput values={include} onChange={setInclude} placeholder="backend, software engineer, …" />
          </div>
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
              Exclude — whole-word, drops senior roles and non-engineering tracks
            </div>
            <ChipInput values={exclude} onChange={setExclude} placeholder="senior, staff, manager, …" />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            These filters apply to the firehose sources (ATS boards, HN) — curated freshers feeds
            pass through untouched.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChipInput values={locations} onChange={setLocations} placeholder="india, remote, mumbai, …" />
          {locations.length === 0 && (
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              No locations yet — scans would drop every posting that states one. Add the places you
              can work from (include <span className="font-mono text-[11px]">remote</span> if that
              applies); scheduled discovery stays off until you do.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled discovery</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              disabled={locations.length === 0}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#FFB224]"
            />
            <span>
              <span className="block text-sm font-medium">Include me in the every-3h sweep</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                The agent scans all sources on a schedule and files matching postings into your
                Discover feed. Manual “Scan now” works either way.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || include.length === 0}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save preferences
        </Button>
      </div>
    </div>
  );
}
