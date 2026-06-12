"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/chip-input";
import { ExternalLink, Loader2, Pencil, Plus, Save, Star, Trash2, X } from "lucide-react";

interface Project {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  tagline: string | null;
  oneLiner: string;
  problem: string | null;
  approach: string | null;
  outcome: string | null;
  techStack: string[];
  repoUrl: string | null;
  liveUrl: string | null;
  year: string | null;
  featured: boolean;
  sortOrder: number;
}

interface Draft {
  title: string;
  subtitle: string;
  tagline: string;
  oneLiner: string;
  problem: string;
  approach: string;
  outcome: string;
  techStack: string[];
  repoUrl: string;
  liveUrl: string;
  year: string;
  featured: boolean;
  sortOrder: number;
}

const EMPTY: Draft = {
  title: "",
  subtitle: "",
  tagline: "",
  oneLiner: "",
  problem: "",
  approach: "",
  outcome: "",
  techStack: [],
  repoUrl: "",
  liveUrl: "",
  year: "",
  featured: false,
  sortOrder: 0,
};

function toDraft(p: Project): Draft {
  return {
    title: p.title,
    subtitle: p.subtitle ?? "",
    tagline: p.tagline ?? "",
    oneLiner: p.oneLiner,
    problem: p.problem ?? "",
    approach: p.approach ?? "",
    outcome: p.outcome ?? "",
    techStack: p.techStack,
    repoUrl: p.repoUrl ?? "",
    liveUrl: p.liveUrl ?? "",
    year: p.year ?? "",
    featured: p.featured,
    sortOrder: p.sortOrder,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function ProjectsSettings() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // editing: null = closed, "new" = create form, otherwise a project id
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/settings/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const url = editing === "new" ? "/api/settings/projects" : `/api/settings/projects/${editing}`;
      const res = await fetch(url, {
        method: editing === "new" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setEditing(null);
      setDraft(EMPTY);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Project) {
    if (!confirm(`Delete "${p.title}" from your project bank?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/settings/projects/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeatured(p: Project) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/settings/projects/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toDraft(p), featured: !p.featured }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <Card className="border-signal/40">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{editing === "new" ? "New project" : "Edit project"}</CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(null);
            setDraft(EMPTY);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Title">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Subtitle">
            <Input value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
          </Field>
        </div>
        <Field label="One-liner (used in prompts and resume headers)">
          <Input value={draft.oneLiner} onChange={(e) => setDraft({ ...draft, oneLiner: e.target.value })} />
        </Field>
        <Field label="Tagline">
          <Input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
        </Field>
        <Field label="Problem">
          <Textarea rows={2} value={draft.problem} onChange={(e) => setDraft({ ...draft, problem: e.target.value })} />
        </Field>
        <Field label="Approach">
          <Textarea rows={2} value={draft.approach} onChange={(e) => setDraft({ ...draft, approach: e.target.value })} />
        </Field>
        <Field label="Outcome">
          <Textarea rows={2} value={draft.outcome} onChange={(e) => setDraft({ ...draft, outcome: e.target.value })} />
        </Field>
        <Field label="Tech stack">
          <ChipInput
            values={draft.techStack}
            onChange={(techStack) => setDraft({ ...draft, techStack })}
            placeholder="node, postgres, redis, …"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Repo URL">
            <Input value={draft.repoUrl} onChange={(e) => setDraft({ ...draft, repoUrl: e.target.value })} />
          </Field>
          <Field label="Live URL">
            <Input value={draft.liveUrl} onChange={(e) => setDraft({ ...draft, liveUrl: e.target.value })} />
          </Field>
          <Field label="Year">
            <Input value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={draft.featured}
            onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}
            className="h-4 w-4 accent-[#FFB224]"
          />
          Featured — preferred when personalization picks projects
        </label>
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy || !draft.title || !draft.oneLiner}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save project
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Resume personalization and cold emails may ONLY draw on these projects — nothing is ever
          invented. Keep the details factual.
        </p>
        {editing === null && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(EMPTY);
              setEditing("new");
            }}
          >
            <Plus className="h-4 w-4" /> Add project
          </Button>
        )}
      </div>

      {err && (
        <div className="rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
          {err}
        </div>
      )}

      {editing === "new" && form}

      {projects === null ? (
        <div className="p-12 text-center text-slate-400 dark:text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline" />
        </div>
      ) : projects.length === 0 && editing === null ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No projects yet — resume personalization needs at least one to work with.
          </CardContent>
        </Card>
      ) : (
        projects?.map((p) =>
          editing === p.id ? (
            <div key={p.id}>{form}</div>
          ) : (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.title}</span>
                      {p.featured && (
                        <Badge className="bg-signal/15 text-signal-deep dark:text-signal">
                          <Star className="h-3 w-3 mr-1 inline" />
                          featured
                        </Badge>
                      )}
                      {p.year && (
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{p.year}</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{p.oneLiner}</p>
                    {p.techStack.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {p.techStack.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px]">
                      {p.repoUrl && (
                        <a href={p.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:underline">
                          repo <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {p.liveUrl && (
                        <a href={p.liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:underline">
                          live <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => toggleFeatured(p)}
                      title={p.featured ? "Unfeature" : "Feature"}
                    >
                      <Star className={`h-4 w-4 ${p.featured ? "fill-current text-signal-deep dark:text-signal" : ""}`} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setDraft(toDraft(p));
                        setEditing(p.id);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(p)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        )
      )}
    </div>
  );
}
