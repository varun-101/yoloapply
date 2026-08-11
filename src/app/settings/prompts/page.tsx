"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ChevronDown, Loader2, Save, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Layered prompt editing: the built-in system prompt stays read-only (it
// carries the JSON contract and the no-fabrication rule); the user's text is
// appended. See src/lib/prompts.ts for the composition.

interface Surface {
  key: string;
  label: string;
  description: string;
  placeholder: string;
}

type Prompts = Record<string, string>;

export default function PromptSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [prompts, setPrompts] = useState<Prompts>({});
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [voicePlaceholder, setVoicePlaceholder] = useState("");
  const [maxChars, setMaxChars] = useState(2000);

  useEffect(() => {
    fetch("/api/settings/prompts")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPrompts(d.prompts);
        setSurfaces(d.surfaces);
        setDefaults(d.defaults);
        setPreviews(d.previews);
        setVoicePlaceholder(d.voicePlaceholder);
        setMaxChars(d.maxChars);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  function set(key: string, value: string) {
    setPrompts((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompts),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setPrompts(data.prompts);
      setPreviews(data.previews);
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
          Writing instructions saved. They apply to everything drafted from now on.
        </div>
      )}

      <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400">
        Anything you write here is appended to the agent&apos;s built-in prompt for that task, so
        it wins on tone, length and wording. It can&apos;t change two things: the output format
        the app needs, and the rule that every claim must come from your profile and projects.
        Leave a box empty to use the built-in prompt as-is.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-signal" />
            Writing voice
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Applied to every surface below — resumes, cold emails, cover letters and application
            answers.
          </p>
          <PromptBox
            value={prompts.voice ?? ""}
            onChange={(v) => set("voice", v)}
            placeholder={voicePlaceholder}
            maxChars={maxChars}
            rows={4}
          />
        </CardContent>
      </Card>

      {surfaces.map((s) => (
        <Card key={s.key}>
          <CardHeader>
            <CardTitle>{s.label}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.description}</p>
            <PromptBox
              value={prompts[s.key] ?? ""}
              onChange={(v) => set(s.key, v)}
              placeholder={s.placeholder}
              maxChars={maxChars}
              rows={4}
            />
            <Disclosure label="View the built-in prompt">
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                {defaults[s.key]}
              </pre>
            </Disclosure>
            {previews[s.key] && previews[s.key] !== defaults[s.key] && (
              <Disclosure label="View what the model actually receives (saved version)">
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-signal/30 bg-signal/5 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {previews[s.key]}
                </pre>
              </Disclosure>
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save instructions
        </Button>
      </div>
    </div>
  );
}

function PromptBox({
  value,
  onChange,
  placeholder,
  maxChars,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxChars: number;
  rows: number;
}) {
  const over = value.length > maxChars;
  return (
    <div>
      <Textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn("font-sans", over && "border-rose-400 dark:border-rose-700")}
      />
      <div
        className={cn(
          "mt-1 text-right font-mono text-[10px]",
          over ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-600"
        )}
      >
        {value.length}/{maxChars}
      </div>
    </div>
  );
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[2.75rem] items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 md:min-h-0 md:py-1"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {label}
      </button>
      {open && children}
    </div>
  );
}
