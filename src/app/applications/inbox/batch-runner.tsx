"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Play, RotateCcw } from "lucide-react";

type Operation = "ANALYZE_MATCH" | "GENERATE_RESUME" | "FIND_RECRUITER";
interface AppOption { id: string; company: string; role: string; readiness: string; score: number | null }
interface BatchItem {
  id: string;
  applicationId: string;
  status: string;
  currentStep: Operation | null;
  errorMessage: string | null;
  application: { company: string; role: string };
}
interface Batch { id: string; status: string; operations: Operation[]; items: BatchItem[] }

const operationLabels: Record<Operation, string> = {
  ANALYZE_MATCH: "Analyze match",
  GENERATE_RESUME: "Tailor resume",
  FIND_RECRUITER: "Find recruiters",
};

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function BatchRunner({ applications, initialBatch }: { applications: AppOption[]; initialBatch: Batch | null }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [operations, setOperations] = useState<Operation[]>(["ANALYZE_MATCH", "GENERATE_RESUME", "FIND_RECRUITER"]);
  const [batch, setBatch] = useState<Batch | null>(initialBatch);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(itemId: string, patch: Partial<BatchItem>) {
    setBatch((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) } : current);
  }

  async function persistItem(batchId: string, item: BatchItem, status: string, currentStep?: Operation, errorMessage?: string) {
    updateItem(item.id, { status, currentStep: currentStep ?? null, errorMessage: errorMessage ?? null });
    await jsonFetch(`/api/application-batches/${batchId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, currentStep, errorMessage }),
    });
  }

  async function runOperation(applicationId: string, operation: Operation) {
    if (operation === "ANALYZE_MATCH") {
      await jsonFetch(`/api/applications/${applicationId}/analyze`, { method: "POST" });
      return;
    }
    if (operation === "GENERATE_RESUME") {
      const result = await jsonFetch(`/api/applications/${applicationId}/personalize`, { method: "POST" });
      if (result.alreadyRunning) {
        for (let attempt = 0; attempt < 90; attempt++) {
          await wait(2000);
          const workflow = await jsonFetch(`/api/applications/${applicationId}/workflow`);
          const task = workflow.tasks?.find((entry: { key: string }) => entry.key === "GENERATE_RESUME");
          if (task?.status === "SUCCESS") return;
          if (task?.status === "FAILED") throw new Error(task.errorMessage ?? "Resume generation failed.");
        }
        throw new Error("Resume generation is still running; resume this batch later.");
      }
      return;
    }
    const started = await jsonFetch("/api/contacts/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId }),
    });
    let status = started;
    for (let attempt = 0; status.status === "running" && attempt < 60; attempt++) {
      await wait(2000);
      status = await jsonFetch(`/api/contacts/find?domain=${encodeURIComponent(status.domain)}&applicationId=${encodeURIComponent(applicationId)}`);
    }
    if (
      status.status === "completed" &&
      Array.isArray(status.contacts) &&
      status.contacts.some((contact: { source?: string; name?: string | null }) => contact.source !== "role_inbox" && !!contact.name)
    ) return;
    if (status.status === "running") throw new Error("Recruiter discovery is still running; resume this batch later.");
    throw new Error(status.error ?? "No recruiter candidates were found.");
  }

  async function run(current: Batch) {
    setRunning(true);
    setError(null);
    try {
      for (const item of current.items) {
        if (item.status === "SUCCESS" || item.status === "SKIPPED") continue;
        try {
          for (const operation of current.operations) {
            await persistItem(current.id, item, "RUNNING", operation);
            await runOperation(item.applicationId, operation);
          }
          await persistItem(current.id, item, "SUCCESS");
        } catch (cause) {
          await persistItem(current.id, item, "FAILED", item.currentStep ?? undefined, cause instanceof Error ? cause.message : String(cause));
        }
      }
      const refreshed = await jsonFetch(`/api/application-batches/${current.id}`);
      setBatch(refreshed.batch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }

  async function start() {
    setError(null);
    try {
      const data = await jsonFetch("/api/application-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationIds: selected, operations }),
      });
      setBatch(data.batch);
      await run(data.batch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function toggleApplication(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 5 ? [...current, id] : current);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Prepare a batch</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            {(Object.keys(operationLabels) as Operation[]).map((operation) => (
              <label key={operation} className="flex items-center gap-2">
                <input type="checkbox" checked={operations.includes(operation)} onChange={() => setOperations((current) => current.includes(operation) ? current.filter((value) => value !== operation) : [...current, operation])} />
                {operationLabels[operation]}
              </label>
            ))}
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-800">
            {applications.map((application) => (
              <label key={application.id} className="flex items-center gap-3 p-3 text-sm">
                <input type="checkbox" checked={selected.includes(application.id)} onChange={() => toggleApplication(application.id)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{application.company}</span> — {application.role}
                </span>
                {application.score !== null && <span className="text-xs tabular-nums">{application.score}%</span>}
                <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{application.readiness.toLowerCase().replaceAll("_", " ")}</Badge>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={start} disabled={running || selected.length === 0 || operations.length === 0 || !!(batch && ["PENDING", "RUNNING"].includes(batch.status))}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Prepare {selected.length || "selected"}
            </Button>
            <span className="text-xs text-slate-500">Maximum 5, processed sequentially. No submissions or emails are sent.</span>
          </div>
          {error && <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>}
        </CardContent>
      </Card>

      {batch && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Batch progress</CardTitle>
            <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{batch.status.toLowerCase().replaceAll("_", " ")}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {batch.items.map((item) => (
              <div key={item.id} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/applications/${item.applicationId}`} className="font-medium hover:underline">{item.application.company} — {item.application.role}</Link>
                  <span className="text-xs">{item.status.toLowerCase()}</span>
                </div>
                {item.currentStep && <div className="mt-1 text-xs text-slate-500">{operationLabels[item.currentStep]}</div>}
                {item.errorMessage && <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">{item.errorMessage}</div>}
              </div>
            ))}
            {batch.status === "PARTIAL_FAILED" && (
              <Button variant="outline" onClick={() => run(batch)} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Retry failed items
              </Button>
            )}
            {["PENDING", "RUNNING"].includes(batch.status) && !running && (
              <Button variant="outline" onClick={() => run(batch)}><Play className="h-4 w-4" /> Resume batch</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
